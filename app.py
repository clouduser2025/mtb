from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from SmartApi import SmartConnect
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
from api_helper import ShoonyaApiPy  # Shoonya API import
import pyotp
import threading
import time
import sqlite3
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
import json
import uvicorn

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

conn = sqlite3.connect("trading_multi.db", check_same_thread=False)
cursor = conn.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT,
    broker TEXT CHECK(broker IN ('AngelOne', 'Shoonya')),
    api_key TEXT,
    totp_token TEXT,
    vendor_code TEXT,  -- For Shoonya
    default_quantity INTEGER
)
""")

cursor.execute("""
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
    base_price REAL
)
""")
conn.commit()

class User(BaseModel):
    username: str
    password: str
    broker: str  # 'AngelOne' or 'Shoonya'
    api_key: str
    totp_token: str
    vendor_code: Optional[str] = None  # Required for Shoonya
    default_quantity: int

class TradeRequest(BaseModel):
    username: str
    tradingsymbol: str
    symboltoken: str
    exchange: str = "NSE"
    strike_price: float
    buy_type: str = "Fixed"
    buy_threshold: float = 110
    previous_close: Optional[float] = None
    producttype: str = "INTRADAY"
    stop_loss_type: str = "Fixed"
    stop_loss_value: float = 5.0
    points_condition: float = 0

class UpdateTradeRequest(BaseModel):
    username: str
    position_id: str
    stop_loss_type: Optional[str] = "Fixed"
    stop_loss_value: Optional[float] = 5.0
    points_condition: Optional[float] = 0

smart_api_instances = {}  # Stores AngelOne or Shoonya API instances
ltp_cache = {}
websocket_threads = {}

def authenticate_user(username: str, password: str, broker: str, api_key: str, totp_token: str, vendor_code: Optional[str] = None):
    if broker == "AngelOne":
        smart_api = SmartConnect(api_key)
        try:
            totp = pyotp.TOTP(totp_token).now()
            data = smart_api.generateSession(username, password, totp)
            if data['status'] == False:
                logger.error(f"AngelOne Authentication failed for {username}: {data}")
                raise Exception("Authentication failed")
            auth_token = data['data']['jwtToken']
            feed_token = smart_api.getfeedToken()
            return smart_api, auth_token, feed_token
        except Exception as e:
            logger.error(f"AngelOne Auth error for {username}: {e}")
            raise
    elif broker == "Shoonya":
        smart_api = ShoonyaApiPy()
        try:
            totp = pyotp.TOTP(totp_token).now()
            ret = smart_api.login(userid=username, password=password, twoFA=totp, vendor_code=vendor_code, api_secret=api_key, imei="trading_app")
            if ret.get('stat') != 'Ok':
                logger.error(f"Shoonya Authentication failed for {username}: {ret}")
                raise Exception("Authentication failed")
            return smart_api, ret['susertoken'], None  # Shoonya uses susertoken, no feed_token
        except Exception as e:
            logger.error(f"Shoonya Auth error for {username}: {e}")
            raise
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported broker: {broker}")

def get_ltp(api_client, broker: str, exchange: str, tradingsymbol: str, symboltoken: str):
    symbol_key = f"{exchange}:{tradingsymbol}:{symboltoken}"
    if symbol_key in ltp_cache:
        return ltp_cache[symbol_key]
    
    if broker == "AngelOne":
        ltp_data = api_client.ltpData(exchange, tradingsymbol, symboltoken)
        if ltp_data and 'data' in ltp_data and 'ltp' in ltp_data['data']:
            return float(ltp_data['data']['ltp'])
        raise HTTPException(status_code=400, detail="No LTP data available")
    elif broker == "Shoonya":
        quotes = api_client.get_quotes(exchange=exchange, token=symboltoken)
        if quotes.get('stat') == 'Ok' and 'lp' in quotes:
            return float(quotes['lp'])
        raise HTTPException(status_code=400, detail="No LTP data available")

def place_order(api_client, broker: str, orderparams: dict, position_type: str):
    if broker == "AngelOne":
        orderparams["transactiontype"] = "BUY" if position_type == "LONG" else "SELL"
        response = api_client.placeOrderFullResponse(orderparams)
        if response['status'] == 'success':
            logger.info(f"AngelOne {position_type} order placed: {response['data']['orderid']}")
            return {"order_id": response['data']['orderid'], "status": "success"}
        raise HTTPException(status_code=400, detail=f"AngelOne {position_type} order failed: {response.get('message')}")
    elif broker == "Shoonya":
        orderparams["buy_or_sell"] = "B" if position_type == "LONG" else "S"
        orderparams["price_type"] = "MKT"  # Assuming Market order for simplicity
        response = api_client.place_order(**orderparams)
        if response.get('stat') == 'Ok':
            logger.info(f"Shoonya {position_type} order placed: {response['norenordno']}")
            return {"order_id": response['norenordno'], "status": "success"}
        raise HTTPException(status_code=400, detail=f"Shoonya {position_type} order failed: {response.get('emsg')}")

def update_open_positions(position_id: str, username: str, symbol: str, entry_price: float, conditions: dict):
    cursor.execute("""
        INSERT OR REPLACE INTO open_positions (position_id, username, symbol, symboltoken, entry_price, buy_threshold, 
                                              stop_loss_type, stop_loss_value, points_condition, position_type, 
                                              position_active, highest_price, base_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'LONG', 1, ?, ?)
    """, (position_id, username, symbol, conditions['symboltoken'], entry_price, conditions['buy_threshold'], 
          conditions['stop_loss_type'], conditions['stop_loss_value'], conditions['points_condition'],
          entry_price, entry_price))
    conn.commit()

def on_data_angel(wsapp, message):
    global ltp_cache
    try:
        symbol_key = f"{message['exchange']}:{message['tradingsymbol']}:{message['symboltoken']}"
        ltp = float(message['ltp'])
        ltp_cache[symbol_key] = ltp
        process_position_update(message['tradingsymbol'], ltp)
    except Exception as e:
        logger.error(f"AngelOne WebSocket data error: {e}")

def on_data_shoonya(tick_data):
    global ltp_cache
    try:
        symbol_key = f"{tick_data['e']}:{tick_data['ts']}:{tick_data['tk']}"
        ltp = float(tick_data['lp'])
        ltp_cache[symbol_key] = ltp
        process_position_update(tick_data['ts'], ltp)
    except Exception as e:
        logger.error(f"Shoonya WebSocket data error: {e}")

def process_position_update(tradingsymbol: str, ltp: float):
    cursor.execute("SELECT * FROM open_positions WHERE symbol = ? AND position_active = 1", (tradingsymbol,))
    positions = cursor.fetchall()
    for position in positions:
        pos_data = dict(zip(["position_id", "username", "symbol", "symboltoken", "entry_price", "buy_threshold", "stop_loss_type", 
                             "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price"], position))
        username = pos_data['username']
        if username in smart_api_instances:
            api_client = smart_api_instances[username]
            check_conditions(api_client, pos_data, ltp)

def on_open_angel(wsapp):
    logger.info("AngelOne WebSocket opened")
    subscribe_to_tokens(wsapp, 1)  # 1 for AngelOne exchangeType

def on_open_shoonya():
    logger.info("Shoonya WebSocket opened")
    subscribe_to_tokens(None, None)  # Shoonya handles subscription in start_websocket

def subscribe_to_tokens(wsapp, exchange_type):
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

def check_conditions(api_client, position_data: dict, ltp: float):
    username = position_data['username']
    symbol = position_data['symbol']
    position_id = position_data['position_id']
    entry_price = position_data['entry_price']
    stop_loss_type = position_data['stop_loss_type']
    stop_loss_value = position_data['stop_loss_value']
    points_condition = position_data['points_condition']
    highest_price = position_data['highest_price']
    base_price = position_data['base_price']

    stop_loss_price = None
    if stop_loss_type == "Fixed":
        stop_loss_price = entry_price - stop_loss_value
    elif stop_loss_type in ["Percentage", "Points"]:
        highest_price = max(ltp, highest_price)
        if points_condition < 0 and ltp < base_price + points_condition:
            base_price = ltp
        profit = highest_price - base_price
        if stop_loss_type == "Percentage":
            stop_loss_price = base_price + (profit * (1 - stop_loss_value / 100))
        elif stop_loss_type == "Points":
            stop_loss_price = highest_price - stop_loss_value

    cursor.execute("UPDATE open_positions SET highest_price = ?, base_price = ? WHERE position_id = ?", 
                   (highest_price, base_price, position_id))
    conn.commit()

    if ltp <= stop_loss_price:
        cursor.execute("SELECT broker FROM users WHERE username = ?", (username,))
        broker = cursor.fetchone()[0]
        orderparams = {
            "variety": "NORMAL",
            "tradingsymbol": symbol,
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
            "tradingsymbol": symbol,
            "quantity": 1,
            "price_type": "MKT",
            "price": 0,
            "retention": "DAY"
        }
        place_order(api_client, broker, orderparams, "EXIT")
        cursor.execute("UPDATE open_positions SET position_active = 0 WHERE position_id = ?", (position_id,))
        conn.commit()
        logger.info(f"Stop-loss hit for {username}. Sold at {ltp}")

@app.on_event("startup")
async def startup_event():
    cursor.execute("SELECT * FROM users LIMIT 3")
    users = cursor.fetchall()
    for user in users:
        user_data = dict(zip(["username", "password", "broker", "api_key", "totp_token", "vendor_code", "default_quantity"], user))
        api_client, auth_token, feed_token = authenticate_user(
            user_data['username'], user_data['password'], user_data['broker'], 
            user_data['api_key'], user_data['totp_token'], user_data['vendor_code']
        )
        smart_api_instances[user_data['username']] = api_client
        threading.Thread(target=start_websocket, args=(user_data['username'], user_data['broker'], user_data['api_key'], auth_token, feed_token), daemon=True).start()

@app.post("/api/register_user")
def register_user(user: User):
    try:
        api_client, auth_token, feed_token = authenticate_user(
            user.username, user.password, user.broker, user.api_key, user.totp_token, user.vendor_code
        )
        cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                       (user.username, user.password, user.broker, user.api_key, user.totp_token, user.vendor_code, user.default_quantity))
        conn.commit()
        smart_api_instances[user.username] = api_client
        threading.Thread(target=start_websocket, args=(user.username, user.broker, user.api_key, auth_token, feed_token), daemon=True).start()
        return {"message": "User registered and authenticated successfully"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="User already exists")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")

@app.get("/api/get_users")
def get_users():
    cursor.execute("SELECT * FROM users")
    users = cursor.fetchall()
    return {"users": [dict(zip(["username", "password", "broker", "api_key", "totp_token", "vendor_code", "default_quantity"], row)) for row in users]}

@app.delete("/api/delete_user/{username}")
def delete_user(username: str):
    cursor.execute("DELETE FROM users WHERE username = ?", (username,))
    cursor.execute("DELETE FROM open_positions WHERE username = ?", (username,))
    conn.commit()
    if username in smart_api_instances:
        del smart_api_instances[username]
    return {"message": f"User {username} deleted successfully"}

@app.get("/api/get_trades")
def get_trades():
    cursor.execute("SELECT * FROM open_positions WHERE position_active = 1")
    trades = cursor.fetchall()
    return {"trades": [dict(zip(["position_id", "username", "symbol", "symboltoken", "entry_price", "buy_threshold", "stop_loss_type", 
                                 "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price"], row))
                       for row in trades]}

@app.post("/api/initiate_buy_trade")
async def initiate_trade(request: TradeRequest):
    try:
        username = request.username
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail="User not authenticated")
        
        api_client = smart_api_instances[username]
        cursor.execute("SELECT broker, default_quantity FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        broker, default_quantity = user
        
        params = request.dict()
        strike_price = params['strike_price']
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
                "product_type": "I",
                "exchange": params['exchange'],
                "tradingsymbol": params['tradingsymbol'],
                "quantity": default_quantity,
                "discloseqty": 0,
                "price_type": "MKT",
                "price": 0,
                "retention": "DAY"
            }
        )
        buy_result = place_order(api_client, broker, buy_order_params, "LONG")
        entry_price = ltp

        conditions = {
            'buy_threshold': entry_threshold,
            'stop_loss_type': params['stop_loss_type'],
            'stop_loss_value': params['stop_loss_value'],
            'points_condition': params['points_condition'],
            'symboltoken': params['symboltoken']
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
        cursor.execute("SELECT * FROM open_positions WHERE position_id = ? AND position_active = 1", (position_id,))
        position = cursor.fetchone()
        if not position:
            raise HTTPException(status_code=404, detail="Position not found or closed")
        
        pos_data = dict(zip(["position_id", "username", "symbol", "symboltoken", "entry_price", "buy_threshold", "stop_loss_type", 
                             "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price"], position))
        if pos_data['username'] != username:
            raise HTTPException(status_code=403, detail="Unauthorized to modify this position")

        params = request.dict()
        stop_loss_type = params.get('stop_loss_type', pos_data['stop_loss_type'])
        stop_loss_value = params.get('stop_loss_value', pos_data['stop_loss_value'])
        points_condition = params.get('points_condition', pos_data['points_condition'])

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

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)