from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, List
from SmartApi import SmartConnect
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
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
import json

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
            broker TEXT CHECK(broker IN ('AngelOne', 'Shoonya')),
            api_key TEXT,
            totp_token TEXT,
            vendor_code TEXT,
            default_quantity INTEGER,
            imei TEXT
        )
        """)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS open_positions (
            position_id TEXT PRIMARY KEY,
            username TEXT,
            symbol TEXT,
            symboltoken TEXT,
            entry_price REAL,
            buy_threshold REAL,
            stop_loss_type TEXT DEFAULT 'Fixed',
            stop_loss_value REAL DEFAULT 5.0,
            points_condition REAL DEFAULT 0,
            position_type TEXT DEFAULT 'LONG',
            position_active BOOLEAN DEFAULT 1,
            highest_price REAL,
            base_price REAL,
            sell_type TEXT,
            sell_threshold REAL,
            previous_close REAL,
            option_type TEXT DEFAULT 'Call'  # Added to track CE or PE
        )
        """)
    conn.commit()

init_db()

class User(BaseModel):
    username: str
    password: str
    broker: str
    api_key: str
    totp_token: str
    vendor_code: Optional[str] = None
    default_quantity: int
    imei: str

class TradeRequest(BaseModel):
    username: str
    tradingsymbol: str
    symboltoken: str
    exchange: str = "NFO"
    strike_price: float
    option_type: str = "Call"  # Default to Call, user can select Call or Put
    buy_type: str = "Fixed"
    buy_threshold: float = 110
    previous_close: Optional[float] = None
    producttype: str = "INTRADAY"
    stop_loss_type: str = "Fixed"
    stop_loss_value: float = 5.0
    points_condition: float = 0
    sell_type: Optional[str] = "Fixed"
    sell_threshold: Optional[float] = 90

class UpdateTradeRequest(BaseModel):
    username: str
    position_id: str
    stop_loss_type: Optional[str] = "Fixed"
    stop_loss_value: Optional[float] = 5.0
    points_condition: Optional[float] = 0

class OptionChainRequest(BaseModel):
    username: str
    exchange: str
    symbol: str
    expiry_date: str  # Format: DD-MM-YYYY
    strike_price: float
    strike_count: int = 20  # Default to 20 strikes

smart_api_instances = {}
ltp_cache = {}
auth_tokens = {}
refresh_tokens = {}
feed_tokens = {}
option_chain_subscriptions = {}  # Track active WebSocket subscriptions for option chains

def authenticate_user(username: str, password: str, broker: str, api_key: str, totp_token: str, vendor_code: Optional[str] = None, imei: str = "trading_app"):
    if broker == "AngelOne":
        smart_api = SmartConnect(api_key)
        try:
            totp = pyotp.TOTP(totp_token).now()
            logger.info(f"Generated TOTP for {username} (AngelOne): {totp}")
            data = smart_api.generateSession(username, password, totp)
            if data['status'] == False:
                logger.error(f"AngelOne Authentication failed for {username}: {data}")
                raise Exception(f"Authentication failed: {data.get('message', 'Unknown error')}")
            auth_token = data['data']['jwtToken']
            refresh_token = data['data']['refreshToken']
            feed_token = smart_api.getfeedToken()
            return smart_api, auth_token, refresh_token, feed_token
        except Exception as e:
            logger.error(f"AngelOne Auth error for {username}: {e}")
            raise
    elif broker == "Shoonya":
        smart_api = ShoonyaApiPy()
        try:
            totp = pyotp.TOTP(totp_token).now()
            logger.info(f"Attempting Shoonya login for {username} with: username={username}, password={password[:3]}..., twoFA={totp}, vendor_code={vendor_code}, api_secret={api_key[:5]}..., imei={imei}")
            ret = smart_api.login(userid=username, password=password, twoFA=totp, vendor_code=vendor_code, api_secret=api_key, imei=imei)
            logger.info(f"Shoonya login response for {username}: {ret}")
            if ret is None:
                logger.error(f"Shoonya login returned None for {username}")
                raise Exception("Authentication failed: No response from Shoonya API")
            if ret.get('stat') != 'Ok':
                logger.error(f"Shoonya Authentication failed for {username}: {ret}")
                raise Exception(f"Authentication failed: {ret.get('emsg', 'Unknown error')}")
            return smart_api, ret['susertoken'], None, None
        except Exception as e:
            logger.error(f"Shoonya Auth error for {username}: {e}")
            raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")
    raise HTTPException(status_code=400, detail=f"Unsupported broker: {broker}")

