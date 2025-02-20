from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from SmartApi import SmartConnect  # Angel Broking
from SmartApi.smartWebSocketV2 import SmartWebSocketV2  # Angel Broking WebSocket
from api_helper import ShoonyaApiPy  # Shoonya
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
    broker TEXT,  -- "Angel" or "Shoonya"
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
    broker: str  # "Angel" or "Shoonya"
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
    producttype: str = "INTRADAY"  # Default for Angel, adjust for Shoonya
    stop_loss_type: str = "Fixed"  # "Fixed", "Percentage", or "Points"
    stop_loss_value: float = 5.0  # Value for stop-loss (price, percentage, or points)
    points_condition: float = 0  # For trailing stop-loss adjustments

class UpdateTradeRequest(BaseModel):
    username: str
    position_id: str
    stop_loss_type: Optional[str] = "Fixed"
    stop_loss_value: Optional[float] = 5.0
    points_condition: Optional[float] = 0

# Store API instances for both brokers
smart_api_instances = {}  # For Angel Broking
shoonya_api_instances = {}  # For Shoonya
ltp_cache = {}

def authenticate_angel(username: str, password: str, api_key: str, totp_token: str):
    smartApi = SmartConnect(api_key)
    try:
        totp = pyotp.TOTP(totp_token).now()
        data = smartApi.generateSession(username, password, totp)
        if data['status'] == False:
            logger.error(f"Authentication failed for {username} (Angel): {data}")
            raise Exception("Authentication failed")
        authToken = data['data']['jwtToken']
        feedToken = smartApi.getfeedToken()
        smart_api_instances[username] = smartApi
        return smartApi, authToken, feedToken
    except Exception as e:
        logger.error(f"Authentication error for {username} (Angel): {e}")
        raise

def authenticate_shoonya(username: str, password: str, api_key: str, totp_token: str):
    shoonyaApi = ShoonyaApiPy()
    try:
        totp = pyotp.TOTP(totp_token).now()
        ret = shoonyaApi.login(
            userid=username,
            password=password,
            twoFA=totp,
            vendor_code=api_key,  # Using api_key as vendor_code for Shoonya
            api_secret=api_key,   # Using api_key as api_secret for Shoonya
            imei="unique_identifier"  # Replace with actual IMEI or device identifier
        )
        if ret['stat'] != 'Ok':
            logger.error(f"Authentication failed for {username} (Shoonya): {ret}")
            raise Exception("Authentication failed")
        susertoken = ret['susertoken']
        shoonya_api_instances[username] = shoonyaApi
        return shoonyaApi, susertoken, None  # Shoonya doesn't use feedToken like Angel
    except Exception as e:
        logger.error(f"Authentication error for {username} (Shoonya): {e}")
        raise

def get_api_instance(username: str):
    cursor.execute("SELECT broker FROM users WHERE username = ?", (username,))
    broker = cursor.fetchone()
    if not broker:
        raise HTTPException(status_code=404, detail=f"User {username} not found")
    broker = broker[0]
    if broker == "Angel":
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail=f"User {username} not authenticated (Angel)")
        return smart_api_instances[username], "Angel"
    elif broker == "Shoonya":
        if username not in shoonya_api_instances:
            raise HTTPException(status_code=401, detail=f"User {username} not authenticated (Shoonya)")
        return shoonya_api_instances[username], "Shoonya"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported broker: {broker}")

def get_ltp(api_instance, broker, exchange, tradingsymbol, symboltoken):
    try:
        if broker == "Angel":
            symbol_key = f"{exchange}:{tradingsymbol}:{symboltoken}"
            if symbol_key in ltp_cache:
                return ltp_cache[symbol_key]
            ltp_data = api_instance.ltpData(exchange, tradingsymbol, symboltoken)
            if ltp_data and 'data' in ltp_data and 'ltp' in ltp_data['data']:
                return float(ltp_data['data']['ltp'])
        elif broker == "Shoonya":
            quote = api_instance.get_quotes(exchange, symboltoken)
            if quote['stat'] == 'Ok' and 'lp' in quote:
                return float(quote['lp'])
        raise HTTPException(status_code=400, detail="No LTP data available")
    except Exception as e:
        logger.error(f"Error fetching LTP for {tradingsymbol} ({broker}): {e}")
        raise HTTPException(status_code=400, detail=f"LTP fetch error: {str(e)}")

