from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict
from SmartApi import SmartConnect
import pyotp
import threading
import time
import sqlite3
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import websocket
import json
import uvicorn

app = FastAPI()

# ------------------------------
# CORS Middleware
# ------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------
# Database Connection and Table Setup
# ------------------------------
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
    username TEXT,
    symbol TEXT,
    entry_price REAL,
    buy_threshold REAL,
    stop_loss_type TEXT,  -- "Fixed", "Percentage", "Points", or "Combined"
    stop_loss_value REAL, -- Value for stop-loss (e.g., 95 for fixed, 50 for percentage)
    points_condition REAL, -- For trailing adjustments (e.g., 0, -0.2)
    trailing_base REAL,   -- Base price for trailing stop-loss
    sell_threshold REAL,  -- Fixed sell threshold (if any)
    position_active BOOLEAN DEFAULT 1,
    PRIMARY KEY (username, symbol)
)
""")
conn.commit()

# ------------------------------
# Pydantic Models for API Requests
# ------------------------------
class BuyRequest(BaseModel):
    username: str
    tradingsymbol: str
    symboltoken: str
    exchange: str = "NSE"
    strike_price: float
    producttype: str = "INTRADAY"
    buy_threshold_offset: Optional[float] = None  # For Fixed Price Buy
    buy_percentage: Optional[float] = None  # For Percentage-Based Buy
    stop_loss_type: Optional[str] = None  # "Fixed", "Percentage", "Points", or "Combined"
    stop_loss_value: Optional[float] = None  # Value for stop-loss
    points_condition: Optional[float] = None  # For trailing (e.g., 0, -0.2)
    sell_threshold_offset: Optional[float] = None  # For Fixed Price Sell

# Global SmartAPI instances and WebSocket connections
smart_api_instances = {}
websocket_connections = {}

def authenticate_user(username: str, password: str, api_key: str, totp_token: str):
    """
    Authenticate a specific user with SmartAPI.
    """
    smartApi = SmartConnect(api_key)
    try:
        totp = pyotp.TOTP(totp_token).now()
        data = smartApi.generateSession(username, password, totp)

        if data['status'] == False:
            logger.error(f"Authentication failed for user {username}: {data}")
            raise Exception("Authentication failed")

        authToken = data['data']['jwtToken']
        refreshToken = data['data']['refreshToken']
        feedToken = smartApi.getfeedToken()
        smartApi.generateToken(refreshToken)
        logger.info(f"Authentication successful for user {username}")
        smart_api_instances[username] = smartApi
        return True

    except Exception as e:
        logger.error(f"Authentication error for user {username}: {e}")
        raise

def get_ltp(smartApi, exchange, tradingsymbol, symboltoken):
    """
    Fetch the Last Traded Price (LTP) using SmartAPI's historical data (temporary until WebSocket is fully set up).
    """
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
            return float(candles['data'][-1][4])  # Last price from candles
        else:
            logger.error("No LTP data available")
            raise HTTPException(status_code=400, detail="No LTP data available")
    except Exception as e:
        logger.error(f"Error fetching LTP: {e}")
        raise HTTPException(status_code=400, detail=f"LTP fetch error: {str(e)}")

def place_order(smartApi, orderparams):
    """
    Place an order using SmartAPI for a specific user.
    """
    try:
        response = smartApi.placeOrderFullResponse(orderparams)
        if response['status'] == 'success':
            logger.info(f"Order placed successfully. Order ID: {response['data']['orderid']}")
            return {"order_id": response['data']['orderid'], "status": "success"}
        else:
            logger.error(f"Order placement failed: {response['message']}")
            raise HTTPException(status_code=400, detail=f"Order placement failed: {response['message']}")
    except Exception as e:
        logger.error(f"Order placement error: {e}")
        raise HTTPException(status_code=400, detail=f"Order placement error: {str(e)}")

def update_open_positions(username: str, symbol: str, entry_price: float, conditions: Dict):
    """
    Update or insert open position in the database with all thresholds.
    """
    cursor.execute("""
        INSERT OR REPLACE INTO open_positions (username, symbol, entry_price, buy_threshold, stop_loss_type, 
                                              stop_loss_value, points_condition, trailing_base, sell_threshold, position_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    """, (username, symbol, entry_price, conditions['buy_threshold'], conditions['stop_loss_type'],
          conditions['stop_loss_value'], conditions['points_condition'], entry_price, conditions['sell_threshold']))
    conn.commit()

def get_open_position(username: str, symbol: str):
    """
    Retrieve open position details from the database.
    """
    cursor.execute("SELECT * FROM open_positions WHERE username = ? AND symbol = ? AND position_active = 1", 
                   (username, symbol))
    result = cursor.fetchone()
    if result:
        return dict(zip(["username", "symbol", "entry_price", "buy_threshold", "stop_loss_type", "stop_loss_value", 
                         "points_condition", "trailing_base", "sell_threshold", "position_active"], result))
    return None

# WebSocket handler for real-time data
def on_message(ws, message):
    data = json.loads(message)
    if 'ltp' in data and 'symbol' in data:
        symbol = data['symbol']
        ltp = float(data['ltp'])
        logger.info(f"Real-time LTP for {symbol}: {ltp}")

        # Check all open positions for this symbol
        cursor.execute("SELECT * FROM open_positions WHERE symbol = ? AND position_active = 1", (symbol,))
        positions = cursor.fetchall()
        for position in positions:
            position_data = dict(zip(["username", "symbol", "entry_price", "buy_threshold", "stop_loss_type", 
                                    "stop_loss_value", "points_condition", "trailing_base", "sell_threshold", 
                                    "position_active"], position))
            username = position_data['username']
            if username in smart_api_instances:
                smartApi = smart_api_instances[username]
                check_conditions(smartApi, position_data, ltp)

def on_error(ws, error):
    logger.error(f"WebSocket error: {error}")

def on_close(ws):
    logger.info("WebSocket connection closed")

def on_open(ws):
    logger.info("WebSocket connection opened")

def check_conditions(smartApi, position_data, ltp):
    """
    Check sell and stop-loss conditions in real-time and execute sell if met, then stop trading.
    """
    username = position_data['username']
    symbol = position_data['symbol']
    entry_price = position_data['entry_price']
    stop_loss_type = position_data['stop_loss_type']
    stop_loss_value = position_data['stop_loss_value']
    points_condition = position_data['points_condition']
    trailing_base = position_data['trailing_base']
    sell_threshold = position_data['sell_threshold']

    should_sell = False

    # Check Fixed Price Sell (if set)
    if sell_threshold is not None and ltp <= sell_threshold:
        logger.info(f"Fixed Price Sell triggered for user {username}, symbol {symbol}: LTP ({ltp}) <= Sell Threshold ({sell_threshold})")
        should_sell = True

    # Check Stop-Loss (various types)
    if not should_sell:
        if stop_loss_type == "Fixed":
            stop_loss = entry_price - stop_loss_value
            if ltp <= stop_loss:
                logger.info(f"Fixed Stop-Loss triggered for user {username}, symbol {symbol}: LTP ({ltp}) <= Stop-Loss ({stop_loss})")
                should_sell = True
        elif stop_loss_type == "Percentage":
            current_high = max(ltp, trailing_base)  # Track highest price since entry
            trailing_stop = trailing_base + (current_high - trailing_base) * (1 - stop_loss_value / 100)
            if points_condition and ltp < trailing_base + points_condition:
                trailing_base = ltp  # Adjust base on negative points
            if ltp <= trailing_stop:
                logger.info(f"Percentage Trailing Stop-Loss triggered for user {username}, symbol {symbol}: LTP ({ltp}) <= Trailing Stop ({trailing_stop})")
                should_sell = True
        elif stop_loss_type == "Points":
            trailing_stop = max(ltp, trailing_base) - stop_loss_value
            if ltp <= trailing_stop:
                logger.info(f"Points Trailing Stop-Loss triggered for user {username}, symbol {symbol}: LTP ({ltp}) <= Trailing Stop ({trailing_stop})")
                should_sell = True
        elif stop_loss_type == "Combined":
            current_high = max(ltp, trailing_base)
            trailing_stop = trailing_base + (current_high - trailing_base) * (1 - stop_loss_value / 100)
            if points_condition and ltp < trailing_base + points_condition:
                trailing_base = ltp
            if ltp <= trailing_stop:
                logger.info(f"Combined Trailing Stop-Loss triggered for user {username}, symbol {symbol}: LTP ({ltp}) <= Trailing Stop ({trailing_stop})")
                should_sell = True

    if should_sell:
        orderparams = {
            "variety": "NORMAL",
            "tradingsymbol": symbol,
            "symboltoken": position_data['symbol'],  # Adjust if symboltoken differs
            "transactiontype": "SELL",
            "exchange": "NSE",
            "ordertype": "MARKET",
            "producttype": "INTRADAY",
            "duration": "DAY",
            "price": "0",
            "quantity": str(entry_price),  # Use entry price as quantity for simplicity
            "squareoff": "0",
            "stoploss": "0"
        }
        place_order(smartApi, orderparams)
        # Mark position as inactive and stop trading
        cursor.execute("UPDATE open_positions SET position_active = 0 WHERE username = ? AND symbol = ?", 
                       (username, symbol))
        conn.commit()
        logger.info(f"Trade for user {username} and symbol {symbol} completed and stopped after sell.")

# WebSocket setup for each user
def start_websocket(username, api_key, feed_token):
    ws = websocket.WebSocketApp(f"wss://ws.smartapi.angelbroking.com/websocket",
                               on_message=on_message,
                               on_error=on_error,
                               on_close=on_close)
    ws.on_open = lambda ws: on_open(ws)
    ws.run_forever()

# Authenticate users and start WebSocket
@app.on_event("startup")
async def startup_event():
    """
    Authenticate all users and start WebSocket connections.
    """
    cursor.execute("SELECT * FROM users LIMIT 3")  # Fetch up to 3 users
    users = cursor.fetchall()
    for user in users:
        user_data = dict(zip(["username", "password", "broker", "api_key", "totp_token", "default_quantity"], user))
        authenticate_user(user_data['username'], user_data['password'], user_data['api_key'], user_data['totp_token'])
        # Start WebSocket for this user (simplified; in practice, use feed token)
        threading.Thread(target=start_websocket, args=(user_data['username'], user_data['api_key'], "feed_token"), daemon=True).start()

@app.get("/api/fetch_ltp")
async def fetch_ltp(exchange: str, symbol: str, token: str):
    """
    Fetch LTP for a specific symbol using SmartAPI.
    """
    try:
        cursor.execute("SELECT username, api_key FROM users LIMIT 1")  # Use first authenticated user
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="No users available")

        username, api_key = user
        smartApi = smart_api_instances.get(username)
        if not smartApi:
            raise HTTPException(status_code=401, detail="User not authenticated")

        ltp = get_ltp(smartApi, exchange, symbol, token)
        return {"ltp": ltp, "symbol": symbol, "status": True}

    except Exception as e:
        logger.error(f"Error fetching LTP for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch LTP: {str(e)}")

@app.post("/api/initiate_buy")
async def initiate_buy(request: BuyRequest):
    """
    Endpoint to initiate a buy trade with sell and stop-loss conditions, stopping after sell.
    """
    try:
        username = request.username
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail="User not authenticated")

        smartApi = smart_api_instances[username]
        params = request.dict()

        # Calculate buy threshold
        strike_price = params['strike_price']
        buy_threshold_offset = params['buy_threshold_offset']
        buy_percentage = params['buy_percentage']

        buy_threshold = None
        if buy_threshold_offset is not None:
            buy_threshold = strike_price + buy_threshold_offset
        elif buy_percentage is not None:
            buy_threshold = strike_price * (1 + buy_percentage/100)

        if buy_threshold is None:
            raise HTTPException(status_code=400, detail="No buy condition provided")

        # Get current LTP (for initial check)
        ltp = get_ltp(smartApi, params['exchange'], params['tradingsymbol'], params['symboltoken'])
        if ltp < buy_threshold:
            raise HTTPException(status_code=400, detail="Current LTP does not meet buy condition")

        # Place buy order
        quantity = str(params.get('default_quantity', 1))  # Use user's default quantity
        orderparams = {
            "variety": "NORMAL",
            "tradingsymbol": params['tradingsymbol'],
            "symboltoken": params['symboltoken'],
            "transactiontype": "BUY",
            "exchange": params['exchange'],
            "ordertype": "MARKET",
            "producttype": params['producttype'],
            "duration": "DAY",
            "price": "0",
            "quantity": quantity,
            "squareoff": "0",
            "stoploss": "0"
        }

        result = place_order(smartApi, orderparams)

        # Calculate sell and stop-loss thresholds
        sell_threshold = params['sell_threshold_offset'] if params['sell_threshold_offset'] else None
        stop_loss_type = params['stop_loss_type'] if params['stop_loss_type'] else "Fixed"
        stop_loss_value = params['stop_loss_value'] if params['stop_loss_value'] else 5.0  # Default to 5 if not provided
        points_condition = params['points_condition'] if params['points_condition'] is not None else 0

        # Store conditions in open positions
        conditions = {
            'buy_threshold': buy_threshold,
            'stop_loss_type': stop_loss_type,
            'stop_loss_value': stop_loss_value,
            'points_condition': points_condition,
            'sell_threshold': sell_threshold,
            'trailing_base': ltp  # Initial trailing base is the entry price
        }

        # Update open positions
        update_open_positions(username, params['tradingsymbol'], ltp, conditions)

        return {"message": f"Buy order initiated for user {username} with sell and stop-loss conditions", "data": result}

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Buy initiation error for user {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error for user {username}: {str(e)}")

@app.get("/api/get_open_positions")
def get_open_positions():
    """
    Endpoint to get all open positions.
    """
    cursor.execute("SELECT * FROM open_positions WHERE position_active = 1")
    positions = cursor.fetchall()
    return {"positions": [dict(zip(["username", "symbol", "entry_price", "buy_threshold", "stop_loss_type", 
                                   "stop_loss_value", "points_condition", "trailing_base", "sell_threshold", 
                                   "position_active"], row))
                         for row in positions]}

# WebSocket setup for each user
def start_websocket(username, api_key, feed_token):
    ws = websocket.WebSocketApp(f"wss://ws.smartapi.angelbroking.com/websocket",
                               on_message=on_message,
                               on_error=on_error,
                               on_close=on_close)
    ws.on_open = lambda ws: on_open(ws)
    ws.run_forever()

# Authenticate users and start WebSocket
@app.on_event("startup")
async def startup_event():
    """
    Authenticate all users and start WebSocket connections.
    """
    cursor.execute("SELECT * FROM users LIMIT 3")  # Fetch up to 3 users
    users = cursor.fetchall()
    for user in users:
        user_data = dict(zip(["username", "password", "broker", "api_key", "totp_token", "default_quantity"], user))
        authenticate_user(user_data['username'], user_data['password'], user_data['api_key'], user_data['totp_token'])
        # Start WebSocket for this user (simplified; in practice, use feed token)
        threading.Thread(target=start_websocket, args=(user_data['username'], user_data['api_key'], "feed_token"), daemon=True).start()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)