def refresh_angelone_session(username: str, api_client: SmartConnect) -> bool:
    if username not in refresh_tokens:
        return False
    try:
        refresh_token = refresh_tokens[username]
        data = api_client.generateToken(refresh_token)
        if data['status'] == False:
            logger.error(f"AngelOne token refresh failed for {username}: {data}")
            return False
        auth_tokens[username] = data['data']['jwtToken']
        feed_tokens[username] = api_client.getfeedToken()
        logger.info(f"Session refreshed for {username} using refresh token")
        return True
    except Exception as e:
        logger.error(f"AngelOne refresh token error for {username}: {e}")
        return False

def full_reauth_user(username: str):
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT password, broker, api_key, totp_token, vendor_code, imei FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    password, broker, api_key, totp_token, vendor_code, imei = user
    api_client, auth_token, refresh_token, feed_token = authenticate_user(username, password, broker, api_key, totp_token, vendor_code, imei)
    smart_api_instances[username] = api_client
    auth_tokens[username] = auth_token
    if broker == "AngelOne":
        refresh_tokens[username] = refresh_token
    feed_tokens[username] = feed_token
    logger.info(f"Full session re-authenticated for {username} ({broker})")
    threading.Thread(target=start_websocket, args=(username, broker, api_key, auth_token, feed_token), daemon=True).start()
    return api_client

def get_ltp(api_client, broker: str, exchange: str, tradingsymbol: str, symboltoken: str):
    symbol_key = f"{exchange}:{tradingsymbol}:{symboltoken}"
    if symbol_key in ltp_cache:
        return ltp_cache[symbol_key]
    if broker == "AngelOne":
        ltp_data = api_client.ltpData(exchange, tradingsymbol, symboltoken)
        if ltp_data and 'data' in ltp_data and 'ltp' in ltp_data['data']:
            ltp = float(ltp_data['data']['ltp'])
            ltp_cache[symbol_key] = ltp
            return ltp
        raise HTTPException(status_code=400, detail="No LTP data available")
    elif broker == "Shoonya":
        quotes = api_client.get_quotes(exchange=exchange, token=symboltoken)
        if quotes and quotes.get('stat') == 'Ok' and 'lp' in quotes:
            ltp = float(quotes['lp'])
            ltp_cache[symbol_key] = ltp
            return ltp
        logger.error(f"Shoonya LTP fetch failed for {tradingsymbol}: {quotes}")
        raise HTTPException(status_code=400, detail="No LTP data available")