def place_order(api_instance, broker, orderparams, position_type: str):
    try:
        if broker == "Angel":
            orderparams["transactiontype"] = "BUY" if position_type == "LONG" else "SELL"
            if "quantity" in orderparams and isinstance(orderparams["quantity"], int):
                orderparams["quantity"] = str(orderparams["quantity"])
            response = api_instance.placeOrderFullResponse(orderparams)
            logger.debug(f"Order placement response for {position_type} (Angel) with params {orderparams}: {response}")
            if response.get('status', False) is True or response.get('status', '').lower() == 'success':
                logger.info(f"{position_type} order placed successfully (Angel). Order ID: {response['data']['orderid']}")
                return {"order_id": response['data']['orderid'], "status": "success"}
        elif broker == "Shoonya":
            buy_or_sell = "B" if position_type == "LONG" else "S"
            # Map producttype for Shoonya (e.g., "INTRADAY" -> "I" for MIS)
            product_mapping = {
                "INTRADAY": "I",
                "DELIVERY": "C",
                "CNC": "C",
                "NRML": "M",
                "BRACKET": "B",
                "COVER": "H"
            }
            shoonya_product = product_mapping.get(orderparams.get("producttype", "INTRADAY"), "I")
            response = api_instance.place_order(
                buy_or_sell=buy_or_sell,
                product_type=shoonya_product,
                exchange=orderparams["exchange"],
                tradingsymbol=orderparams["tradingsymbol"],
                quantity=str(orderparams["quantity"]),  # Shoonya expects string
                discloseqty=0,  # Default to 0 as per example
                price_type=orderparams["ordertype"],
                price=float(orderparams.get("price", 0.0)),
                trigger_price=float(orderparams.get("stoploss", 0.0)),  # Map stop-loss as trigger_price for SL orders
                retention=orderparams.get("duration", "DAY"),
                remarks=orderparams.get("remarks", None)
            )
            logger.debug(f"Order placement response for {position_type} (Shoonya) with params {orderparams}: {response}")
            if response['stat'] == 'Ok':
                logger.info(f"{position_type} order placed successfully (Shoonya). Order ID: {response['norenordno']}")
                return {"order_id": response['norenordno'], "status": "success"}
        raise HTTPException(status_code=400, detail=f"{position_type} order placement failed: {response.get('message', 'Unknown error') or response.get('emsg', 'Unknown error')}")
    except Exception as e:
        logger.error(f"{position_type} order placement error for {broker} with params {orderparams}: {e}")
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

def on_data_angel(wsapp, message):
    global ltp_cache
    try:
        symbol_key = f"{message['exchange']}:{message['tradingsymbol']}:{message['symboltoken']}"
        ltp = float(message['ltp'])
        ltp_cache[symbol_key] = ltp
        logger.info(f"Ticks for {message['tradingsymbol']} (Angel): {message}")
        cursor.execute("SELECT * FROM open_positions WHERE symbol = ? AND position_active = 1", (message['tradingsymbol'],))
        positions = cursor.fetchall()
        for position in positions:
            pos_data = dict(zip(["position_id", "username", "symbol", "symboltoken", "entry_price", "buy_threshold", "stop_loss_type", 
                                 "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price"], position))
            username = pos_data['username']
            if username in smart_api_instances:
                smartApi = smart_api_instances[username]
                check_conditions(smartApi, "Angel", pos_data, ltp)
    except Exception as e:
        logger.error(f"Error processing WebSocket message for {message.get('tradingsymbol', 'unknown')} (Angel): {e}")

