from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, List
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
    buy_threshold REAL,    -- New field for buy trigger (for LONG positions)
    sell_threshold REAL,   -- New field for sell trigger (for SHORT positions)
    exit_condition_type TEXT,  -- "Fixed", "Percentage" or "Points"
    exit_condition_value REAL, -- For stop-loss (long) or stop-gain (short)
    points_condition REAL,     -- For trailing adjustments (if needed)
    position_type TEXT,        -- "LONG" for buy trades, "SHORT" for sell trades
    position_active BOOLEAN DEFAULT 1,
    PRIMARY KEY (username, symbol, position_type)
)
""")
conn.commit()

# ------------------------------
# Pydantic Models for API Requests
# ------------------------------
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
    producttype: str = "INTRADAY"
    buy_threshold_offset: Optional[float] = None  # For Fixed Price Buy
    buy_percentage: Optional[float] = None  # For Percentage-Based Buy
    sell_threshold_offset: Optional[float] = None  # For Fixed Price Sell
    sell_percentage: Optional[float] = None  # For Percentage-Based Sell
    stop_loss_type: Optional[str] = None  # "Fixed", "Percentage", or "Points"
    stop_loss_value: Optional[float] = None  # Value for stop-loss
    points_condition: Optional[float] = None  # For trailing adjustments

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
    Fetch the Last Traded Price (LTP) using SmartAPI's historical data.
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

def place_order(smartApi, orderparams, position_type: str):
    """
    Place a buy or sell order using SmartAPI for a specific user.
    """
    try:
        orderparams["transactiontype"] = "BUY" if position_type == "LONG" else "SELL"
        response = smartApi.placeOrderFullResponse(orderparams)
        if response['status'] == 'success':
            logger.info(f"{position_type} order placed successfully. Order ID: {response['data']['orderid']}")
            return {"order_id": response['data']['orderid'], "status": "success", "position_type": position_type}
        else:
            logger.error(f"{position_type} order placement failed: {response['message']}")
            raise HTTPException(status_code=400, detail=f"{position_type} order placement failed: {response['message']}")
    except Exception as e:
        logger.error(f"{position_type} order placement error: {e}")
        raise HTTPException(status_code=400, detail=f"{position_type} order placement error: {str(e)}")

def update_open_positions(username: str, symbol: str, entry_price: float, conditions: Dict, position_type: str):
    """
    Update or insert open position in the database with all thresholds.
    """
    cursor.execute("""
        INSERT OR REPLACE INTO open_positions (username, symbol, entry_price, buy_threshold, sell_threshold, 
                                              exit_condition_type, exit_condition_value, points_condition, position_type, position_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    """, (username, symbol, entry_price, 
          conditions.get('buy_threshold', None) if position_type == "LONG" else None,
          conditions.get('sell_threshold', None) if position_type == "SHORT" else None,
          conditions.get('exit_condition_type', None),
          conditions.get('exit_condition_value', None),
          conditions.get('points_condition', None),
          position_type))
    conn.commit()

def get_open_position(username: str, symbol: str, position_type: str):
    """
    Retrieve open position details from the database.
    """
    cursor.execute("SELECT * FROM open_positions WHERE username = ? AND symbol = ? AND position_type = ? AND position_active = 1", 
                   (username, symbol, position_type))
    result = cursor.fetchone()
    if result:
        return dict(zip(["username", "symbol", "entry_price", "buy_threshold", "sell_threshold", "exit_condition_type", 
                         "exit_condition_value", "points_condition", "position_type", "position_active"], result))
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
            position_data = dict(zip(["username", "symbol", "entry_price", "buy_threshold", "sell_threshold", "exit_condition_type", 
                                    "exit_condition_value", "points_condition", "position_type", "position_active"], position))
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
    Check exit conditions in real-time and execute sell if met for LONG, buy if met for SHORT, then stop trading.
    """
    username = position_data['username']
    symbol = position_data['symbol']
    entry_price = position_data['entry_price']
    position_type = position_data['position_type']
    exit_condition_type = position_data['exit_condition_type']
    exit_condition_value = position_data['exit_condition_value']
    points_condition = position_data['points_condition']
    trailing_base = entry_price  # Simplified for this example; in practice, track high

    should_exit = False

    if position_type == "LONG":
        # For LONG positions (buy), check for sell conditions
        if exit_condition_type == "Fixed":
            exit_threshold = entry_price - exit_condition_value
            if ltp <= exit_threshold:
                logger.info(f"Fixed Stop-Loss triggered for LONG position of user {username}, symbol {symbol}: LTP ({ltp}) <= Exit Threshold ({exit_threshold})")
                should_exit = True
        elif exit_condition_type == "Percentage":
            current_high = max(ltp, trailing_base)
            trailing_stop = trailing_base + (current_high - trailing_base) * (1 - exit_condition_value / 100)
            if points_condition and ltp < trailing_base + points_condition:
                trailing_base = ltp
            if ltp <= trailing_stop:
                logger.info(f"Percentage Trailing Stop-Loss triggered for LONG position of user {username}, symbol {symbol}: LTP ({ltp}) <= Trailing Stop ({trailing_stop})")
                should_exit = True
        elif exit_condition_type == "Points":
            trailing_stop = max(ltp, trailing_base) - exit_condition_value
            if ltp <= trailing_stop:
                logger.info(f"Points Trailing Stop-Loss triggered for LONG position of user {username}, symbol {symbol}: LTP ({ltp}) <= Trailing Stop ({trailing_stop})")
                should_exit = True

        if should_exit:
            orderparams = {
                "variety": "NORMAL",
                "tradingsymbol": symbol,
                "symboltoken": symbol,  # Adjust if symboltoken differs
                "transactiontype": "SELL",
                "exchange": "NSE",
                "ordertype": "MARKET",
                "producttype": "INTRADAY",
                "duration": "DAY",
                "price": "0",
                "quantity": str(entry_price),
                "squareoff": "0",
                "stoploss": "0"
            }
            place_order(smartApi, orderparams, "LONG")
            cursor.execute("UPDATE open_positions SET position_active = 0 WHERE username = ? AND symbol = ? AND position_type = ?", 
                           (username, symbol, "LONG"))
            conn.commit()
            logger.info(f"LONG position for user {username} and symbol {symbol} sold and stopped.")

    elif position_type == "SHORT":
        # For SHORT positions (sell), check for buy-back conditions (stop-gain or stop-loss)
        if exit_condition_type == "Fixed":
            exit_threshold = entry_price + exit_condition_value  # For short, exit when price rises
            if ltp >= exit_threshold:
                logger.info(f"Fixed Stop-Gain triggered for SHORT position of user {username}, symbol {symbol}: LTP ({ltp}) >= Exit Threshold ({exit_threshold})")
                should_exit = True
        elif exit_condition_type == "Percentage":
            current_low = min(ltp, trailing_base)
            trailing_stop = trailing_base - (trailing_base - current_low) * (1 - exit_condition_value / 100)
            if points_condition and ltp > trailing_base - points_condition:
                trailing_base = ltp
            if ltp >= trailing_stop:
                logger.info(f"Percentage Trailing Stop-Gain triggered for SHORT position of user {username}, symbol {symbol}: LTP ({ltp}) >= Trailing Stop ({trailing_stop})")
                should_exit = True
        elif exit_condition_type == "Points":
            trailing_stop = min(ltp, trailing_base) + exit_condition_value
            if ltp >= trailing_stop:
                logger.info(f"Points Trailing Stop-Gain triggered for SHORT position of user {username}, symbol {symbol}: LTP ({ltp}) >= Trailing Stop ({trailing_stop})")
                should_exit = True

        if should_exit:
            orderparams = {
                "variety": "NORMAL",
                "tradingsymbol": symbol,
                "symboltoken": symbol,  # Adjust if symboltoken differs
                "transactiontype": "BUY",  # Buy back to close short
                "exchange": "NSE",
                "ordertype": "MARKET",
                "producttype": "INTRADAY",
                "duration": "DAY",
                "price": "0",
                "quantity": str(entry_price),
                "squareoff": "0",
                "stoploss": "0"
            }
            place_order(smartApi, orderparams, "SHORT")
            cursor.execute("UPDATE open_positions SET position_active = 0 WHERE username = ? AND symbol = ? AND position_type = ?", 
                           (username, symbol, "SHORT"))
            conn.commit()
            logger.info(f"SHORT position for user {username} and symbol {symbol} bought back and stopped.")

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
    return {"users": [dict(zip(["username", "password", "broker", "api_key", "totp_token", "default_quantity"], row))
                      for row in users]}

@app.delete("/api/delete_user/{username}")
def delete_user(username: str):
    cursor.execute("DELETE FROM users WHERE username = ?", (username,))
    cursor.execute("DELETE FROM open_positions WHERE username = ?", (username,))
    conn.commit()
    if username in smart_api_instances:
        del smart_api_instances[username]
    return {"message": f"User {username} and their positions deleted successfully"}

@app.get("/api/get_trades")
def get_trades():
    cursor.execute("SELECT * FROM open_positions")
    trades = cursor.fetchall()
    return {"trades": [dict(zip(["username", "symbol", "entry_price", "buy_threshold", "sell_threshold",
                                 "exit_condition_type", "exit_condition_value", "points_condition", "position_type"], row))
                       for row in trades]}

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

@app.post("/api/initiate_trade")
async def initiate_trade(request: TradeRequest):
    """
    Endpoint to initiate either a buy (LONG) or sell (SHORT) trade with exit conditions, stopping after exit.
    """
    try:
        username = request.username
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail="User not authenticated")

        smartApi = smart_api_instances[username]
        params = request.dict()

        # Determine position type based on action (simplified to buy for now, can extend to sell)
        position_type = "LONG"  # Default to buy; add logic for "SHORT" if needed

        # Calculate entry threshold (buy or sell)
        strike_price = params['strike_price']
        if position_type == "LONG":
            buy_threshold_offset = params['buy_threshold_offset']
            buy_percentage = params['buy_percentage']
            entry_threshold = None
            if buy_threshold_offset is not None:
                entry_threshold = strike_price + buy_threshold_offset
            elif buy_percentage is not None:
                entry_threshold = strike_place * (1 + buy_percentage/100)

            if entry_threshold is None:
                raise HTTPException(status_code=400, detail="No buy condition provided")

            # Get current LTP
            ltp = get_ltp(smartApi, params['exchange'], params['tradingsymbol'], params['symboltoken'])
            if ltp < entry_threshold:
                raise HTTPException(status_code=400, detail="Current LTP does not meet buy condition")

            # Place buy order
            quantity = str(params.get('default_quantity', 1))
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

        else:  # SHORT position
            sell_threshold_offset = params['sell_threshold_offset']
            sell_percentage = params['sell_percentage']
            entry_threshold = None
            if sell_threshold_offset is not None:
                entry_threshold = strike_price + sell_threshold_offset
            elif sell_percentage is not None:
                entry_threshold = strike_price * (1 - sell_percentage/100)

            if entry_threshold is None:
                raise HTTPException(status_code=400, detail="No sell condition provided")

            ltp = get_ltp(smartApi, params['exchange'], params['tradingsymbol'], params['symboltoken'])
            if ltp > entry_threshold:
                raise HTTPException(status_code=400, detail="Current LTP does not meet sell condition")

            # Place sell order
            quantity = str(params.get('default_quantity', 1))
            orderparams = {
                "variety": "NORMAL",
                "tradingsymbol": params['tradingsymbol'],
                "symboltoken": params['symboltoken'],
                "transactiontype": "SELL",
                "exchange": params['exchange'],
                "ordertype": "MARKET",
                "producttype": params['producttype'],
                "duration": "DAY",
                "price": "0",
                "quantity": quantity,
                "squareoff": "0",
                "stoploss": "0"
            }

        result = place_order(smartApi, orderparams, position_type)

        # Calculate exit conditions
        exit_condition_type = params['stop_loss_type'] if params['stop_loss_type'] else "Fixed"
        exit_condition_value = params['stop_loss_value'] if params['stop_loss_value'] else 5.0
        points_condition = params['points_condition'] if params['points_condition'] is not None else 0

        conditions = {
            'buy_threshold': entry_threshold if position_type == "LONG" else None,
            'sell_threshold': entry_threshold if position_type == "SHORT" else None,
            'exit_condition_type': exit_condition_type,
            'exit_condition_value': exit_condition_value,
            'points_condition': points_condition
        }

        # Update open positions
        update_open_positions(username, params['tradingsymbol'], ltp, conditions, position_type)

        return {"message": f"{position_type} trade initiated for user {username}", "data": result}

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Trade initiation error for user {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error for user {username}: {str(e)}")

@app.get("/status")
def status():
    return {"message": "FastAPI server is running!"}

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