def place_order(api_client, broker: str, orderparams: dict, position_type: str, username: str):
    if broker == "AngelOne":
        orderparams["transactiontype"] = "BUY" if position_type == "LONG" else "SELL"
        try:
            response = api_client.placeOrderFullResponse(orderparams)
            logger.debug(f"AngelOne {position_type} order response: {response}")
            if response.get('status') is True and 'data' in response and 'orderid' in response['data']:
                logger.info(f"AngelOne {position_type} order placed: {response['data']['orderid']}")
                return {"order_id": response['data']['orderid'], "status": "success"}
            elif response.get('errorcode') == 'AB1010':
                logger.warning(f"Session expired for {username}. Attempting refresh...")
                if refresh_angelone_session(username, api_client):
                    response = api_client.placeOrderFullResponse(orderparams)
                    if response.get('status') is True and 'data' in response and 'orderid' in response['data']:
                        logger.info(f"AngelOne {position_type} order placed after refresh: {response['data']['orderid']}")
                        return {"order_id": response['data']['orderid'], "status": "success"}
                logger.warning(f"Refresh failed. Performing full re-authentication for {username}")
                api_client = full_reauth_user(username)
                response = api_client.placeOrderFullResponse(orderparams)
                if response.get('status') is True and 'data' in response and 'orderid' in response['data']:
                    logger.info(f"AngelOne {position_type} order placed after re-auth: {response['data']['orderid']}")
                    return {"order_id": response['data']['orderid'], "status": "success"}
            raise HTTPException(status_code=400, detail=f"AngelOne {position_type} order failed: {response.get('message', 'Unknown error')}")
        except HTTPException as e:
            raise e
        except Exception as e:
            logger.error(f"AngelOne {position_type} order error: {e}")
            raise HTTPException(status_code=400, detail=f"Order placement failed: {str(e)}")
    elif broker == "Shoonya":
        orderparams["buy_or_sell"] = "B" if position_type == "LONG" else "S"
        orderparams["price_type"] = "MKT"
        try:
            response = api_client.place_order(**orderparams)
            logger.debug(f"Shoonya {position_type} order response: {response}")
            if response is None:
                logger.error(f"Shoonya {position_type} order returned None for {username}")
                raise HTTPException(status_code=500, detail=f"Shoonya {position_type} order failed: No response from API")
            if response.get('stat') == 'Ok' and 'norenordno' in response:
                logger.info(f"Shoonya {position_type} order placed: {response['norenordno']}")
                return {"order_id": response['norenordno'], "status": "success"}
            if response.get('emsg', '').startswith("Session Expired"):
                logger.warning(f"Session expired for {username}. Re-authenticating...")
                api_client = full_reauth_user(username)
                response = api_client.place_order(**orderparams)
                if response is None:
                    logger.error(f"Shoonya {position_type} order returned None after re-auth for {username}")
                    raise HTTPException(status_code=500, detail=f"Shoonya {position_type} order failed: No response after re-auth")
                if response.get('stat') == 'Ok' and 'norenordno' in response:
                    logger.info(f"Shoonya {position_type} order placed after re-auth: {response['norenordno']}")
                    return {"order_id": response['norenordno'], "status": "success"}
            error_msg = response.get('emsg', 'Unknown error')
            logger.error(f"Shoonya {position_type} order failed for {username}: {error_msg}")
            raise HTTPException(status_code=400, detail=f"Shoonya {position_type} order failed: {error_msg}")
        except HTTPException as e:
            raise e
        except Exception as e:
            logger.error(f"Shoonya {position_type} order exception for {username}: {e}")
            raise HTTPException(status_code=500, detail=f"Order placement failed: {str(e)}")