def on_data_shoonya(api_instance, message):
    global ltp_cache
    try:
        if message['t'] in ['tk', 'tf']:  # Touchline updates
            symbol_key = f"{message['e']}:{message['ts']}:{message['tk']}"
            ltp = float(message['lp'])
            ltp_cache[symbol_key] = ltp
            logger.info(f"Ticks for {message['ts']} (Shoonya): {message}")
            cursor.execute("SELECT * FROM open_positions WHERE symbol = ? AND position_active = 1", (message['ts'],))
            positions = cursor.fetchall()
            for position in positions:
                pos_data = dict(zip(["position_id", "username", "symbol", "symboltoken", "entry_price", "buy_threshold", "stop_loss_type", 
                                     "stop_loss_value", "points_condition", "position_type", "position_active", "highest_price", "base_price"], position))
                username = pos_data['username']
                if username in shoonya_api_instances:
                    shoonyaApi = shoonya_api_instances[username]
                    check_conditions(shoonyaApi, "Shoonya", pos_data, ltp)
    except Exception as e:
        logger.error(f"Error processing WebSocket message for {message.get('ts', 'unknown')} (Shoonya): {e}")

def on_open_angel(wsapp):
    logger.info("WebSocket opened (Angel)")
    cursor.execute("SELECT DISTINCT symboltoken FROM open_positions WHERE position_active = 1")
    tokens = [row[0] for row in cursor.fetchall()]
    if tokens:
        token_list = [{"exchangeType": 1, "tokens": tokens}]
        correlation_id = "abc123"
        mode = 1
        wsapp.subscribe(correlation_id, mode, token_list)

def on_open_shoonya(api_instance):
    logger.info("WebSocket opened (Shoonya)")
    cursor.execute("SELECT DISTINCT symboltoken FROM open_positions WHERE position_active = 1")
    tokens = [row[0] for row in cursor.fetchall()]
    if tokens:
        instruments = [f"{row[0]}|{row[0]}" for row in cursor.fetchall()]  # Format for Shoonya: "NSE|token"
        api_instance.subscribe(instruments)

def on_error_angel(wsapp, error):
    logger.error(f"WebSocket error (Angel): {error}")

def on_error_shoonya(api_instance, error):
    logger.error(f"WebSocket error (Shoonya): {error}")

def on_close_angel(wsapp):
    logger.info("WebSocket closed (Angel)")

def on_close_shoonya(api_instance):
    logger.info("WebSocket closed (Shoonya)")

def start_websocket_angel(username, api_key, auth_token, feed_token):
    sws = SmartWebSocketV2(auth_token, api_key, username, feed_token)
    sws.on_open = lambda: on_open_angel(sws)
    sws.on_data = lambda message: on_data_angel(sws, message)
    sws.on_error = lambda error: on_error_angel(sws, error)
    sws.on_close = lambda: on_close_angel(sws)
    sws.connect()

def start_websocket_shoonya(username, api_instance, susertoken):
    def order_update_callback(order):
        logger.info(f"Order update (Shoonya) for {username}: {order}")

    def feed_update_callback(tick):
        on_data_shoonya(api_instance, tick)

    def open_callback():
        on_open_shoonya(api_instance)

    def close_callback():
        on_close_shoonya(api_instance)

    api_instance.start_websocket(
        order_update_callback=order_update_callback,
        subscribe_callback=feed_update_callback,
        socket_open_callback=open_callback,
        socket_close_callback=close_callback
    )

def check_conditions(api_instance, broker, position_data, ltp):
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
            "variety": "NORMAL" if broker == "Angel" else None,  # Not needed for Shoonya
            "tradingsymbol": symbol,
            "symboltoken": position_data['symboltoken'],
            "transactiontype": "SELL" if broker == "Angel" else None,  # Not needed for Shoonya
            "exchange": "NSE",
            "ordertype": "MKT",  # Market order for exit
            "producttype": "INTRADAY" if broker == "Angel" else "I",  # Default for Angel, MIS for Shoonya
            "duration": "DAY",
            "price": "0",
            "quantity": default_quantity,  # Use user's default quantity for sell orders
            "squareoff": "0",
            "stoploss": "0"
        }
        place_order(api_instance, broker, orderparams, "EXIT")
        cursor.execute("UPDATE open_positions SET position_active = 0 WHERE position_id = ?", (position_id,))
        conn.commit()
        logger.info(f"Stop-loss hit for {username} ({broker}). Sold at {ltp}")

