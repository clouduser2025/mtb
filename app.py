from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from SmartApi import SmartConnect
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
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
    broker TEXT,
    api_key TEXT,
    totp_token TEXT,
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
    broker: str
    api_key: str
    totp_token: str
    default_quantity: int

class TradeRequest(BaseModel):
    username: str
    tradingsymbol: str
    symboltoken: str
    exchange: str = "NSE"
    strike_price: float
    buy_type: str = "Fixed"  # "Fixed" or "Percentage"
    buy_threshold: float = 110  # Threshold price or percentage increase
    previous_close: Optional[float] = None  # For percentage-based buy
    producttype: str = "INTRADAY"
    stop_loss_type: str = "Fixed"  # "Fixed", "Percentage", or "Points"
    stop_loss_value: float = 5.0  # Value for stop-loss (price, percentage, or points)
    points_condition: float = 0  # For trailing stop-loss adjustments

class UpdateTradeRequest(BaseModel):
    username: str
    position_id: str
    stop_loss_type: Optional[str] = "Fixed"
    stop_loss_value: Optional[float] = 5.0
    points_condition: Optional[float] = 0

smart_api_instances = {}
ltp_cache = {}

def authenticate_user(username: str, password: str, api_key: str, totp_token: str):
    smartApi = SmartConnect(api_key)
    try:
        totp = pyotp.TOTP(totp_token).now()
        data = smartApi.generateSession(username, password, totp)
        if data['status'] == False:
            logger.error(f"Authentication failed for {username}: {data}")
            raise Exception("Authentication failed")
        authToken = data['data']['jwtToken']
        feedToken = smartApi.getfeedToken()
        smart_api_instances[username] = smartApi
        logger.info(f"User {username} authenticated successfully")
        return smartApi, authToken, feedToken
    except Exception as e:
        logger.error(f"Authentication error for {username}: {e}")
        raise

def get_ltp(smartApi, exchange, tradingsymbol, symboltoken):
    try:
        symbol_key = f"{exchange}:{tradingsymbol}:{symboltoken}"
        if symbol_key in ltp_cache:
            return ltp_cache[symbol_key]
        ltp_data = smartApi.ltpData(exchange, tradingsymbol, symboltoken)
        if ltp_data and 'data' in ltp_data and 'ltp' in ltp_data['data']:
            return float(ltp_data['data']['ltp'])
        raise HTTPException(status_code=400, detail="No LTP data available")
    except Exception as e:
        logger.error(f"Error fetching LTP for {tradingsymbol}: {e}")
        raise HTTPException(status_code=400, detail=f"LTP fetch error: {str(e)}")

def place_order(smartApi, orderparams, position_type: str):
    try:
        orderparams["transactiontype"] = "BUY" if position_type == "LONG" else "SELL"
        response = smartApi.placeOrderFullResponse(orderparams)
        logger.debug(f"Order placement response for {position_type} with params {orderparams}: {response}")
        if response['status'] == 'success':
            logger.info(f"{position_type} order placed successfully. Order ID: {response['data']['orderid']}")
            return {"order_id": response['data']['orderid'], "status": "success"}
        raise HTTPException(status_code=400, detail=f"{position_type} order placement failed: {response.get('message', 'Unknown error')}")
    except Exception as e:
        logger.error(f"{position_type} order placement error with params {orderparams}: {e}")
        raise HTTPException(status_code=400, detail=f"{position_type} order placement error: {str(e)}")

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

def on_data(wsapp, message):
    global ltp_cache
    try:
        symbol_key = f"{message['exchange']}:{message['tradingsymbol']}:{message['symboltoken']}"
        ltp = float(message['ltp'])
        ltp_cache[symbol_key] = ltp
        logger.info(f"Ticks for {message['tradingsymbol']}: {message}")
        cursor.execute("SELECT * FROM open_positions WHERE symbol = ? AND position_active = 1", (message['tradingsymbol'],))
        positions = cursor.fetchall()
        for position in positions:
            pos_data = dict(zip(["position_id", "username", "symbol", "symboltoken", "entry_price", "buy_threshold", "stop_loss_type", 
                                 "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price"], position))
            username = pos_data['username']
            if username in smart_api_instances:
                smartApi = smart_api_instances[username]
                check_conditions(smartApi, pos_data, ltp)
    except Exception as e:
        logger.error(f"Error processing WebSocket message for {message.get('tradingsymbol', 'unknown')}: {e}")