def update_open_positions(position_id: str, username: str, symbol: str, entry_price: float, conditions: dict):
    with conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO open_positions (position_id, username, symbol, symboltoken, entry_price, buy_threshold, 
                                                  stop_loss_type, stop_loss_value, points_condition, position_type, 
                                                  position_active, highest_price, base_price, sell_type, sell_threshold, previous_close, option_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'LONG', 1, ?, ?, ?, ?, ?, ?)
        """, (position_id, username, symbol, conditions['symboltoken'], entry_price, conditions['buy_threshold'], 
              conditions['stop_loss_type'], conditions['stop_loss_value'], conditions['points_condition'],
              entry_price, entry_price, conditions.get('sell_type'), conditions.get('sell_threshold'), conditions.get('previous_close'), conditions['option_type']))
        conn.commit()

def on_data_angel(wsapp, message):
    global ltp_cache
    try:
        symbol_key = f"{message['exchange']}:{message['tradingsymbol']}:{message['symboltoken']}"
        ltp = float(message['ltp'])
        oi = message.get('oi', 0)
        volume = message.get('v', 0)
        ltp_cache[symbol_key] = ltp
        process_position_update(message['tradingsymbol'], ltp)
        # Broadcast update to WebSocket clients for option chain
        if symbol_key in option_chain_subscriptions:
            for ws in option_chain_subscriptions[symbol_key]:
                ws.send_json({
                    "symbol": message['tradingsymbol'],
                    "ltp": ltp,
                    "oi": oi,
                    "volume": volume,
                    "timestamp": time.strftime('%Y-%m-%d %H:%M:%S'),
                    "option_type": message.get('optt', 'N/A')
                })
    except Exception as e:
        logger.error(f"AngelOne WebSocket data error: {e}")

def on_data_shoonya(tick_data):
    global ltp_cache
    try:
        symbol_key = f"{tick_data['e']}:{tick_data['ts']}:{tick_data['tk']}"
        ltp = float(tick_data['lp'])
        oi = tick_data.get('oi', 0)
        volume = tick_data.get('v', 0)
        ltp_cache[symbol_key] = ltp
        process_position_update(tick_data['ts'], ltp)
        # Broadcast update to WebSocket clients for option chain
        if symbol_key in option_chain_subscriptions:
            for ws in option_chain_subscriptions[symbol_key]:
                ws.send_json({
                    "symbol": tick_data['ts'],
                    "ltp": ltp,
                    "oi": oi,
                    "volume": volume,
                    "timestamp": time.strftime('%Y-%m-%d %H:%M:%S'),
                    "option_type": tick_data.get('optt', 'N/A')
                })
    except Exception as e:
        logger.error(f"Shoonya WebSocket data error: {e}")

def process_position_update(tradingsymbol: str, ltp: float):
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM open_positions WHERE symbol = ? AND position_active = 1", (tradingsymbol,))
        positions = cursor.fetchall()
    for position in positions:
        pos_data = dict(zip(["position_id", "username", "symbol", "symboltoken", "entry_price", "buy_threshold", "stop_loss_type", 
                             "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price", 
                             "sell_type", "sell_threshold", "previous_close", "option_type"], position))
        username = pos_data['username']
        if username in smart_api_instances:
            api_client = smart_api_instances[username]
            check_conditions(api_client, pos_data, ltp, username)

def on_open_angel(wsapp):
    logger.info("AngelOne WebSocket opened")
    subscribe_to_tokens(wsapp, 1)

def on_open_shoonya():
    logger.info("Shoonya WebSocket opened")
    subscribe_to_tokens(None, None)

def subscribe_to_tokens(wsapp, exchange_type):
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT symboltoken FROM open_positions WHERE position_active = 1")
        tokens = [row[0] for row in cursor.fetchall()]
    if tokens:
        if wsapp:  # AngelOne
            token_list = [{"exchangeType": exchange_type, "tokens": tokens}]
            wsapp.subscribe("abc123", 1, token_list)
        else:  # Shoonya
            for token in tokens:
                smart_api_instances[list(smart_api_instances.keys())[0]].subscribe(f"NSE|{token}")

def start_websocket(username: str, broker: str, api_key: str, auth_token: str, feed_token: Optional[str] = None):
    if broker == "AngelOne":
        sws = SmartWebSocketV2(auth_token, api_key, username, feed_token)
        sws.on_open = on_open_angel
        sws.on_data = on_data_angel
        sws.on_error = lambda wsapp, error: logger.error(f"AngelOne WebSocket error: {error}")
        sws.on_close = lambda wsapp: logger.info("AngelOne WebSocket closed")
        sws.connect()
    elif broker == "Shoonya":
        api_client = smart_api_instances[username]
        api_client.start_websocket(
            subscribe_callback=on_data_shoonya,
            order_update_callback=lambda order: logger.info(f"Shoonya order update: {order}"),
            socket_open_callback=on_open_shoonya,
            socket_close_callback=lambda: logger.info("Shoonya WebSocket closed")
        )

def check_conditions(api_client, position_data: dict, ltp: float, username: str):
    stop_loss_price = None
    highest_price = max(ltp, position_data['highest_price'])
    base_price = position_data['base_price']
    if position_data['stop_loss_type'] == "Fixed":
        stop_loss_price = position_data['entry_price'] - position_data['stop_loss_value']
    elif position_data['stop_loss_type'] in ["Percentage", "Points"]:
        if position_data['points_condition'] < 0 and ltp < base_price + position_data['points_condition']:
            base_price = ltp
        profit = highest_price - base_price
        if position_data['stop_loss_type'] == "Percentage":
            stop_loss_price = base_price + (profit * (1 - position_data['stop_loss_value'] / 100))
        elif position_data['stop_loss_type'] == "Points":
            stop_loss_price = highest_price - position_data['stop_loss_value']

    sell_price = None
    if position_data.get('sell_type') == "Fixed" and position_data.get('sell_threshold'):
        sell_price = position_data['sell_threshold']
    elif position_data.get('sell_type') == "Percentage" and position_data.get('sell_threshold') and position_data.get('previous_close'):
        sell_price = position_data['previous_close'] * (1 - position_data['sell_threshold'] / 100)

    with conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE open_positions SET highest_price = ?, base_price = ? WHERE position_id = ?", 
                       (highest_price, base_price, position_data['position_id']))
        conn.commit()

    if (stop_loss_price and ltp <= stop_loss_price) or (sell_price and ltp <= sell_price):
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT broker FROM users WHERE username = ?", (username,))
            broker = cursor.fetchone()[0]
        orderparams = {
            "variety": "NORMAL",
            "tradingsymbol": position_data['symbol'],
            "symboltoken": position_data['symboltoken'],
            "transactiontype": "SELL" if broker == "AngelOne" else "S",
            "exchange": "NSE",
            "ordertype": "MARKET" if broker == "AngelOne" else "MKT",
            "producttype": "INTRADAY",
            "duration": "DAY",
            "price": "0",
            "quantity": "1",
            "squareoff": "0",
            "stoploss": "0"
        } if broker == "AngelOne" else {
            "buy_or_sell": "S",
            "product_type": "I",
            "exchange": "NSE",
            "tradingsymbol": position_data['symbol'],
            "quantity": 1,
            "price_type": "MKT",
            "price": 0,
            "retention": "DAY"
        }
        place_order(api_client, broker, orderparams, "EXIT", username)
        with conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE open_positions SET position_active = 0 WHERE position_id = ?", (position_data['position_id'],))
            conn.commit()
        logger.info(f"Stop-loss or sell threshold hit for {username}. Sold at {ltp}")

@app.on_event("startup")
async def startup_event():
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users LIMIT 3")
        users = cursor.fetchall()
    for user in users:
        user_data = dict(zip(["username", "password", "broker", "api_key", "totp_token", "vendor_code", "default_quantity", "imei"], user))
        api_client, auth_token, refresh_token, feed_token = authenticate_user(
            user_data['username'], user_data['password'], user_data['broker'], 
            user_data['api_key'], user_data['totp_token'], user_data['vendor_code'], user_data['imei']
        )
        smart_api_instances[user_data['username']] = api_client
        auth_tokens[user_data['username']] = auth_token
        if user_data['broker'] == "AngelOne":
            refresh_tokens[user_data['username']] = refresh_token
        feed_tokens[user_data['username']] = feed_token
        threading.Thread(target=start_websocket, args=(user_data['username'], user_data['broker'], user_data['api_key'], auth_token, feed_token), daemon=True).start()

@app.post("/api/register_user")
def register_user(user: User):
    try:
        logger.info(f"Attempting to register user: {user.username}")
        api_client, auth_token, refresh_token, feed_token = authenticate_user(
            user.username, user.password, user.broker, user.api_key, user.totp_token, user.vendor_code, user.imei
        )
        logger.info(f"Authentication successful for {user.username}. Storing in database...")
        with conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                           (user.username, user.password, user.broker, user.api_key, user.totp_token, user.vendor_code, user.default_quantity, user.imei))
            conn.commit()
        logger.info(f"User {user.username} inserted into database. Starting WebSocket...")
        smart_api_instances[user.username] = api_client
        auth_tokens[user.username] = auth_token
        if user.broker == "AngelOne":
            refresh_tokens[user.username] = refresh_token
        feed_tokens[user.username] = feed_token
        try:
            threading.Thread(target=start_websocket, args=(user.username, user.broker, user.api_key, auth_token, feed_token), daemon=True).start()
            logger.info(f"WebSocket thread started for {user.username}")
        except Exception as e:
            logger.error(f"Failed to start WebSocket for {user.username}: {e}")
        return {"message": "User registered and authenticated successfully"}
    except sqlite3.IntegrityError:
        logger.error(f"Database error: User {user.username} already exists")
        raise HTTPException(status_code=400, detail="User already exists")
    except Exception as e:
        logger.error(f"Registration failed for {user.username}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")

@app.get("/api/get_users")
def get_users():
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users")
        users = cursor.fetchall()
    return {"users": [dict(zip(["username", "password", "broker", "api_key", "totp_token", "vendor_code", "default_quantity", "imei"], row)) for row in users]}

@app.delete("/api/delete_user/{username}")
def delete_user(username: str):
    with conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE username = ?", (username,))
        cursor.execute("DELETE FROM open_positions WHERE username = ?", (username,))
        conn.commit()
    if username in smart_api_instances:
        del smart_api_instances[username]
    if username in auth_tokens:
        del auth_tokens[username]
    if username in refresh_tokens:
        del refresh_tokens[username]
    if username in feed_tokens:
        del feed_tokens[username]
    return {"message": f"User {username} deleted successfully"}

@app.get("/api/get_trades")
def get_trades():
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM open_positions WHERE position_active = 1")
        trades = cursor.fetchall()
    return {"trades": [dict(zip(["position_id", "username", "symbol", "symboltoken", "entry_price", "buy_threshold", "stop_loss_type", 
                                 "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price", 
                                 "sell_type", "sell_threshold", "previous_close", "option_type"], row)) for row in trades]}

@app.post("/api/initiate_buy_trade")
async def initiate_trade(request: TradeRequest):
    try:
        username = request.username
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail="User not authenticated")
        
        api_client = smart_api_instances[username]
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT broker, default_quantity FROM users WHERE username = ?", (username,))
            user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        broker, default_quantity = user
        
        params = request.dict()
        strike_price = params['strike_price']
        option_type = params['option_type'].upper()  # Ensure "Call" or "Put"
        buy_type = params['buy_type']
        buy_threshold = params['buy_threshold']
        previous_close = params.get('previous_close', strike_price)
        entry_threshold = buy_threshold if buy_type == "Fixed" else previous_close * (1 + buy_threshold / 100)
        ltp = get_ltp(api_client, broker, params['exchange'], params['tradingsymbol'], params['symboltoken'])
        if ltp < entry_threshold:
            raise HTTPException(status_code=400, detail=f"Current LTP {ltp} below buy threshold {entry_threshold}")

        buy_order_params = (
            {
                "variety": "NORMAL",
                "tradingsymbol": params['tradingsymbol'],
                "symboltoken": params['symboltoken'],
                "transactiontype": "BUY",
                "exchange": params['exchange'],
                "ordertype": "MARKET",
                "producttype": params['producttype'],
                "duration": "DAY",
                "price": "0",
                "quantity": str(default_quantity),
                "squareoff": "0",
                "stoploss": "0"
            } if broker == "AngelOne" else {
                "buy_or_sell": "B",
                "product_type": "I" if params['producttype'] == "INTRADAY" else params['producttype'],
                "exchange": params['exchange'],
                "tradingsymbol": params['tradingsymbol'],
                "quantity": default_quantity,
                "discloseqty": 0,
                "price_type": "MKT",
                "price": 0,
                "retention": "DAY"
            }
        )
        buy_result = place_order(api_client, broker, buy_order_params, "LONG", username)
        if buy_result is None:
            logger.error(f"Trade initiation failed for {username}: place_order returned None")
            raise HTTPException(status_code=500, detail="Order placement failed: No response from broker API")
        entry_price = ltp

        conditions = {
            'buy_threshold': entry_threshold,
            'stop_loss_type': params['stop_loss_type'],
            'stop_loss_value': params['stop_loss_value'],
            'points_condition': params['points_condition'],
            'symboltoken': params['symboltoken'],
            'sell_type': params.get('sell_type'),
            'sell_threshold': params.get('sell_threshold'),
            'previous_close': params.get('previous_close'),
            'option_type': option_type  # Store the selected option type
        }

        position_id = f"{username}_{params['tradingsymbol']}_{int(time.time())}"
        update_open_positions(position_id, username, params['tradingsymbol'], entry_price, conditions)
        return {"message": f"LONG trade initiated for {username} ({option_type})", "data": buy_result, "position_id": position_id}

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Trade initiation error for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/api/update_trade_conditions")
async def update_trade_conditions(request: UpdateTradeRequest):
    try:
        username = request.username
        position_id = request.position_id
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM open_positions WHERE position_id = ? AND position_active = 1", (position_id,))
            position = cursor.fetchone()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found or closed")
        
        pos_data = dict(zip(["position_id", "username", "symbol", "symboltoken", "entry_price", "buy_threshold", "stop_loss_type", 
                             "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price", 
                             "sell_type", "sell_threshold", "previous_close", "option_type"], position))
        if pos_data['username'] != username:
            raise HTTPException(status_code=403, detail="Unauthorized to modify this position")

        params = request.dict()
        stop_loss_type = params.get('stop_loss_type', pos_data['stop_loss_type'])
        stop_loss_value = params.get('stop_loss_value', pos_data['stop_loss_value'])
        points_condition = params.get('points_condition', pos_data['points_condition'])

        with conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE open_positions SET stop_loss_type = ?, stop_loss_value = ?, points_condition = ?
                WHERE position_id = ?
            """, (stop_loss_type, stop_loss_value, points_condition, position_id))
            conn.commit()

        return {"message": f"Conditions updated for position {position_id}", 
                "conditions": {"stop_loss_type": stop_loss_type, "stop_loss_value": stop_loss_value, "points_condition": points_condition}}

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Condition update error for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/api/get_shoonya_option_chain")
async def get_shoonya_option_chain_endpoint(request: OptionChainRequest):
    try:
        username = request.username
        if username not in smart_api_instances:
            logger.warning(f"User {username} not authenticated. Attempting full re-authentication.")
            full_reauth_user(username)
        
        api_client = smart_api_instances[username]
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT broker FROM users WHERE username = ?", (username,))
            broker = cursor.fetchone()[0]
        
        if broker != "Shoonya":
            raise HTTPException(status_code=400, detail="Option chain data is only available for Shoonya broker")

        # Parse expiry date
        try:
            expiry_date = datetime.datetime.strptime(request.expiry_date, '%d-%m-%Y')
        except ValueError:
            logger.error(f"Invalid expiry date format for {username}: {request.expiry_date}")
            raise HTTPException(status_code=400, detail="Invalid date format. Please use DD-MM-YYYY")

        # Clean symbol input
        symbol = request.symbol.strip(',').strip()
        expiry_str = expiry_date.strftime('%d%b%y').upper()
        search_query = f"{symbol} {expiry_str}"
        logger.info(f"Searching for {search_query} for user {username}")
        search_result = api_client.searchscrip(exchange=request.exchange, searchtext=search_query)
        
        if not search_result or 'values' not in search_result or not search_result['values']:
            logger.error(f"No symbols found for {search_query} for user {username}")
            raise HTTPException(status_code=400, detail=f"No symbols found for {search_query}")

        base_symbol = search_result['values'][0]['tsym']
        logger.info(f"Using base symbol: {base_symbol} for user {username}")

        # Fetch option chain with enough strikes to cover user request (up to 40 to ensure we can cap at 20)
        chain = api_client.get_option_chain(
            exchange=request.exchange,
            tradingsymbol=base_symbol,
            strikeprice=str(request.strike_price),
            count=str(max(40, request.strike_count * 2))  # Fetch up to 40 to ensure we can cap at 20
        )

        if not chain or 'values' not in chain:
            error_msg = chain.get('emsg', 'Unknown error') if chain else 'No response'
            logger.error(f"No option chain data available for {base_symbol}: {error_msg}")
            if "market" in error_msg.lower() or "closed" in error_msg.lower():
                return {"message": "Market is closed, no live option chain data available", "data": []}
            raise HTTPException(status_code=400, detail=f"No option chain data available: {error_msg}")

        # Collect initial chain data
        chain_data = []
        tokens = []
        for scrip in chain['values']:
            quote = api_client.get_quotes(exchange=scrip['exch'], token=scrip['token'])
            if quote:
                chain_data.append({
                    'TradingSymbol': scrip['tsym'],
                    'Token': scrip['token'],
                    'StrikePrice': float(scrip.get('strprc', '0')),
                    'OptionType': scrip.get('optt', 'N/A'),
                    'LTP': quote.get('lp', 'N/A'),
                    'OI': quote.get('oi', 'N/A'),  # Include OI
                    'Open': quote.get('op', 'N/A'),
                    'High': quote.get('h', 'N/A'),
                    'Low': quote.get('l', 'N/A'),
                    'Close': quote.get('c', 'N/A'),
                    'Volume': quote.get('v', 'N/A')
                })
                tokens.append(scrip['token'])

        # Group data by strike price for CE and PE
        grouped_data = {}
        for item in chain_data:
            strike = item['StrikePrice']
            if strike not in grouped_data:
                grouped_data[strike] = {'CE': None, 'PE': None}
            if item['OptionType'] == 'CE':
                grouped_data[strike]['CE'] = item
            else:
                grouped_data[strike]['PE'] = item

        # Filter to exactly strike_count strikes, capped at 20 (10 CE, 10 PE)
        effective_strike_count = min(request.strike_count, 20)  # Cap at 20
        strikes = list(grouped_data.keys())
        strikes.sort(key=lambda x: abs(x - request.strike_price))
        filtered_strikes = strikes[:effective_strike_count]  # Take user-specified number, max 20

        # Format response with paired CE and PE data
        formatted_data = []
        for strike in filtered_strikes:
            ce_data = grouped_data[strike]['CE']
            pe_data = grouped_data[strike]['PE']
            row = {
                'StrikePrice': strike,
                'Call_LTP': ce_data['LTP'] if ce_data else 'N/A',
                'Call_OI': ce_data['OI'] if ce_data else 'N/A',
                'Call_Volume': ce_data['Volume'] if ce_data else 'N/A',
                'Call_Token': ce_data['Token'] if ce_data else 'N/A',
                'Put_LTP': pe_data['LTP'] if pe_data else 'N/A',
                'Put_OI': pe_data['OI'] if pe_data else 'N/A',
                'Put_Volume': pe_data['Volume'] if pe_data else 'N/A',
                'Put_Token': pe_data['Token'] if pe_data else 'N/A',
                'Timestamp': time.strftime('%Y-%m-%d %H:%M:%S')
            }
            formatted_data.append(row)

        # Subscribe to real-time updates for these tokens
        if tokens:
            option_chain_subscriptions[username] = tokens  # Store tokens for this user
            api_client.subscribe(','.join(tokens))  # Subscribe to all tokens in the option chain

        return {"message": f"Option chain data for {symbol} with expiry {expiry_str} (Limited to 20 strikes max)", "data": formatted_data}

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Option chain fetch error for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.websocket("/ws/option_chain/{username}/{token}")
async def websocket_option_chain(websocket: WebSocket, username: str, token: str):
    await websocket.accept()
    try:
        if username not in smart_api_instances or username not in option_chain_subscriptions:
            await websocket.send_json({"error": "User not authenticated or no active subscription"})
            await websocket.close()
            return

        # Add WebSocket to the subscription for this token
        symbol_key = f"NFO:{token}"  # Adjust exchange as needed
        if symbol_key not in option_chain_subscriptions:
            option_chain_subscriptions[symbol_key] = []
        option_chain_subscriptions[symbol_key].append(websocket)

        while True:
            # This will rely on the on_data_shoonya callback to push updates
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