@app.on_event("startup")
async def startup_event():
    cursor.execute("SELECT * FROM users LIMIT 3")
    users = cursor.fetchall()
    for user in users:
        user_data = dict(zip(["username", "password", "broker", "api_key", "totp_token", "default_quantity"], user))
        try:
            if user_data['broker'] == "Angel":
                smartApi, auth_token, feed_token = authenticate_angel(user_data['username'], user_data['password'], user_data['api_key'], user_data['totp_token'])
                threading.Thread(target=start_websocket_angel, args=(user_data['username'], user_data['api_key'], auth_token, feed_token), daemon=True).start()
            elif user_data['broker'] == "Shoonya":
                shoonyaApi, susertoken, _ = authenticate_shoonya(user_data['username'], user_data['password'], user_data['api_key'], user_data['totp_token'])
                threading.Thread(target=start_websocket_shoonya, args=(user_data['username'], shoonyaApi, susertoken), daemon=True).start()
        except Exception as e:
            logger.error(f"Failed to authenticate user {user_data['username']} at startup ({user_data['broker']}): {e}")

@app.post("/api/register_user")
def register_user(user: User):
    try:
        if user.broker == "Angel":
            smartApi, auth_token, feed_token = authenticate_angel(user.username, user.password, user.api_key, user.totp_token)
            smart_api_instances[user.username] = smartApi
            threading.Thread(target=start_websocket_angel, args=(user.username, user.api_key, auth_token, feed_token), daemon=True).start()
        elif user.broker == "Shoonya":
            shoonyaApi, susertoken, _ = authenticate_shoonya(user.username, user.password, user.api_key, user.totp_token)
            shoonya_api_instances[user.username] = shoonyaApi
            threading.Thread(target=start_websocket_shoonya, args=(user.username, shoonyaApi, susertoken), daemon=True).start()
        else:
            raise HTTPException(status_code=400, detail="Unsupported broker")

        cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)",
                       (user.username, user.password, user.broker, user.api_key, user.totp_token, user.default_quantity))
        conn.commit()

        return {"message": f"User {user.username} registered and authenticated successfully ({user.broker})"}

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
    if username in shoonya_api_instances:
        del shoonya_api_instances[username]
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
        api_instance, broker = get_api_instance(username)
        
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
        ltp = get_ltp(api_instance, broker, params['exchange'], params['tradingsymbol'], params['symboltoken'])
        if ltp < entry_threshold:
            raise HTTPException(status_code=400, detail=f"Current LTP {ltp} below buy threshold {entry_threshold}")

        # Map producttype for Shoonya (e.g., "INTRADAY" -> "I" for MIS)
        product_mapping = {
            "INTRADAY": "I",
            "DELIVERY": "C",
            "CNC": "C",
            "NRML": "M",
            "BRACKET": "B",
            "COVER": "H"
        }
        adjusted_producttype = params['producttype']
        if broker == "Shoonya":
            adjusted_producttype = product_mapping.get(params['producttype'], "I")

        # Use the user's default_quantity instead of hardcoding "1"
        buy_order_params = {
            "variety": "NORMAL" if broker == "Angel" else None,
            "tradingsymbol": params['tradingsymbol'],
            "symboltoken": params['symboltoken'],
            "transactiontype": "BUY" if broker == "Angel" else None,
            "exchange": params['exchange'],
            "ordertype": "MKT",  # Market order for buy
            "producttype": adjusted_producttype,
            "duration": "DAY",
            "price": "0",
            "quantity": default_quantity,  # Use the user's default quantity (as an integer)
            "squareoff": "0",
            "stoploss": "0"
        }
        buy_result = place_order(api_instance, broker, buy_order_params, "LONG")
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
        return {"message": f"LONG trade initiated for {username} ({broker})", "data": buy_result, "position_id": position_id}

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Trade initiation error for {username} ({broker}): {e}")
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