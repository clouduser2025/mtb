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
import re

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

conn = sqlite3.connect("trading_multi.db", check_same_thread=False)

# Global variables to store symbol data
nse_symbols = pd.DataFrame()
nfo_symbols = pd.DataFrame()
mcx_symbols = pd.DataFrame()
bse_symbols = pd.DataFrame()
cds_symbols = pd.DataFrame()
bfo_symbols = pd.DataFrame()

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
            exchange TEXT
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
    exchange: str = "NSE"
    strike_price: Optional[float] = None
    buy_type: str = "Fixed"
    buy_threshold: float = 0
    previous_close: Optional[float] = None
    producttype: str = "INTRADAY"
    stop_loss_type: str = "Fixed"
    stop_loss_value: float = 5.0
    points_condition: float = 0
    sell_type: str = "Fixed"
    sell_threshold: float = 90

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
    expiry_date: str
    strike_price: Optional[float] = None
    strike_count: Optional[int] = 20

smart_api_instances = {}
ltp_cache = {}
auth_tokens = {}
refresh_tokens = {}
feed_tokens = {}
option_chain_subscriptions = {}

def load_symbol_data():
    global nse_symbols, nfo_symbols, mcx_symbols, bse_symbols, cds_symbols, bfo_symbols
    base_path = os.path.dirname(os.path.abspath(__file__))
    nse_file_path = os.path.join(base_path, "data", "NSE_symbols.txt")
    nfo_file_path = os.path.join(base_path, "data", "NFO_symbols.txt")
    mcx_file_path = os.path.join(base_path, "data", "MCX_symbols.txt")
    bse_file_path = os.path.join(base_path, "data", "BSE_symbols.txt")
    cds_file_path = os.path.join(base_path, "data", "CDS_symbols.txt")
    bfo_file_path = os.path.join(base_path, "data", "BFO_symbols.txt")
    
    if os.path.exists(nse_file_path):
        try:
            nse_symbols = pd.read_csv(nse_file_path)
            logger.info(f"Loaded NSE symbols: {len(nse_symbols)} entries from {nse_file_path}")
        except Exception as e:
            logger.error(f"Failed to load NSE symbols from {nse_file_path}: {e}")
            nse_symbols = pd.DataFrame()
    else:
        logger.warning(f"NSE symbols file not found at {nse_file_path}. Proceeding with empty NSE symbols.")
        nse_symbols = pd.DataFrame()

    if os.path.exists(nfo_file_path):
        try:
            nfo_symbols = pd.read_csv(nfo_file_path)
            logger.info(f"Loaded NFO symbols: {len(nfo_symbols)} entries from {nfo_file_path}")
        except Exception as e:
            logger.error(f"Failed to load NFO symbols from {nfo_file_path}: {e}")
            nfo_symbols = pd.DataFrame()
    else:
        logger.warning(f"NFO symbols file not found at {nfo_file_path}. Proceeding with empty NFO symbols.")
        nfo_symbols = pd.DataFrame()

    if os.path.exists(mcx_file_path):
        try:
            mcx_symbols = pd.read_csv(mcx_file_path)
            logger.info(f"Loaded MCX symbols: {len(mcx_symbols)} entries from {mcx_file_path}")
        except Exception as e:
            logger.error(f"Failed to load MCX symbols from {mcx_file_path}: {e}")
            mcx_symbols = pd.DataFrame()
    else:
        logger.warning(f"MCX symbols file not found at {mcx_file_path}. Proceeding with empty MCX symbols.")
        mcx_symbols = pd.DataFrame()

    if os.path.exists(bse_file_path):
        try:
            bse_symbols = pd.read_csv(bse_file_path)
            logger.info(f"Loaded BSE symbols: {len(bse_symbols)} entries from {bse_file_path}")
        except Exception as e:
            logger.error(f"Failed to load BSE symbols from {bse_file_path}: {e}")
            bse_symbols = pd.DataFrame()
    else:
        logger.warning(f"BSE symbols file not found at {bse_file_path}. Proceeding with empty BSE symbols.")
        bse_symbols = pd.DataFrame()

    if os.path.exists(cds_file_path):
        try:
            cds_symbols = pd.read_csv(cds_file_path)
            logger.info(f"Loaded CDS symbols: {len(cds_symbols)} entries from {cds_file_path}")
        except Exception as e:
            logger.error(f"Failed to load CDS symbols from {cds_file_path}: {e}")
            cds_symbols = pd.DataFrame()
    else:
        logger.warning(f"CDS symbols file not found at {cds_file_path}. Proceeding with empty CDS symbols.")
        cds_symbols = pd.DataFrame()

    if os.path.exists(bfo_file_path):
        try:
            bfo_symbols = pd.read_csv(bfo_file_path)
            logger.info(f"Loaded BFO symbols: {len(bfo_symbols)} entries from {bfo_file_path}")
        except Exception as e:
            logger.error(f"Failed to load BFO symbols from {bfo_file_path}: {e}")
            bfo_symbols = pd.DataFrame()
    else:
        logger.warning(f"BFO symbols file not found at {bfo_file_path}. Proceeding with empty BFO symbols.")
        bfo_symbols = pd.DataFrame()