@app.get("/api/get_market_data/{username}/{token}")
async def get_market_data(username: str, token: str):
    try:
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail="User not authenticated")

        api_client = smart_api_instances[username]
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT broker FROM users WHERE username = ?", (username,))
            broker = cursor.fetchone()[0]

        if broker != "Shoonya":
            raise HTTPException(status_code=400, detail="Market data is only available for Shoonya broker")

        # Fetch real-time market data for the token
        quotes = api_client.get_quotes(exchange="NFO", token=token)  # Adjust exchange as needed
        if quotes and quotes.get('stat') == 'Ok':
            return {
                "ltp": float(quotes.get('lp', 0)),
                "oi": quotes.get('oi', 0),
                "market_data": {
                    "v": quotes.get('v', 0),  # Volume
                    "ft": time.strftime('%Y-%m-%d %H:%M:%S')  # Fetch time
                }
            }
        raise HTTPException(status_code=400, detail="No market data available for this token")
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Market data fetch error for {username}, token {token}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

def on_data_angel(wsapp, message):
    global ltp_cache
    try:
        symbol_key = f"{message['exchange']}:{message['tradingsymbol']}:{message['symboltoken']}"
        ltp = float(message['ltp'])
        oi = message.get('oi', 0)
        volume = message.get('v', 0)
        ltp_cache[symbol_key] = ltp
        process_position_update(message['tradingsymbol'], ltp)
        # Broadcast update to WebSocket clients for option chain
        if symbol_key in option_chain_subscriptions:
            for ws in option_chain_subscriptions[symbol_key]:
                ws.send_json({
                    "symbol": message['tradingsymbol'],
                    "ltp": ltp,
                    "oi": oi,
                    "volume": volume,
                    "timestamp": time.strftime('%Y-%m-%d %H:%M:%S'),
                    "option_type": message.get('optt', 'N/A')
                })
    except Exception as e:
        logger.error(f"AngelOne WebSocket data error: {e}")

def on_data_shoonya(tick_data):
    global ltp_cache
    try:
        symbol_key = f"{tick_data['e']}:{tick_data['ts']}:{tick_data['tk']}"
        ltp = float(tick_data['lp'])
        oi = tick_data.get('oi', 0)
        volume = tick_data.get('v', 0)
        ltp_cache[symbol_key] = ltp
        process_position_update(tick_data['ts'], ltp)
        # Broadcast update to WebSocket clients for option chain
        if symbol_key in option_chain_subscriptions:
            for ws in option_chain_subscriptions[symbol_key]:
                ws.send_json({
                    "symbol": tick_data['ts'],
                    "ltp": ltp,
                    "oi": oi,
                    "volume": volume,
                    "timestamp": time.strftime('%Y-%m-%d %H:%M:%S'),
                    "option_type": tick_data.get('optt', 'N/A')
                })
    except Exception as e:
        logger.error(f"Shoonya WebSocket data error: {e}")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))  # Use Render's PORT or default to 8001 locally
    uvicorn.run(app, host="0.0.0.0", port=port)