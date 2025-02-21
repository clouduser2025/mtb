from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
from api_helper import ShoonyaApiPy
import pyotp
import threading
import time
import sqlite3
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
import json
import uvicorn
from datetime import datetime

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
            broker TEXT CHECK(broker IN ('Shoonya')),
            api_key TEXT,
            totp_token TEXT,
            vendor_code TEXT,
            default_quantity INTEGER
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
            previous_close REAL
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

class OptionChainRequest(BaseModel):
    username: str
    symbol: str
    expiry: str  # Format: "25 Feb 2025 W"
    strike_price: float
    option_type: str  # "Call" or "Put"

class TradeRequest(BaseModel):
    username: str
    tradingsymbol: str
    symboltoken: str
    exchange: str = "NFO"
    strike_price: float
    buy_type: str = "Fixed"
    buy_threshold: float = 110  # Default: Buy if LTP ≥ ₹110 above current
    previous_close: Optional[float] = None
    producttype: str = "INTRADAY"
    stop_loss_type: str = "Fixed"
    stop_loss_value: float = 5.0  # Default: Sell if LTP ≤ ₹5 below entry
    points_condition: float = 0
    sell_type: str = "Fixed"
    sell_threshold: float = 90  # Default: Sell if LTP ≤ ₹90 below entry

class UpdateTradeRequest(BaseModel):
    username: str
    position_id: str
    stop_loss_type: Optional[str] = "Fixed"
    stop_loss_value: Optional[float] = 5.0
    points_condition: Optional[float] = 0

smart_api_instances: Dict[str, ShoonyaApiPy] = {}
ltp_cache: Dict[str, float] = {}
auth_tokens: Dict[str, str] = {}
feed_tokens: Dict[str, Any] = {}
market_data: Dict[str, Dict] = {}  # Store real-time market data

def authenticate_user(username: str, password: str, broker: str, api_key: str, totp_token: str, vendor_code: Optional[str] = None):
    if broker != "Shoonya":
        raise HTTPException(status_code=400, detail="Only Shoonya broker supported")
    smart_api = ShoonyaApiPy()
    try:
        totp = pyotp.TOTP(totp_token).now()
        ret = smart_api.login(userid=username, password=password, twoFA=totp, vendor_code=vendor_code, api_secret=api_key, imei="trading_app")
        if ret.get('stat') != 'Ok':
            logger.error(f"Shoonya Authentication failed for {username}: {ret}")
            raise Exception(f"Authentication failed: {ret.get('emsg')}")
        return smart_api, ret['susertoken'], None, None
    except Exception as e:
        logger.error(f"Shoonya Auth error for {username}: {e}")
        raise

def full_reauth_user(username: str):
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT password, broker, api_key, totp_token, vendor_code FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    password, broker, api_key, totp_token, vendor_code = user
    api_client, auth_token, _, feed_token = authenticate_user(username, password, broker, api_key, totp_token, vendor_code)
    smart_api_instances[username] = api_client
    auth_tokens[username] = auth_token
    feed_tokens[username] = feed_token
    logger.info(f"Full session re-authenticated for {username} ({broker})")
    threading.Thread(target=start_websocket, args=(username, broker, api_key, auth_token, feed_token), daemon=True).start()
    return api_client

def get_option_chain_data(api_client, exchange: str, tradingsymbol: str, strike_price: float, count: int = 5):
    try:
        response = api_client.get_option_chain(exchange=exchange, tradingsymbol=tradingsymbol, strikeprice=strike_price, count=count)
        if response and response.get('stat') == 'Ok' and 'values' in response:
            return response['values']
        logger.error(f"Failed to fetch option chain for {tradingsymbol}: {response}")
        raise HTTPException(status_code=400, detail=f"No option chain data available: {response.get('emsg', 'Unknown error')}")
    except Exception as e:
        logger.error(f"Error fetching option chain for {tradingsymbol}: {e}")
        raise HTTPException(status_code=500, detail=f"Error fetching option chain: {str(e)}")