def on_open(wsapp):
    logger.info("WebSocket opened")
    cursor.execute("SELECT DISTINCT symboltoken FROM open_positions WHERE position_active = 1")
    tokens = [row[0] for row in cursor.fetchall()]
    if tokens:
        token_list = [{"exchangeType": 1, "tokens": tokens}]
        correlation_id = "abc123"
        mode = 1
        wsapp.subscribe(correlation_id, mode, token_list)

def on_error(wsapp, error):
    logger.error(f"WebSocket error: {error}")

def on_close(wsapp):
    logger.info("WebSocket closed")

def start_websocket(username, api_key, auth_token, feed_token):
    sws = SmartWebSocketV2(auth_token, api_key, username, feed_token)
    sws.on_open = on_open
    sws.on_data = on_data
    sws.on_error = on_error
    sws.on_close = on_close
    sws.connect()

def check_conditions(smartApi, position_data, ltp):
    username = position_data['username']
    symbol = position_data['symbol']
    position_id = position_data['position_id']
    entry_price = position_data['entry_price']
    stop_loss_type = position_data['stop_loss_type']
    stop_loss_value = position_data['stop_loss_value']
    points_condition = position_data['points_condition']
    highest_price = position_data['highest_price']
    base_price = position_data['base_price']

    # Fetch default_quantity for the user for sell orders
    cursor.execute("SELECT default_quantity FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    if not user:
        default_quantity = 1  # Fallback if user not found
    else:
        default_quantity = user[0]

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
        orderparams = {
            "variety": "NORMAL",
            "tradingsymbol": symbol,
            "symboltoken": position_data['symboltoken'],
            "transactiontype": "SELL",
            "exchange": "NSE",
            "ordertype": "MARKET",
            "producttype": "INTRADAY",
            "duration": "DAY",
            "price": "0",
            "quantity": default_quantity,  # Use user's default quantity for sell orders
            "squareoff": "0",
            "stoploss": "0"
        }
        place_order(smartApi, orderparams, "EXIT")
        cursor.execute("UPDATE open_positions SET position_active = 0 WHERE position_id = ?", (position_id,))
        conn.commit()
        logger.info(f"Stop-loss hit for {username}. Sold at {ltp}")

@app.on_event("startup")
async def startup_event():
    cursor.execute("SELECT * FROM users LIMIT 3")
    users = cursor.fetchall()
    for user in users:
        user_data = dict(zip(["username", "password", "broker", "api_key", "totp_token", "default_quantity"], user))
        try:
            smartApi, auth_token, feed_token = authenticate_user(user_data['username'], user_data['password'], user_data['api_key'], user_data['totp_token'])
            threading.Thread(target=start_websocket, args=(user_data['username'], user_data['api_key'], auth_token, feed_token), daemon=True).start()
        except Exception as e:
            logger.error(f"Failed to authenticate user {user_data['username']} at startup: {e}")

@app.post("/api/register_user")
def register_user(user: User):
    try:
        # Authenticate user before registering
        smartApi, auth_token, feed_token = authenticate_user(user.username, user.password, user.api_key, user.totp_token)

        # If authentication succeeds, store the user details
        cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)",
                       (user.username, user.password, user.broker, user.api_key, user.totp_token, user.default_quantity))
        conn.commit()

        # Store authenticated instance
        smart_api_instances[user.username] = smartApi

        # Start WebSocket for the user
        threading.Thread(target=start_websocket, args=(user.username, user.api_key, auth_token, feed_token), daemon=True).start()

        return {"message": "User registered and authenticated successfully"}

    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="User already exists")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")

