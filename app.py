from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import List
from SmartApi import SmartConnect  # or: from SmartApi.smartConnect import SmartConnect
import pyotp
import threading
import time
import sqlite3
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import pandas as pd
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
    password TEXT,  -- New field for storing the password
    broker TEXT,
    api_key TEXT,
    totp_token TEXT,
    default_quantity INTEGER
)
""")


# Updated open_positions table with new buy_threshold and sell_threshold columns.
cursor.execute("""
CREATE TABLE IF NOT EXISTS open_positions (
    username TEXT,
    symbol TEXT,
    entry_price REAL,
    buy_threshold REAL,    -- New field for buy trigger (for LONG positions)
    sell_threshold REAL,   -- New field for sell trigger (for SHORT positions)
    exit_condition_type TEXT,  -- "Fixed", "Percentage" or "Points"
    exit_condition_value REAL, -- For stop–loss (long) or stop–gain (short)
    points_condition REAL,     -- For trailing adjustments (if needed)
    position_type TEXT,        -- "LONG" for buy trades, "SHORT" for sell trades
    PRIMARY KEY (username, symbol, position_type)
)
""")
conn.commit()

# ------------------------------
# Utility Function to Get Previous Close
# ------------------------------
def get_previous_close(symbol: str, smartApi_instance: SmartConnect = None) -> float:
    """
    Dummy implementation to return a previous close value.
    Replace this with actual logic to fetch the previous close.
    """
    return 100.0

# ------------------------------
# Condition Check Functions (Fixed, Percentage & Points)
# ------------------------------
def check_buy_conditions(condition_type: str, condition_value: float, symbol: str, ltp: float, buy_threshold: float,
                         smartApi_instance: SmartConnect = None) -> bool:
    if condition_type == "Fixed Value":
        return ltp >= condition_value
    elif condition_type == "Percentage":
        previous_close = get_previous_close(symbol, smartApi_instance)
        return ltp >= previous_close * (1 + condition_value / 100.0)
    elif condition_type == "Points":
        return ltp >= buy_threshold + condition_value
    else:
        return False

def check_sell_conditions(condition_type: str, condition_value: float, symbol: str, ltp: float, sell_threshold: float,
                          smartApi_instance: SmartConnect = None) -> bool:
    if condition_type == "Fixed Value":
        return ltp <= condition_value
    elif condition_type == "Percentage":
        previous_close = get_previous_close(symbol, smartApi_instance)
        return ltp <= previous_close * (1 - condition_value / 100.0)
    elif condition_type == "Points":
        return ltp <= sell_threshold - condition_value
    else:
        return False

# ------------------------------
# Pydantic Models for API Requests
# ------------------------------
class User(BaseModel):
    username: str
    password: str  # New field
    broker: str
    api_key: str
    totp_token: str
    default_quantity: int


from pydantic import BaseModel, Field
from typing import List

class BuyRequest(BaseModel):
    users: List[str]
    symbol: str
    buy_threshold: float = Field(..., description="The price at which to initiate a buy")
    buy_condition_type: str = Field(..., description="Type of buy condition: 'Fixed Value', 'Percentage', or 'Points'")
    buy_condition_value: float = Field(..., description="Value associated with the buy condition")
    stop_loss_type: str = Field(..., description="Type of stop-loss: 'Fixed', 'Percentage', or 'Points'")
    stop_loss_value: float = Field(..., description="Value associated with the stop-loss")
    points_condition: float = Field(..., description="Points adjustment for trailing stops")

class SellRequest(BaseModel):
    users: List[str]
    symbol: str
    sell_threshold: float = Field(..., description="The price at which to initiate a sell")
    sell_condition_type: str = Field(..., description="Type of sell condition: 'Fixed Value', 'Percentage', or 'Points'")
    sell_condition_value: float = Field(..., description="Value associated with the sell condition")
    stop_gain_type: str = Field(..., description="Type of stop-gain: 'Fixed', 'Percentage', or 'Points'")
    stop_gain_value: float = Field(..., description="Value associated with the stop-gain")
    points_condition: float = Field(..., description="Points adjustment for trailing stops")

# ------------------------------
# WebSocket Connection Manager
# ------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
    
    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting message: {e}")

manager = ConnectionManager()

@app.websocket("/ws/trades")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ------------------------------
# User Management Endpoints
# ------------------------------
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
    return {"users": [dict(zip(["username","password", "broker", "api_key", "totp_token", "default_quantity"], row))
                       for row in users]}

@app.delete("/api/delete_user/{username}")
def delete_user(username: str):
    cursor.execute("DELETE FROM users WHERE username = ?", (username,))
    conn.commit()
    return {"message": f"User {username} deleted successfully"}

# ------------------------------
# Endpoint to Get Trade Data (Open Positions)
# ------------------------------
@app.get("/api/get_trades")
def get_trades():
    cursor.execute("SELECT * FROM open_positions")
    trades = cursor.fetchall()
    return {"trades": [dict(zip(["username", "symbol", "entry_price", "buy_threshold", "sell_threshold",
                                  "exit_condition_type", "exit_condition_value", "points_condition", "position_type"], row))
                       for row in trades]}


def check_buy_conditions(condition_type: str, condition_value: float, symbol: str, ltp: float, buy_threshold: float,
                         smartApi_instance: SmartConnect = None) -> bool:
    if condition_type == "Fixed Value":
        return ltp >= buy_threshold
    elif condition_type == "Percentage":
        previous_close = get_previous_close(symbol, smartApi_instance)
        return ltp >= previous_close * (1 + condition_value / 100.0)
    elif condition_type == "Points":
        return ltp >= buy_threshold + condition_value
    else:
        return False

def check_sell_conditions(condition_type: str, condition_value: float, symbol: str, ltp: float, sell_threshold: float,
                          smartApi_instance: SmartConnect = None) -> bool:
    if condition_type == "Fixed Value":
        return ltp <= sell_threshold
    elif condition_type == "Percentage":
        previous_close = get_previous_close(symbol, smartApi_instance)
        return ltp <= previous_close * (1 - condition_value / 100.0)
    elif condition_type == "Points":
        return ltp <= sell_threshold - condition_value
    else:
        return False
    


# Load Excel at app startup
@app.on_event("startup")
async def load_excel_data():
    global symbol_data
    try:
        symbol_data = pd.read_excel('OpenAPIScripMaster.xlsx').set_index('symbol')['symboltoken'].to_dict()
    except FileNotFoundError:
        logger.error("Excel file 'OpenAPIScripMaster.xlsx' not found.")
        symbol_data = {}
    except Exception as e:
        logger.error(f"Failed to load Excel data: {e}")
        symbol_data = {}

# Example of using the loaded data in an endpoint
@app.get("/api/get_token/{symbol}")
async def get_token(symbol: str):
    if symbol in symbol_data:
        return {"symbol": symbol, "token": symbol_data[symbol]}
    else:
        raise HTTPException(status_code=404, detail="Symbol not found")
    
@app.get("/api/get_excel_data")
def get_excel_data():
    try:
        df = pd.read_excel('path/to/OpenAPIScripMaster.xlsx')
        data = df.to_dict('records')
        print(f"Data from Excel: {data}")  # Log the data
        return {"data": data}
    except Exception as e:
        print(f"Error reading Excel file: {e}")
        return {"data": []}
# ------------------------------
# BUY TRADE Endpoint (Long Position)
# ------------------------------
@app.post("/api/buy_trade")
def execute_buy_trade(request: BuyRequest):
    responses = []
    for username in request.users:
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        user_data = cursor.fetchone()
        if not user_data:
            responses.append({"user": username, "status": "error", "message": "User not found"})
            continue

        user_dict = dict(zip(["username", "password", "broker", "api_key", "totp_token", "default_quantity"], user_data))
        smartApi = SmartConnect(api_key=user_dict["api_key"])

        try:
            totp = pyotp.TOTP(user_dict["totp_token"]).now()
        except Exception as e:
            logger.error(f"Invalid TOTP for user {username}: {e}")
            responses.append({"user": username, "status": "error", "message": "Invalid TOTP"})
            continue

        login_data = smartApi.generateSession(user_dict["username"], user_dict["password"], totp)
        logger.info(f"Login for {username} result: {login_data}")
        if not login_data["status"]:
            responses.append({"user": username, "status": "error", "message": "Login Failed"})
            continue

        # Fetch LTP
        ltp_response = smartApi.ltpData(exchange="NSE", tradingsymbol=request.symbol, symboltoken=request.symbol)
        logger.info(f"LTP fetch for {request.symbol}: {ltp_response}")
        if not ltp_response["status"]:
            responses.append({"user": username, "status": "error", "message": "LTP Fetch Failed"})
            continue
        ltp = ltp_response["data"]["ltp"]

        if check_buy_conditions(request.buy_condition_type, request.buy_condition_value, request.symbol, ltp, request.buy_threshold, smartApi):
            order_params = {
                "variety": "NORMAL",
                "tradingsymbol": request.symbol,
                "symboltoken": request.symbol,
                "transactiontype": "BUY",
                "exchange": "NSE",
                "ordertype": "LIMIT",
                "producttype": "INTRADAY",
                "duration": "DAY",
                "price": ltp,
                "quantity": user_dict["default_quantity"],
            }
            try:
                order_response = smartApi.placeOrder(order_params)
                logger.info(f"Order response for {username}: {order_response}")
                if order_response["status"]:
                    cursor.execute("""
                        INSERT INTO open_positions (username, symbol, entry_price, buy_threshold, exit_condition_type,
                                                      exit_condition_value, points_condition, position_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (username, request.symbol, ltp, request.buy_threshold, request.stop_loss_type,
                          request.stop_loss_value, request.points_condition, "LONG"))
                    conn.commit()
                    responses.append({"user": username, "status": "success", "message": f"BUY order placed at {ltp}"})
                    new_order = {
                        "user": username,
                        "action": "BUY",
                        "price": ltp,
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    }
                    threading.Thread(target=lambda: asyncio.run(manager.broadcast(new_order))).start()
                    threading.Thread(target=monitor_long_position, args=(username, request.symbol)).start()
                else:
                    responses.append({"user": username, "status": "error", "message": "Buy Order Failed"})
            except Exception as e:
                logger.error(f"Error placing order for {username}: {e}")
                responses.append({"user": username, "status": "error", "message": f"Exception during order placement: {str(e)}"})
        else:
            responses.append({"user": username, "status": "skipped", "message": "Buy condition not met"})
    return responses


