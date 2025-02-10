from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from SmartApi import SmartConnect
import pyotp
import threading
import time
import sqlite3
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware

# Initialize FastAPI
app = FastAPI()

# Enable CORS for React Frontend Communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all frontend origins
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
)


@app.get("/")
def read_root():
    return {"message": "Hello, your API is running!"}


# Connect to SQLite Database
conn = sqlite3.connect("trading.db", check_same_thread=False)
cursor = conn.cursor()

# Create Tables
cursor.execute("""
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
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
    stop_loss_type TEXT,
    stop_loss_value REAL,
    points_condition REAL,
    PRIMARY KEY (username, symbol)
)
""")
conn.commit()

# --- User Model ---
class User(BaseModel):
    username: str
    broker: str
    api_key: str
    totp_token: str
    default_quantity: int

# --- Buy Request Model ---
class BuyRequest(BaseModel):
    users: List[str]
    symbol: str
    buy_threshold: float
    buy_condition_type: str
    buy_condition_value: float
    stop_loss_type: str  # Fixed, Percentage, Points
    stop_loss_value: float
    points_condition: float  # Used for trailing stop loss

# --- REGISTER USER ---
@app.post("/api/register_user")
def register_user(user: User):
    try:
        cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?)", 
                    (user.username, user.broker, user.api_key, user.totp_token, user.default_quantity))
        conn.commit()
        return {"message": "User registered successfully"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="User already exists")

# --- FETCH ALL USERS ---
@app.get("/api/get_users")
def get_users():
    cursor.execute("SELECT * FROM users")
    users = cursor.fetchall()
    return {"users": [dict(zip(["username", "broker", "api_key", "totp_token", "default_quantity"], row)) for row in users]}

# --- DELETE USER ---
@app.delete("/api/delete_user/{username}")
def delete_user(username: str):
    cursor.execute("DELETE FROM users WHERE username = ?", (username,))
    conn.commit()
    return {"message": f"User {username} deleted successfully"}

# --- EXECUTE BUY TRADE + STOP-LOSS LOGIC ---
@app.post("/api/buy_trade")
def execute_buy_trade(request: BuyRequest):
    responses = []

    for username in request.users:
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        user_data = cursor.fetchone()

        if not user_data:
            responses.append({"user": username, "status": "error", "message": "User not found"})
            continue

        user_dict = dict(zip(["username", "broker", "api_key", "totp_token", "default_quantity"], user_data))
        smartApi = SmartConnect(api_key=user_dict["api_key"])

        # Generate TOTP
        try:
            totp = pyotp.TOTP(user_dict["totp_token"]).now()
        except Exception:
            responses.append({"user": username, "status": "error", "message": "Invalid TOTP"})
            continue

        # Login
        login_data = smartApi.generateSession(user_dict["username"], "PASSWORD", totp)
        if not login_data["status"]:
            responses.append({"user": username, "status": "error", "message": "Login Failed"})
            continue

        # Fetch LTP (Last Traded Price)
        ltp_response = smartApi.ltpData(exchange="NSE", tradingsymbol=request.symbol, symboltoken=request.symbol)
        if not ltp_response["status"]:
            responses.append({"user": username, "status": "error", "message": "LTP Fetch Failed"})
            continue

        ltp = ltp_response["data"]["ltp"]
        should_buy = False

        # **BUY LOGIC**
        if request.buy_condition_type == "Fixed Value":
            should_buy = ltp >= request.buy_condition_value
        elif request.buy_condition_type == "Percentage":
            previous_close = 100  # Example value (should fetch dynamically)
            should_buy = ltp >= previous_close * (1 + request.buy_condition_value / 100)

        # **EXECUTE BUY ORDER**
        if should_buy:
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

            order_response = smartApi.placeOrder(order_params)
            if order_response["status"]:
                cursor.execute("""
                    INSERT INTO open_positions (username, symbol, entry_price, stop_loss_type, stop_loss_value, points_condition) 
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (username, request.symbol, ltp, request.stop_loss_type, request.stop_loss_value, request.points_condition))
                conn.commit()

                responses.append({"user": username, "status": "success", "message": f"BUY order placed at {ltp}"})

                # Start stop-loss monitoring in a new thread
                threading.Thread(target=monitor_stop_loss, args=(username, request.symbol)).start()
                
            else:
                responses.append({"user": username, "status": "error", "message": "Buy Order Failed"})

        else:
            responses.append({"user": username, "status": "skipped", "message": "Condition not met"})

    return responses


# --- MONITOR STOP-LOSS AND EXECUTE SELL ORDER ---
def monitor_stop_loss(username, symbol):
    time.sleep(2)  # Small delay to ensure order execution
    cursor.execute("SELECT * FROM open_positions WHERE username = ? AND symbol = ?", (username, symbol))
    position = cursor.fetchone()

    if not position:
        return

    position_dict = dict(zip(["username", "symbol", "entry_price", "stop_loss_type", "stop_loss_value", "points_condition"], position))

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
                continue

            ltp = ltp_response["data"]["ltp"]
            stop_loss_value = position_dict["stop_loss_value"]
            trigger_sell = ltp <= stop_loss_value

            if trigger_sell:
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
                    logger.info(f"STOP-LOSS Triggered! SELL at {ltp} for user {username}")
                    cursor.execute("DELETE FROM open_positions WHERE username = ? AND symbol = ?", (username, symbol))
                    conn.commit()
                break

        except Exception as e:
            logger.error(f"Error in stop-loss monitoring: {e}")

        time.sleep(1)  # Check price every second
        
@app.get("/")
def read_root():
    return {"message": "FastAPI server is running!"}