@app.get("/api/get_users")
def get_users():
    cursor.execute("SELECT * FROM users")
    users = cursor.fetchall()
    return {"users": [dict(zip(["username", "password", "broker", "api_key", "totp_token", "default_quantity"], row)) for row in users]}

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
        username = request.username  # Preserve exact casing (no .lower())
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail=f"User {username} not authenticated")
        
        smartApi = smart_api_instances[username]
        params = request.dict()

        # Fetch the default_quantity for the user from the users table
        cursor.execute("SELECT default_quantity FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail=f"User {username} not found")
        
        default_quantity = user[0]  # Get the default_quantity (e.g., 1 for A62128571)

        strike_price = params['strike_price']
        buy_type = params['buy_type']
        buy_threshold = params['buy_threshold']
        previous_close = params.get('previous_close', strike_price)
        entry_threshold = (buy_threshold if buy_type == "Fixed" 
                          else previous_close * (1 + buy_threshold / 100))
        ltp = get_ltp(smartApi, params['exchange'], params['tradingsymbol'], params['symboltoken'])
        if ltp < entry_threshold:
            raise HTTPException(status_code=400, detail=f"Current LTP {ltp} below buy threshold {entry_threshold}")

        # Use the user's default_quantity instead of hardcoding "1"
        buy_order_params = {
            "variety": "NORMAL",
            "tradingsymbol": params['tradingsymbol'],
            "symboltoken": params['symboltoken'],
            "transactiontype": "BUY",
            "exchange": params['exchange'],
            "ordertype": "MARKET",
            "producttype": params['producttype'],
            "duration": "DAY",
            "price": "0",
            "quantity": default_quantity,  # Use the user's default quantity (as an integer)
            "squareoff": "0",
            "stoploss": "0"
        }
        buy_result = place_order(smartApi, buy_order_params, "LONG")
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

@app.post("/api/initiate_sell_trade")  # New endpoint for sell orders
async def initiate_sell_trade(request: TradeRequest):
    try:
        username = request.username  # Preserve exact casing (no .lower())
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail=f"User {username} not authenticated")
        
        smartApi = smart_api_instances[username]
        params = request.dict()

        # Fetch the default_quantity for the user from the users table
        cursor.execute("SELECT default_quantity FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail=f"User {username} not found")
        
        default_quantity = user[0]  # Get the default_quantity (e.g., 1 for A62128571)

        strike_price = params['strike_price']
        sell_type = params['buy_type']  # Reuse buy_type for sell logic ("Fixed" or "Percentage")
        sell_threshold = params['buy_threshold']  # Threshold price or percentage decrease
        previous_close = params.get('previous_close', strike_price)
        exit_threshold = (sell_threshold if sell_type == "Fixed" 
                         else previous_close * (1 - sell_threshold / 100))
        ltp = get_ltp(smartApi, params['exchange'], params['tradingsymbol'], params['symboltoken'])
        if ltp > exit_threshold:
            raise HTTPException(status_code=400, detail=f"Current LTP {ltp} above sell threshold {exit_threshold}")

        sell_order_params = {
            "variety": "NORMAL",
            "tradingsymbol": params['tradingsymbol'],
            "symboltoken": params['symboltoken'],
            "transactiontype": "SELL",
            "exchange": params['exchange'],
            "ordertype": "MARKET",
            "producttype": params['producttype'],
            "duration": "DAY",
            "price": "0",
            "quantity": default_quantity,  # Use the user's default quantity
            "squareoff": "0",
            "stoploss": "0"
        }
        sell_result = place_order(smartApi, sell_order_params, "SHORT")
        return {"message": f"SHORT trade initiated for {username}", "data": sell_result}

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Trade initiation error for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/api/update_trade_conditions")
async def update_trade_conditions(request: UpdateTradeRequest):
    try:
        username = request.username  # Preserve exact casing (no .lower())
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