def get_ltp(api_client, broker: str, exchange: str, tradingsymbol: str, symboltoken: str):
    symbol_key = f"{exchange}:{tradingsymbol}:{symboltoken}"
    if symbol_key in ltp_cache:
        return ltp_cache[symbol_key]
    if broker == "Shoonya":
        quotes = api_client.get_quotes(exchange=exchange, token=symboltoken)
        if quotes and quotes.get('stat') == 'Ok' and 'lp' in quotes:
            ltp = float(quotes['lp'])
            ltp_cache[symbol_key] = ltp
            market_data[symbol_key] = quotes  # Store for real-time updates
            return ltp
        logger.error(f"Shoonya LTP fetch failed for {tradingsymbol}: {quotes}")
        raise HTTPException(status_code=400, detail="No LTP data available")
    raise HTTPException(status_code=400, detail="Unsupported broker")

def place_order(api_client, broker: str, orderparams: dict, position_type: str, username: str):
    if broker != "Shoonya":
        raise HTTPException(status_code=400, detail="Only Shoonya broker supported")
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
                                                  position_active, highest_price, base_price, sell_type, sell_threshold, previous_close)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'LONG', 1, ?, ?, ?, ?, ?)
        """, (position_id, username, symbol, conditions['symboltoken'], entry_price, conditions['buy_threshold'], 
              conditions['stop_loss_type'], conditions['stop_loss_value'], conditions['points_condition'],
              entry_price, entry_price, conditions.get('sell_type'), conditions.get('sell_threshold'), conditions.get('previous_close')))
        conn.commit()

def on_data_shoonya(tick_data: Dict):
    global ltp_cache, market_data
    try:
        symbol_key = f"{tick_data['e']}:{tick_data['ts']}:{tick_data['tk']}"
        if 'lp' in tick_data:
            ltp = float(tick_data['lp'])
            ltp_cache[symbol_key] = ltp
            market_data[symbol_key] = tick_data  # Update real-time market data
            process_position_update(tick_data['ts'], ltp)
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
                             "sell_type", "sell_threshold", "previous_close"], position))
        username = pos_data['username']
        if username in smart_api_instances:
            api_client = smart_api_instances[username]
            check_conditions(api_client, pos_data, ltp, username)

def on_open_shoonya():
    logger.info("Shoonya WebSocket opened")
    subscribe_to_tokens(None, None)

def subscribe_to_tokens(wsapp, exchange_type):
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT symboltoken FROM open_positions WHERE position_active = 1")
        tokens = [row[0] for row in cursor.fetchall()]
    if tokens:
        for token in tokens:
            smart_api_instances[list(smart_api_instances.keys())[0]].subscribe(f"NFO|{token}")

def start_websocket(username: str, broker: str, api_key: str, auth_token: str, feed_token: Optional[str] = None):
    if broker == "Shoonya":
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
        orderparams = {
            "buy_or_sell": "S",
            "product_type": "I",
            "exchange": "NFO",
            "tradingsymbol": position_data['symbol'],
            "quantity": 1,
            "price_type": "MKT",
            "price": 0,
            "retention": "DAY"
        }
        place_order(api_client, "Shoonya", orderparams, "EXIT", username)
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
        user_data = dict(zip(["username", "password", "broker", "api_key", "totp_token", "vendor_code", "default_quantity"], user))
        if user_data['broker'] == "Shoonya":
            api_client, auth_token, _, feed_token = authenticate_user(
                user_data['username'], user_data['password'], user_data['broker'], 
                user_data['api_key'], user_data['totp_token'], user_data['vendor_code']
            )
            smart_api_instances[user_data['username']] = api_client
            auth_tokens[user_data['username']] = auth_token
            feed_tokens[user_data['username']] = feed_token
            threading.Thread(target=start_websocket, args=(user_data['username'], user_data['broker'], user_data['api_key'], auth_token, feed_token), daemon=True).start()

@app.post("/api/register_user")
def register_user(user: User):
    try:
        api_client, auth_token, _, feed_token = authenticate_user(
            user.username, user.password, user.broker, user.api_key, user.totp_token, user.vendor_code
        )
        with conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                           (user.username, user.password, user.broker, user.api_key, user.totp_token, user.vendor_code, user.default_quantity))
            conn.commit()
        smart_api_instances[user.username] = api_client
        auth_tokens[user.username] = auth_token
        feed_tokens[user.username] = feed_token
        threading.Thread(target=start_websocket, args=(user.username, user.broker, user.api_key, auth_token, feed_token), daemon=True).start()
        return {"message": "User registered and authenticated successfully"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="User already exists")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Authentication failed: {str(e)}")

@app.get("/api/get_users")
def get_users():
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users")
        users = cursor.fetchall()
    return {"users": [dict(zip(["username", "password", "broker", "api_key", "totp_token", "vendor_code", "default_quantity"], row)) for row in users]}

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
                                 "sell_type", "sell_threshold", "previous_close"], row)) for row in trades]}

@app.get("/api/get_market_data/{username}/{symboltoken}")
def get_market_data(username: str, symboltoken: str):
    if username not in smart_api_instances:
        raise HTTPException(status_code=401, detail="User not authenticated")
    
    exchange = "NFO"  # Assuming NFO for options
    symbol_key = f"{exchange}:{symboltoken}"
    if symbol_key in market_data:
        return {"market_data": market_data[symbol_key], "ltp": ltp_cache.get(symbol_key, 0.0)}
    raise HTTPException(status_code=404, detail="No market data available")

@app.post("/api/get_option_chain")
def get_option_chain(request: OptionChainRequest):
    try:
        username = request.username
        if username not in smart_api_instances:
            raise HTTPException(status_code=401, detail="User not authenticated")
        
        api_client = smart_api_instances[username]
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT broker FROM users WHERE username = ?", (username,))
            user = cursor.fetchone()
        if not user or user[0] != "Shoonya":
            raise HTTPException(status_code=400, detail="Only Shoonya broker supported for option chain")

        # Parse expiry date (e.g., "25 Feb 2025 W" -> "25-FEB-2025")
        try:
            expiry_date = datetime.strptime(request.expiry.split()[0], "%d %b %Y").strftime("%d-%b-%Y").upper()
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid expiry format: {str(e)}")

        # Construct trading symbol (e.g., "NIFTY25FEB25CE75000" for Call, "NIFTY25FEB25PE75000" for Put)
        option_suffix = "CE" if request.option_type == "Call" else "PE"
        tradingsymbol = f"{request.symbol}{expiry_date}{option_suffix}{int(request.strike_price)}"
        
        # Fetch option chain data
        option_chain = get_option_chain_data(api_client, "NFO", request.symbol, request.strike_price)
        
        # Find the specific option contract
        target_contract = next((contract for contract in option_chain if contract['tsym'] == tradingsymbol), None)
        if not target_contract:
            raise HTTPException(status_code=400, detail=f"Option contract not found for {tradingsymbol}")

        # Subscribe to real-time updates for this token
        api_client.subscribe(f"NFO|{target_contract['token']}")

        return {
            "symbol": request.symbol,
            "expiry": request.expiry,
            "strike_price": request.strike_price,
            "option_type": request.option_type,
            "tradingsymbol": tradingsymbol,
            "token": target_contract['token'],
            "call_ltp": target_contract.get('call_ltp', 0.0) if request.option_type == "Call" else None,
            "put_ltp": target_contract.get('put_ltp', 0.0) if request.option_type == "Put" else None,
            "volume": target_contract.get('volume', 0)
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error fetching option chain for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

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
        if not user or user[0] != "Shoonya":
            raise HTTPException(status_code=400, detail="Only Shoonya broker supported for options trading")
        broker, default_quantity = user
        
        params = request.dict()
        buy_type = params['buy_type']
        buy_threshold = params['buy_threshold']
        previous_close = params.get('previous_close', params['strike_price'])
        entry_threshold = buy_threshold if buy_type == "Fixed" else previous_close * (1 + buy_threshold / 100)
        
        # Fetch LTP using the token from option chain
        ltp = get_ltp(api_client, broker, params['exchange'], params['tradingsymbol'], params['symboltoken'])
        if ltp < entry_threshold:
            raise HTTPException(status_code=400, detail=f"Current LTP {ltp} below buy threshold {entry_threshold}")

        buy_order_params = {
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
            'previous_close': params.get('previous_close')
        }

        position_id = f"{username}_{params['tradingsymbol']}_{int(time.time())}"
        update_open_positions(position_id, username, params['tradingsymbol'], entry_price, conditions)

        # Subscribe to real-time updates for the traded symbol
        api_client.subscribe(f"NFO|{params['symboltoken']}")

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
                             "sell_type", "sell_threshold", "previous_close"], position))
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

        # Ensure real-time updates are subscribed for this symbol
        if username in smart_api_instances:
            api_client = smart_api_instances[username]
            api_client.subscribe(f"NFO|{pos_data['symboltoken']}")

        return {"message": f"Conditions updated for position {position_id}", 
                "conditions": {"stop_loss_type": stop_loss_type, "stop_loss_value": stop_loss_value, "points_condition": points_condition}}

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Condition update error for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)