@app.post("/api/sell_trade")
def execute_sell_trade(request: SellRequest):
    responses = []
    for username in request.users:
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        user_data = cursor.fetchone()
        if not user_data:
            responses.append({"user": username, "status": "error", "message": "User not found"})
            continue

        user_dict = dict(zip(["username", "password", "broker", "api_key", "totp_token", "default_quantity"], user_data))
        smartApi = SmartConnect(api_key=user_dict["api_key"])

        try:
            totp = pyotp.TOTP(user_dict["totp_token"]).now()
        except Exception as e:
            logger.error(f"Invalid TOTP for user {username}: {e}")
            responses.append({"user": username, "status": "error", "message": "Invalid TOTP"})
            continue

        login_data = smartApi.generateSession(user_dict["username"], user_dict["password"], totp)
        logger.info(f"Login for {username} result: {login_data}")
        if not login_data["status"]:
            responses.append({"user": username, "status": "error", "message": "Login Failed"})
            continue

        ltp_response = smartApi.ltpData(exchange="NSE", tradingsymbol=request.symbol, symboltoken=request.symbol)
        logger.info(f"LTP fetch for {request.symbol}: {ltp_response}")
        if not ltp_response["status"]:
            responses.append({"user": username, "status": "error", "message": "LTP Fetch Failed"})
            continue
        ltp = ltp_response["data"]["ltp"]

        if check_sell_conditions(request.sell_condition_type, request.sell_condition_value, request.symbol, ltp, request.sell_threshold, smartApi):
            order_params = {
                "variety": "NORMAL",
                "tradingsymbol": request.symbol,
                "symboltoken": request.symbol,
                "transactiontype": "SELL",
                "exchange": "NSE",
                "ordertype": "LIMIT",
                "producttype": "INTRADAY",
                "duration": "DAY",
                "price": ltp,
                "quantity": user_dict["default_quantity"],
            }
            try:
                order_response = smartApi.placeOrder(order_params)
                logger.info(f"Order response for {username}: {order_response}")
                if order_response["status"]:
                    cursor.execute("""
                        INSERT INTO open_positions (username, symbol, entry_price, sell_threshold, exit_condition_type,
                                                      exit_condition_value, points_condition, position_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (username, request.symbol, ltp, request.sell_threshold, request.stop_gain_type,
                          request.stop_gain_value, request.points_condition, "SHORT"))
                    conn.commit()
                    responses.append({"user": username, "status": "success", "message": f"SELL order placed at {ltp}"})
                    new_order = {
                        "user": username,
                        "action": "SELL",
                        "price": ltp,
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    }
                    threading.Thread(target=lambda: asyncio.run(manager.broadcast(new_order))).start()
                    threading.Thread(target=monitor_short_position, args=(username, request.symbol)).start()
                else:
                    responses.append({"user": username, "status": "error", "message": "Sell Order Failed"})
            except Exception as e:
                logger.error(f"Error placing order for {username}: {e}")
                responses.append({"user": username, "status": "error", "message": f"Exception during order placement: {str(e)}"})
        else:
            responses.append({"user": username, "status": "skipped", "message": "Sell condition not met"})
    return responses

# ------------------------------
# Monitoring for Long Positions (Buy Trades)
# ------------------------------
def monitor_long_position(username: str, symbol: str):
    time.sleep(2)  # Allow order execution time
    cursor.execute("""
        SELECT * FROM open_positions 
        WHERE username = ? AND symbol = ? AND position_type = ?
    """, (username, symbol, "LONG"))
    row = cursor.fetchone()
    if not row:
        return
    position = dict(zip(
        ["username", "symbol", "entry_price", "buy_threshold", "sell_threshold", "exit_condition_type", "exit_condition_value", "points_condition", "position_type"],
        row))
    entry_price = position["entry_price"]
    stop_type = position["exit_condition_type"]
    stop_value = position["exit_condition_value"]
    points_cond = position["points_condition"]

    base = entry_price
    high_price = entry_price

    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    user_data = cursor.fetchone()
    if not user_data:
        return
    user_dict = dict(zip(["username", "broker", "api_key", "totp_token", "default_quantity"], user_data))
    smartApi = SmartConnect(api_key=user_dict["api_key"])

    while True:
        try:
            ltp_response = smartApi.ltpData(exchange="NSE", tradingsymbol=symbol, symboltoken=symbol)
            if not ltp_response["status"]:
                time.sleep(1)
                continue
            ltp = ltp_response["data"]["ltp"]
            trigger_exit = False

            if stop_type == "Fixed":
                if ltp <= stop_value:
                    trigger_exit = True
            elif stop_type == "Percentage":
                if points_cond < 0 and ltp < base + points_cond:
                    base = ltp
                    high_price = ltp
                if ltp > high_price:
                    high_price = ltp
                trailing_stop = base + (high_price - base) * (stop_value / 100.0)
                if ltp <= trailing_stop:
                    trigger_exit = True
            elif stop_type == "Points":
                if ltp > high_price:
                    high_price = ltp
                trailing_stop = high_price - stop_value
                if ltp <= trailing_stop:
                    trigger_exit = True

            if trigger_exit:
                order_params = {
                    "variety": "NORMAL",
                    "tradingsymbol": symbol,
                    "symboltoken": symbol,
                    "transactiontype": "SELL",
                    "exchange": "NSE",
                    "ordertype": "MARKET",
                    "producttype": "INTRADAY",
                    "duration": "DAY",
                    "price": ltp,
                    "quantity": user_dict["default_quantity"],
                }
                order_response = smartApi.placeOrder(order_params)
                if order_response["status"]:
                    logger.info(f"Long position stop triggered! SELL at {ltp} for user {username}")
                    cursor.execute("""
                        DELETE FROM open_positions 
                        WHERE username = ? AND symbol = ? AND position_type = ?
                    """, (username, symbol, "LONG"))
                    conn.commit()
                break

        except Exception as e:
            logger.error(f"Error monitoring long position for {username}: {e}")
        time.sleep(1)


       

# ------------------------------
# Monitoring for Short Positions (Sell Trades)
# ------------------------------
def monitor_short_position(username: str, symbol: str):
    time.sleep(2)  # Allow order execution time
    cursor.execute("""
        SELECT * FROM open_positions 
        WHERE username = ? AND symbol = ? AND position_type = ?
    """, (username, symbol, "SHORT"))
    row = cursor.fetchone()
    if not row:
        return
    position = dict(zip(
        ["username", "symbol", "entry_price", "buy_threshold", "sell_threshold", "exit_condition_type", "exit_condition_value", "points_condition", "position_type"],
        row))
    entry_price = position["entry_price"]
    stop_type = position["exit_condition_type"]
    stop_value = position["exit_condition_value"]
    points_cond = position["points_condition"]

    base = entry_price
    low_price = entry_price

    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    user_data = cursor.fetchone()
    if not user_data:
        return
    user_dict = dict(zip(["username", "broker", "api_key", "totp_token", "default_quantity"], user_data))
    smartApi = SmartConnect(api_key=user_dict["api_key"])

    while True:
        try:
            ltp_response = smartApi.ltpData(exchange="NSE", tradingsymbol=symbol, symboltoken=symbol)
            if not ltp_response["status"]:
                time.sleep(1)
                continue
            ltp = ltp_response["data"]["ltp"]
            trigger_exit = False

            if stop_type == "Fixed":
                if ltp >= stop_value:
                    trigger_exit = True
            elif stop_type == "Percentage":
                if points_cond > 0 and ltp > base + points_cond:
                    base = ltp
                    low_price = ltp
                if ltp < low_price:
                    low_price = ltp
                trailing_stop = base - (base - low_price) * (stop_value / 100.0)
                if ltp >= trailing_stop:
                    trigger_exit = True
            elif stop_type == "Points":
                if ltp < low_price:
                    low_price = ltp
                trailing_stop = low_price + stop_value
                if ltp >= trailing_stop:
                    trigger_exit = True
            else:
                if ltp >= stop_value:
                    trigger_exit = True

            if trigger_exit:
                order_params = {
                    "variety": "NORMAL",
                    "tradingsymbol": symbol,
                    "symboltoken": symbol,
                    "transactiontype": "BUY",  # Cover the short position
                    "exchange": "NSE",
                    "ordertype": "MARKET",
                    "producttype": "INTRADAY",
                    "duration": "DAY",
                    "price": ltp,
                    "quantity": user_dict["default_quantity"],
                }
                order_response = smartApi.placeOrder(order_params)
                if order_response["status"]:
                    logger.info(f"Short position stop triggered! BUY (cover) at {ltp} for user {username}")
                    cursor.execute("""
                        DELETE FROM open_positions 
                        WHERE username = ? AND symbol = ? AND position_type = ?
                    """, (username, symbol, "SHORT"))
                    conn.commit()
                break

        except Exception as e:
            logger.error(f"Error monitoring short position for {username}: {e}")
        time.sleep(1)

# ------------------------------
# Status Endpoint
# ------------------------------
@app.get("/status")
def status():
    return {"message": "FastAPI server is running!"} 