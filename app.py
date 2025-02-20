from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional  # Keep only necessary imports from typing
from SmartApi import SmartConnect
import pyotp
import threading
import time
import sqlite3
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
import websocket
import json
import uvicorn

app = FastAPI()

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database Setup
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

# Pydantic Models
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

# Global SmartAPI instances
smart_api_instances = {}

def authenticate_user(username: str, password: str, api_key: str, totp_token: str):
    smartApi = SmartConnect(api_key)
    try:
        totp = pyotp.TOTP(totp_token).now()
        data = smartApi.generateSession(username, password, totp)
        if data['status'] == False:
            logger.error(f"Authentication failed for {username}: {data}")
            raise Exception("Authentication failed")
        smart_api_instances[username] = smartApi
        return True
    except Exception as e:
        logger.error(f"Authentication error for {username}: {e}")
        raise

def get_ltp(smartApi, exchange, tradingsymbol, symboltoken):
    try:
        historicParam = {
            "exchange": exchange,
            "symboltoken": symboltoken,
            "interval": "ONE_MINUTE",
            "fromdate": "2025-02-19 09:00",
            "todate": "2025-02-19 09:01"
        }
        candles = smartApi.getCandleData(historicParam)
        if candles and 'data' in candles and len(candles['data']) > 0:
            return float(candles['data'][-1][4])
        raise HTTPException(status_code=400, detail="No LTP data available")
    except Exception as e:
        logger.error(f"Error fetching LTP: {e}")
        raise HTTPException(status_code=400, detail=f"LTP fetch error: {str(e)}")

def place_order(smartApi, orderparams, position_type: str):
    try:
        orderparams["transactiontype"] = "BUY" if position_type == "LONG" else "SELL"
        response = smartApi.placeOrderFullResponse(orderparams)
        if response['status'] == 'success':
            logger.info(f"{position_type} order placed successfully. Order ID: {response['data']['orderid']}")
            return {"order_id": response['data']['orderid'], "status": "success"}
        raise HTTPException(status_code=400, detail=f"{position_type} order placement failed: {response['message']}")
    except Exception as e:
        logger.error(f"{position_type} order placement error: {e}")
        raise HTTPException(status_code=400, detail=f"{position_type} order placement error: {str(e)}")

# Fixed Line 135: Changed 'Dict' to 'dict'
def update_open_positions(position_id: str, username: str, symbol: str, entry_price: float, conditions: dict):
    cursor.execute("""
        INSERT OR REPLACE INTO open_positions (position_id, username, symbol, entry_price, buy_threshold, 
                                              stop_loss_type, stop_loss_value, points_condition, position_type, 
                                              position_active, highest_price, base_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'LONG', 1, ?, ?)
    """, (position_id, username, symbol, entry_price, conditions['buy_threshold'], 
          conditions['stop_loss_type'], conditions['stop_loss_value'], conditions['points_condition'],
          entry_price, entry_price))
    conn.commit()

def on_message(ws, message):
    data = json.loads(message)
    if 'ltp' in data and 'symbol' in data:
        symbol = data['symbol']
        ltp = float(data['ltp'])
        logger.info(f"Real-time LTP for {symbol}: {ltp}")
        cursor.execute("SELECT * FROM open_positions WHERE symbol = ? AND position_active = 1", (symbol,))
        positions = cursor.fetchall()
        for position in positions:
            pos_data = dict(zip(["position_id", "username", "symbol", "entry_price", "buy_threshold", "stop_loss_type", 
                                 "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price"], position))
            username = pos_data['username']
            if username in smart_api_instances:
                smartApi = smart_api_instances[username]
                check_conditions(smartApi, pos_data, ltp)

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
            "quantity": "1",
            "squareoff": "0",
            "stoploss": "0"
        }
        place_order(smartApi, orderparams, "EXIT")
        cursor.execute("UPDATE open_positions SET position_active = 0 WHERE position_id = ?", (position_id,))
        conn.commit()
        logger.info(f"Stop-loss hit for {username}. Sold at {ltp}")

def on_error(ws, error):
    logger.error(f"WebSocket error: {error}")

def on_close(ws):
    logger.info("WebSocket connection closed")

def on_open(ws):
    logger.info("WebSocket connection opened")

def start_websocket(username, api_key, feed_token):
    ws = websocket.WebSocketApp("wss://wsfeeds.angelbroking.com/NestHtml5Mobile/public/smartwebsocket/uni1/12345678",
                                on_message=on_message,
                                on_error=on_error,
                                on_close=on_close)
    ws.on_open = lambda ws: on_open(ws)
    ws.run_forever()

@app.on_event("startup")
async def startup_event():
    cursor.execute("SELECT * FROM users LIMIT 3")
    users = cursor.fetchall()
    for user in users:
        user_data = dict(zip(["username", "password", "broker", "api_key", "totp_token", "default_quantity"], user))
        authenticate_user(user_data['username'], user_data['password'], user_data['api_key'], user_data['totp_token'])
        threading.Thread(target=start_websocket, args=(user_data['username'], user_data['api_key'], "feed_token"), daemon=True).start()

@app.post("/api/register_user")
def register_user(user: User):
    try:
        cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)",
                       (user.username, user.password, user.broker, user.api_key, user.totp_token, user.default_quantity))
        conn.commit()
        return {"message": "User registered successfully"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="User already exists")

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
    return {"trades": [dict(zip(["position_id", "username", "symbol", "entry_price", "buy_threshold", "stop_loss_type", 
                                 "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price"], row))
                       for row in trades]}

@app.post("/api/initiate_buy_trade")
async def initiate_trade(request: TradeRequest):
    try:
        username = request.username
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail="User not authenticated")
        
        smartApi = smart_api_instances[username]
        params = request.dict()

        strike_price = params['strike_price']
        buy_type = params['buy_type']
        buy_threshold = params['buy_threshold']
        previous_close = params.get('previous_close', strike_price)
        entry_threshold = buy_threshold if buy_type == "Fixed" else previous_close * (1 + buy_threshold / 100)
        ltp = get_ltp(smartApi, params['exchange'], params['tradingsymbol'], params['symboltoken'])
        if ltp < entry_threshold:
            raise HTTPException(status_code=400, detail=f"Current LTP {ltp} below buy threshold {entry_threshold}")

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
            "quantity": "1",
            "squareoff": "0",
            "stoploss": "0"
        }
        buy_result = place_order(smartApi, buy_order_params, "LONG")
        entry_price = ltp

        conditions = {
            'buy_threshold': entry_threshold,
            'stop_loss_type': params['stop_loss_type'],
            'stop_loss_value': params['stop_loss_value'],
            'points_condition': params['points_condition']
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
        
        pos_data = dict(zip(["position_id", "username", "symbol", "entry_price", "buy_threshold", "stop_loss_type", 
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