from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional
from api_helper import ShoonyaApiPy
import pyotp
import threading
import time
import sqlite3
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import pandas as pd
import datetime
import os
import yaml

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

conn = sqlite3.connect("trading_multi.db", check_same_thread=False)

def init_db():
    with conn:
        conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password TEXT,
            api_key TEXT,
            totp_token TEXT,
            vendor_code TEXT,
            default_quantity INTEGER,
            imei TEXT
        )
        """)
    conn.commit()

init_db()

class User(BaseModel):
    username: str
    password: str
    api_key: str
    totp_token: str
    vendor_code: Optional[str] = None
    default_quantity: int
    imei: str

class SymbolDataRequest(BaseModel):
    username: str
    symbol: Optional[str] = None  # e.g., "BANKNIFTY", "RELIANCE-EQ"
    token: Optional[str] = None   # e.g., "12345"
    exchange: str                # e.g., "NSE", "NFO", "BSE", "MCX"
    data_type: str = "market_data"  # "market_data" or "option_chain"
    expiry_date: Optional[str] = None  # Format: DD-MM-YYYY, required for option_chain
    strike_price: Optional[float] = None  # Required for option_chain
    strike_count: Optional[int] = 20  # For option_chain, default 20

smart_api_instances = {}
auth_tokens = {}
ltp_cache = {}
socket_opened = {}
option_chain_subscriptions = {}

def authenticate_user(username: str, password: str, api_key: str, totp_token: str, vendor_code: Optional[str] = None, imei: str = "trading_app"):
    api = ShoonyaApiPy()
    try:
        totp = pyotp.TOTP(totp_token).now()
        logger.info(f"Attempting Shoonya login for {username} with TOTP: {totp}")
        ret = api.login(userid=username, password=password, twoFA=totp, vendor_code=vendor_code, api_secret=api_key, imei=imei)
        if ret is None or ret.get('stat') != 'Ok':
            logger.error(f"Shoonya Authentication failed for {username}: {ret}")
            raise Exception(f"Authentication failed: {ret.get('emsg', 'Unknown error')}")
        return api, ret['susertoken']
    except Exception as e:
        logger.error(f"Shoonya Auth error for {username}: {e}")
        raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")

def full_reauth_user(username: str):
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT password, api_key, totp_token, vendor_code, imei FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    password, api_key, totp_token, vendor_code, imei = user
    api_client, auth_token = authenticate_user(username, password, api_key, totp_token, vendor_code, imei)
    smart_api_instances[username] = api_client
    auth_tokens[username] = auth_token
    socket_opened[username] = False  # Reset WebSocket flag
    logger.info(f"Full session re-authenticated for {username}")
    threading.Thread(target=start_websocket, args=(username, api_key, auth_token), daemon=True).start()
    return api_client

def get_ltp(api_client, exchange: str, tradingsymbol: str, token: str):
    symbol_key = f"{exchange}:{tradingsymbol}:{token}"
    if symbol_key in ltp_cache:
        return ltp_cache[symbol_key]
    quotes = api_client.get_quotes(exchange=exchange, token=token)
    if quotes and quotes.get('stat') == 'Ok' and 'lp' in quotes:
        ltp = float(quotes['lp'])
        ltp_cache[symbol_key] = ltp
        return ltp
    logger.error(f"Shoonya LTP fetch failed for {tradingsymbol}: {quotes}")
    raise HTTPException(status_code=400, detail="No LTP data available")

def on_data_shoonya(message):
    global ltp_cache
    try:
        symbol_key = f"{message['e']}:{message['ts']}:{message['tk']}"
        ltp = float(message.get('lp', 0))
        ltp_cache[symbol_key] = ltp
        if symbol_key in option_chain_subscriptions:
            for ws in option_chain_subscriptions[symbol_key]:
                ws.send_json({
                    "symbol": message['ts'],
                    "token": message['tk'],
                    "exchange": message['e'],
                    "ltp": ltp,
                    "oi": message.get('oi', 0),
                    "volume": message.get('v', 0),
                    "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
                })
    except Exception as e:
        logger.error(f"Shoonya WebSocket data error: {e}")

def on_open_shoonya(username: str):
    socket_opened[username] = True
    logger.info(f"Shoonya WebSocket opened for {username}")

def start_websocket(username: str, api_key: str, auth_token: str):
    api_client = smart_api_instances[username]
    if socket_opened.get(username, False):
        logger.info(f"WebSocket already opened for {username}")
        return
    api_client.start_websocket(
        subscribe_callback=on_data_shoonya,
        order_update_callback=lambda msg: logger.info(f"Order update for {username}: {msg}"),
        socket_open_callback=lambda: on_open_shoonya(username),
        socket_close_callback=lambda: logger.info(f"Shoonya WebSocket closed for {username}")
    )

@app.on_event("startup")
async def startup_event():
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users")
        users = cursor.fetchall()
    for user in users:
        user_data = dict(zip(["username", "password", "api_key", "totp_token", "vendor_code", "default_quantity", "imei"], user))
        api_client, auth_token = authenticate_user(
            user_data['username'], user_data['password'], user_data['api_key'], 
            user_data['totp_token'], user_data['vendor_code'], user_data['imei']
        )
        smart_api_instances[user_data['username']] = api_client
        auth_tokens[user_data['username']] = auth_token
        socket_opened[user_data['username']] = False
        threading.Thread(target=start_websocket, args=(user_data['username'], user_data['api_key'], auth_token), daemon=True).start()

@app.post("/api/register_user")
def register_user(user: User):
    try:
        api_client, auth_token = authenticate_user(
            user.username, user.password, user.api_key, user.totp_token, user.vendor_code, user.imei
        )
        with conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                           (user.username, user.password, user.api_key, user.totp_token, user.vendor_code, user.default_quantity, user.imei))
            conn.commit()
        smart_api_instances[user.username] = api_client
        auth_tokens[user.username] = auth_token
        socket_opened[user.username] = False
        threading.Thread(target=start_websocket, args=(user.username, user.api_key, auth_token), daemon=True).start()
        return {"message": "User registered and authenticated successfully"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="User already exists")
    except Exception as e:
        logger.error(f"Registration failed for {user.username}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")

@app.post("/api/fetch_symbol_data")
async def fetch_symbol_data(request: SymbolDataRequest):
    try:
        username = request.username
        if username not in smart_api_instances:
            logger.warning(f"User {username} not authenticated. Attempting full re-authentication.")
            full_reauth_user(username)

        api_client = smart_api_instances[username]
        exchange = request.exchange.upper()

        if not request.symbol and not request.token:
            raise HTTPException(status_code=400, detail="Either 'symbol' or 'token' must be provided")

        token = request.token
        trading_symbol = request.symbol
        if not token and request.symbol:
            search_query = request.symbol.strip()
            if request.data_type == "option_chain" and request.expiry_date:
                expiry_date = datetime.datetime.strptime(request.expiry_date, '%d-%m-%Y')
                expiry_str = expiry_date.strftime('%d%b%y').upper()
                search_query = f"{search_query} {expiry_str}"
            ret = api_client.searchscrip(exchange=exchange, searchtext=search_query)
            if not ret or 'values' not in ret or not ret['values']:
                raise HTTPException(status_code=400, detail=f"No symbols found for {search_query} in {exchange}")
            trading_symbol = ret['values'][0]['tsym']
            token = ret['values'][0]['token']

        if not token:
            raise HTTPException(status_code=400, detail="Unable to resolve token")

        if request.data_type == "market_data":
            ret = api_client.get_quotes(exchange=exchange, token=token)
            if ret and ret.get('stat') == 'Ok':
                api_client.subscribe(f"{exchange}|{token}")
                return {
                    "symbol": trading_symbol,
                    "token": token,
                    "exchange": exchange,
                    "ltp": float(ret.get('lp', 0)),
                    "oi": ret.get('oi', 0),
                    "volume": ret.get('v', 0),
                    "open": ret.get('op', 0),
                    "high": ret.get('h', 0),
                    "low": ret.get('l', 0),
                    "close": ret.get('c', 0),
                    "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
                }
            raise HTTPException(status_code=400, detail=f"No market data available: {ret.get('emsg', 'Unknown error')}")

        elif request.data_type == "option_chain":
            if not request.expiry_date or not request.strike_price:
                raise HTTPException(status_code=400, detail="expiry_date and strike_price required for option_chain")
            chain = api_client.get_option_chain(
                exchange=exchange,
                tradingsymbol=trading_symbol,
                strikeprice=str(request.strike_price),
                count=str(request.strike_count)
            )
            if not chain or 'values' not in chain:
                error_msg = chain.get('emsg', 'Unknown error') if chain else 'No response'
                if "market" in error_msg.lower() or "closed" in error_msg.lower():
                    return {"message": "Market is closed, no live option chain data", "data": []}
                raise HTTPException(status_code=400, detail=f"No option chain data: {error_msg}")

            chain_data = []
            tokens = []
            for scrip in chain['values']:
                quote = api_client.get_quotes(exchange=scrip['exch'], token=scrip['token'])
                if quote and quote.get('stat') == 'Ok':
                    chain_data.append({
                        "TradingSymbol": scrip['tsym'],
                        "Token": scrip['token'],
                        "StrikePrice": float(scrip.get('strprc', 0)),
                        "OptionType": scrip.get('optt', 'N/A'),
                        "LTP": float(quote.get('lp', 0)),
                        "OI": quote.get('oi', 0),
                        "Volume": quote.get('v', 0)
                    })
                    tokens.append(scrip['token'])

            if tokens:
                symbol_key = f"{exchange}:{trading_symbol}:{token}"
                option_chain_subscriptions[symbol_key] = tokens
                api_client.subscribe(','.join([f"{exchange}|{t}" for t in tokens]))

            return {"message": f"Option chain for {trading_symbol} ({exchange})", "data": chain_data}

        else:
            raise HTTPException(status_code=400, detail="Invalid data_type. Use 'market_data' or 'option_chain'")

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Symbol data fetch error for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.websocket("/ws/market_data/{username}/{exchange}/{token}")
async def websocket_market_data(websocket: WebSocket, username: str, exchange: str, token: str):
    await websocket.accept()
    try:
        if username not in smart_api_instances or not socket_opened.get(username, False):
            await websocket.send_json({"error": "User not authenticated or WebSocket not opened"})
            await websocket.close()
            return

        symbol_key = f"{exchange}:{token}"
        if symbol_key not in option_chain_subscriptions:
            option_chain_subscriptions[symbol_key] = []
        option_chain_subscriptions[symbol_key].append(websocket)

        while True:
            await websocket.receive_text()  # Keep connection alive
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {username}, token {token}")
        if symbol_key in option_chain_subscriptions:
            option_chain_subscriptions[symbol_key].remove(websocket)
            if not option_chain_subscriptions[symbol_key]:
                del option_chain_subscriptions[symbol_key]
    except Exception as e:
        logger.error(f"WebSocket error for user {username}, token {token}: {e}")
        await websocket.close()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)