def find_symbols(exchange: str, symbol: str, expiry_date: str = None):
    if exchange == "NSE" and not nse_symbols.empty:
        df = nse_symbols
        filtered = df[df['Symbol'].str.contains(symbol, case=False, na=False) | 
                      df['TradingSymbol'].str.contains(symbol, case=False, na=False)]
        return filtered.to_dict('records') if not filtered.empty else []
    
    elif exchange == "NFO" and not nfo_symbols.empty:
        df = nfo_symbols
        filtered = df[df['Symbol'].str.contains(symbol, case=False, na=False) | 
                      df['TradingSymbol'].str.contains(symbol, case=False, na=False)]
        if expiry_date:
            try:
                expiry_dt = datetime.datetime.strptime(expiry_date, '%d-%m-%Y')
                expiry_str = expiry_dt.strftime('%d-%b-%Y').upper()
                filtered = filtered[filtered['Expiry'] == expiry_str]
            except ValueError:
                logger.error(f"Invalid expiry date format: {expiry_date}")
                return []
        return filtered.to_dict('records') if not filtered.empty else []
    
    elif exchange == "MCX" and not mcx_symbols.empty:
        df = mcx_symbols
        filtered = df[df['Symbol'].str.contains(symbol, case=False, na=False) | 
                      df['TradingSymbol'].str.contains(symbol, case=False, na=False)]
        if expiry_date:
            try:
                expiry_dt = datetime.datetime.strptime(expiry_date, '%d-%m-%Y')
                expiry_str = expiry_dt.strftime('%d-%b-%Y').upper()
                filtered = filtered[filtered['Expiry'] == expiry_str]
            except ValueError:
                logger.error(f"Invalid expiry date format: {expiry_date}")
                return []
        return filtered.to_dict('records') if not filtered.empty else []
    
    elif exchange == "BSE" and not bse_symbols.empty:
        df = bse_symbols
        filtered = df[df['Symbol'].str.contains(symbol, case=False, na=False) | 
                      df['TradingSymbol'].str.contains(symbol, case=False, na=False)]
        return filtered.to_dict('records') if not filtered.empty else []
    
    elif exchange == "CDS" and not cds_symbols.empty:
        df = cds_symbols
        filtered = df[df['Symbol'].str.contains(symbol, case=False, na=False) | 
                      df['TradingSymbol'].str.contains(symbol, case=False, na=False)]
        if expiry_date:
            try:
                expiry_dt = datetime.datetime.strptime(expiry_date, '%d-%m-%Y')
                expiry_str = expiry_dt.strftime('%d-%b-%Y').upper()
                filtered = filtered[filtered['Expiry'] == expiry_str]
            except ValueError:
                logger.error(f"Invalid expiry date format: {expiry_date}")
                return []
        return filtered.to_dict('records') if not filtered.empty else []
    
    elif exchange == "BFO" and not bfo_symbols.empty:
        df = bfo_symbols
        filtered = df[df['Symbol'].str.contains(symbol, case=False, na=False) | 
                      df['TradingSymbol'].str.contains(symbol, case=False, na=False)]
        if expiry_date:
            try:
                expiry_dt = datetime.datetime.strptime(expiry_date, '%d-%m-%Y')
                expiry_str = expiry_dt.strftime('%d-%b-%Y').upper()
                filtered = filtered[filtered['Expiry'] == expiry_str]
            except ValueError:
                logger.error(f"Invalid expiry date format: {expiry_date}")
                return []
        return filtered.to_dict('records') if not filtered.empty else []
    
    logger.warning(f"No symbol data available for {exchange} or symbol {symbol}")
    return []

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
                                                  position_active, highest_price, base_price, sell_type, sell_threshold, 
                                                  previous_close, exchange)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'LONG', 1, ?, ?, ?, ?, ?, ?)
        """, (position_id, username, symbol, conditions['symboltoken'], entry_price, conditions['buy_threshold'], 
              conditions['stop_loss_type'], conditions['stop_loss_value'], conditions['points_condition'],
              entry_price, entry_price, conditions.get('sell_type'), conditions.get('sell_threshold'), 
              conditions.get('previous_close'), conditions.get('exchange', 'NSE')))
        conn.commit()

def on_data_angel(wsapp, message):
    global ltp_cache
    try:
        symbol_key = f"{message['exchange']}:{message['tradingsymbol']}:{message['symboltoken']}"
        ltp = float(message['ltp'])
        oi = float(message.get('oi', 0))
        volume = float(message.get('v', 0))
        timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
        ltp_cache[symbol_key] = ltp
        process_position_update(message['tradingsymbol'], ltp)
        if symbol_key in option_chain_subscriptions:
            for ws in option_chain_subscriptions[symbol_key]:
                ws.send_json({"symbol": message['tradingsymbol'], "ltp": ltp, "oi": oi, "volume": volume, "timestamp": timestamp})
    except Exception as e:
        logger.error(f"AngelOne WebSocket data error: {e}")

def on_data_shoonya(tick_data):
    global ltp_cache
    try:
        symbol_key = f"{tick_data['e']}:{tick_data['ts']}:{tick_data['tk']}"
        ltp = float(tick_data['lp'])
        oi = float(tick_data.get('oi', 0))
        volume = float(tick_data.get('v', 0))
        timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
        ltp_cache[symbol_key] = ltp
        process_position_update(tick_data['ts'], ltp)
        if symbol_key in option_chain_subscriptions:
            for ws in option_chain_subscriptions[symbol_key]:
                ws.send_json({"symbol": tick_data['ts'], "ltp": ltp, "oi": oi, "volume": volume, "timestamp": timestamp})
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
                             "sell_type", "sell_threshold", "previous_close", "exchange"], position))
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
            logger.info(f"AngelOne subscribed to tokens: {tokens}")
        else:  # Shoonya
            for token in tokens:
                smart_api_instances[list(smart_api_instances.keys())[0]].subscribe(f"{token}")
                logger.info(f"Shoonya subscribed to token: {token}")

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
    entry_price = position_data['entry_price']
    buy_threshold = position_data['buy_threshold']
    stop_loss_type = position_data['stop_loss_type']
    stop_loss_value = position_data['stop_loss_value']
    points_condition = position_data['points_condition']
    sell_type = position_data.get('sell_type')
    sell_threshold = position_data.get('sell_threshold')
    highest_price = position_data['highest_price']
    base_price = position_data['base_price']
    previous_close = position_data['previous_close']

    # Update highest_price and base_price for trailing stop
    highest_price = max(ltp, highest_price)
    if points_condition < 0 and ltp < base_price + points_condition:
        base_price = ltp

    # Calculate stop-loss price
    stop_loss_price = None
    if stop_loss_type == "Fixed":
        stop_loss_price = entry_price - stop_loss_value
    elif stop_loss_type == "Percentage":
        profit = highest_price - base_price
        stop_loss_price = base_price + (profit * (1 - stop_loss_value / 100)) if profit > 0 else entry_price - (entry_price * stop_loss_value / 100)
    elif stop_loss_type == "Points":
        stop_loss_price = highest_price - stop_loss_value

    # Calculate sell threshold
    sell_price = None
    if sell_type == "Fixed":
        sell_price = sell_threshold
    elif sell_type == "Percentage":
        sell_price = previous_close * (1 - sell_threshold / 100)

    # Update database with new highest_price and base_price
    with conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE open_positions SET highest_price = ?, base_price = ? WHERE position_id = ?", 
                       (highest_price, base_price, position_data['position_id']))
        conn.commit()

    # Check conditions for action
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT broker FROM users WHERE username = ?", (username,))
        broker = cursor.fetchone()[0]

    if ltp >= buy_threshold and position_data['position_active'] == 0:  # Initial buy condition
        orderparams = {
            "variety": "NORMAL",
            "tradingsymbol": position_data['symbol'],
            "symboltoken": position_data['symboltoken'],
            "transactiontype": "BUY" if broker == "AngelOne" else "B",
            "exchange": position_data['exchange'],
            "ordertype": "MARKET" if broker == "AngelOne" else "MKT",
            "producttype": "INTRADAY",
            "duration": "DAY",
            "price": "0",
            "quantity": "1",
            "squareoff": "0",
            "stoploss": "0"
        } if broker == "AngelOne" else {
            "buy_or_sell": "B",
            "product_type": "I",
            "exchange": position_data['exchange'],
            "tradingsymbol": position_data['symbol'],
            "quantity": 1,
            "price_type": "MKT",
            "price": 0,
            "retention": "DAY"
        }
        buy_result = place_order(api_client, broker, orderparams, "LONG", username)
        if buy_result:
            with conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE open_positions SET position_active = 1, entry_price = ? WHERE position_id = ?", (ltp, position_data['position_id']))
                conn.commit()
            logger.info(f"Buy executed for {username} at {ltp}")

    elif (stop_loss_price and ltp <= stop_loss_price) or (sell_price and ltp <= sell_price) or (not position_data['position_active']):
        orderparams = {
            "variety": "NORMAL",
            "tradingsymbol": position_data['symbol'],
            "symboltoken": position_data['symboltoken'],
            "transactiontype": "SELL" if broker == "AngelOne" else "S",
            "exchange": position_data['exchange'],
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
            "exchange": position_data['exchange'],
            "tradingsymbol": position_data['symbol'],
            "quantity": 1,
            "price_type": "MKT",
            "price": 0,
            "retention": "DAY"
        }
        sell_result = place_order(api_client, broker, orderparams, "EXIT", username)
        if sell_result:
            with conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE open_positions SET position_active = 0 WHERE position_id = ?", (position_data['position_id'],))
                conn.commit()
            logger.info(f"Sell executed for {username} at {ltp} due to {'stop-loss' if ltp <= stop_loss_price else 'sell threshold'}")

@app.on_event("startup")
async def startup_event():
    load_symbol_data()
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
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT username FROM users WHERE username = ?", (user.username,))
            if cursor.fetchone():
                logger.info(f"User {user.username} already exists. Skipping registration.")
                return {"message": "User already registered"}
        
        api_client, auth_token, refresh_token, feed_token = authenticate_user(
            user.username, user.password, user.broker, user.api_key, user.totp_token, user.vendor_code, user.imei
        )
        logger.info(f"Authentication successful for {user.username}. Storing in database...")
        with conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                           (user.username, user.password, user.broker, user.api_key, user.totp_token, user.vendor_code, user.default_quantity, user.imei))
            conn.commit()
        smart_api_instances[user.username] = api_client
        auth_tokens[user.username] = auth_token
        if user.broker == "AngelOne":
            refresh_tokens[user.username] = refresh_token
        feed_tokens[user.username] = feed_token
        threading.Thread(target=start_websocket, args=(user.username, user.broker, user.api_key, auth_token, feed_token), daemon=True).start()
        return {"message": "User registered and authenticated successfully"}
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
                                 "sell_type", "sell_threshold", "previous_close", "exchange"], row)) for row in trades]}

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
        valid_exchanges = ["NFO", "MCX", "NSE", "BSE", "CDS", "BFO"]
        if params['exchange'] not in valid_exchanges:
            raise HTTPException(status_code=400, detail=f"Exchange must be one of {valid_exchanges}, not {params['exchange']}")

        strike_price = params['strike_price']
        buy_type = params['buy_type']
        buy_threshold = params['buy_threshold']
        previous_close = params.get('previous_close', 0)
        # Recalculate buy_threshold based on buy_type for consistency with frontend
        if buy_type == "Percentage" and previous_close:
            buy_threshold = previous_close * (1 + buy_threshold / 100)
        elif buy_type == "Points":
            ltp = get_ltp(api_client, broker, params['exchange'], params['tradingsymbol'], params['symboltoken'])
            buy_threshold = ltp + buy_threshold

        ltp = get_ltp(api_client, broker, params['exchange'], params['tradingsymbol'], params['symboltoken'])
        if ltp < buy_threshold:
            raise HTTPException(status_code=400, detail=f"Current LTP {ltp} below buy threshold {buy_threshold}")

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
            'buy_threshold': buy_threshold,
            'stop_loss_type': params['stop_loss_type'],
            'stop_loss_value': params['stop_loss_value'],
            'points_condition': params['points_condition'],
            'symboltoken': params['symboltoken'],
            'sell_type': params.get('sell_type'),
            'sell_threshold': params.get('sell_threshold'),
            'previous_close': params.get('previous_close'),
            'exchange': params['exchange']
        }

        position_id = f"{username}_{params['tradingsymbol']}_{int(time.time())}"
        update_open_positions(position_id, username, params['tradingsymbol'], entry_price, conditions)
        return {"message": f"LONG trade initiated for {username}", "data": buy_result, "position_id": position_id}

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
                             "sell_type", "sell_threshold", "previous_close", "exchange"], position))
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
            raise HTTPException(status_code=400, detail="Market/option chain data is only available for Shoonya broker")

        valid_exchanges = ["NFO", "MCX", "NSE", "BSE", "CDS", "BFO"]
        if request.exchange not in valid_exchanges:
            raise HTTPException(status_code=400, detail=f"Exchange must be one of {valid_exchanges}, not {request.exchange}")

        symbol = request.symbol.strip().upper()
        logger.info(f"Received symbol input: {symbol} for user {username} on exchange {request.exchange}")

        if request.exchange == "NFO" or request.exchange == "CDS" or request.exchange == "BFO":
            try:
                expiry_date = datetime.datetime.strptime(request.expiry_date, '%d-%m-%Y')
                expiry_str = expiry_date.strftime('%d-%b-%Y').upper()
            except ValueError:
                logger.error(f"Invalid expiry date format for {username}: {request.expiry_date}")
                raise HTTPException(status_code=400, detail="Invalid date format for NFO/CDS/BFO. Please use DD-MM-YYYY")

            symbols = find_symbols(request.exchange, symbol, request.expiry_date)
            if not symbols:
                logger.warning(f"No symbols found for {symbol} with expiry {expiry_str} in local {request.exchange} data")
                return {"message": f"No symbols found for {symbol} with expiry {expiry_str}", "data": [], "total_strikes": 0}

            chain_data = {}
            tokens = []
            for scrip in symbols:
                tsym = scrip['TradingSymbol']
                token = str(scrip['Token'])
                strike_price = float(scrip['StrikePrice'])
                opt_type = scrip['OptionType']

                quote = api_client.get_quotes(exchange=request.exchange, token=token)
                if quote and quote.get('stat') == 'Ok':
                    ltp = float(quote.get('lp', 0)) if quote.get('lp') else 0
                    bid = float(quote.get('bp', 0)) if quote.get('bp') else 0
                    ask = float(quote.get('ap', 0)) if quote.get('ap') else 0
                    oi = float(quote.get('oi', 0)) / 100000 if quote.get('oi') else 0
                    volume = float(quote.get('v', 0)) if quote.get('v') else 0
                    logger.info(f"Fetch LTP for {tsym} (token: {token}): LTP={ltp}, OI={oi}, Volume={volume}")

                    if strike_price not in chain_data:
                        chain_data[strike_price] = {'Call': {}, 'Put': {}}

                    if opt_type == 'CE':
                        chain_data[strike_price]['Call'] = {
                            'LTP': ltp, 'Bid': bid, 'Ask': ask, 'OI': oi, 'Volume': volume,
                            'TradingSymbol': tsym, 'Token': token
                        }
                    elif opt_type == 'PE':
                        chain_data[strike_price]['Put'] = {
                            'LTP': ltp, 'Bid': bid, 'Ask': ask, 'OI': oi, 'Volume': volume,
                            'TradingSymbol': tsym, 'Token': token
                        }
                    tokens.append(token)

            if request.strike_count:
                sorted_strikes = sorted(chain_data.keys())
                mid_point = len(sorted_strikes) // 2
                start_idx = max(0, mid_point - request.strike_count // 2)
                end_idx = min(len(sorted_strikes), start_idx + request.strike_count)
                chain_data = {k: chain_data[k] for k in sorted_strikes[start_idx:end_idx]}

            if tokens:
                option_chain_subscriptions[username] = tokens
                api_client.subscribe(','.join(tokens))
                logger.info(f"Subscribed to tokens for {username}: {tokens}")

            formatted_data = [
                {'StrikePrice': strike, 'Call': chain_data[strike]['Call'], 'Put': chain_data[strike]['Put']}
                for strike in sorted(chain_data.keys())
            ]
            return {
                "message": f"Option chain for {symbol} with expiry {expiry_str} on {request.exchange}",
                "data": formatted_data,
                "total_strikes": len(formatted_data)
            }

        else:
            symbols = find_symbols(request.exchange, symbol)
            if not symbols:
                logger.error(f"No symbols found for {symbol} on {request.exchange} in local data")
                raise HTTPException(status_code=400, detail=f"No symbols found for {symbol} on {request.exchange}")

            base_symbol = symbols[0]['TradingSymbol']
            token = str(symbols[0]['Token'])
            logger.info(f"Resolved base symbol: {base_symbol} with token {token} for user {username}")

            quotes = api_client.get_quotes(exchange=request.exchange, token=token)
            if not quotes or quotes.get('stat') != 'Ok':
                error_msg = quotes.get('emsg', 'No response from API')
                logger.error(f"No market data available for {base_symbol} on {request.exchange}: {error_msg}")
                if "market" in error_msg.lower() or "closed" in error_msg.lower():
                    return {"message": "Market is closed, no live market data available", "data": []}
                raise HTTPException(status_code=400, detail=f"No market data available: {error_msg}")

            ltp = float(quotes.get('lp', 0)) if quotes.get('lp') else 0
            bid = float(quotes.get('bp', 0)) if quote.get('bp') else 0
            ask = float(quotes.get('ap', 0)) if quote.get('ap') else 0
            oi = float(quotes.get('oi', 0)) if quotes.get('oi') else 0
            volume = float(quotes.get('v', 0)) if quotes.get('v') else 0

            if token:
                option_chain_subscriptions[username] = [token]
                api_client.subscribe(token)

            return {
                "message": f"Market data for {base_symbol} on {request.exchange}",
                "data": [{
                    "TradingSymbol": base_symbol,
                    "Token": token,
                    "LTP": ltp,
                    "Bid": bid,
                    "Ask": ask,
                    "OI": oi,
                    "Volume": volume,
                    "Timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
                }],
                "total_symbols": 1
            }

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Market/option chain fetch error for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.websocket("/ws/option_chain/{username}/{token}")
async def websocket_option_chain(websocket: WebSocket, username: str, token: str):
    await websocket.accept()
    try:
        if username not in smart_api_instances or username not in option_chain_subscriptions:
            await websocket.send_json({"error": "User not authenticated or no active subscription"})
            await websocket.close()
            return

        symbol_key = f"{token}"
        if symbol_key not in option_chain_subscriptions:
            option_chain_subscriptions[symbol_key] = []
        option_chain_subscriptions[symbol_key].append(websocket)

        while True:
            await websocket.receive_text()
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

        exchanges = ["NFO", "MCX", "NSE", "BSE", "CDS", "BFO"]
        for exchange in exchanges:
            quotes = api_client.get_quotes(exchange=exchange, token=token)
            if quotes and quotes.get('stat') == 'Ok':
                ltp = float(quotes.get('lp', 0))
                oi = float(quotes.get('oi', 0))
                volume = float(quotes.get('v', 0))
                timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
                return {
                    "ltp": ltp,
                    "oi": oi,
                    "market_data": {
                        "v": volume,
                        "ft": timestamp
                    }
                }
        raise HTTPException(status_code=400, detail="No market data available for this token across exchanges")
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Market data fetch error for {username}, token {token}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)