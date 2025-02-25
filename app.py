from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from SmartApi import SmartConnect
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
from api_helper import ShoonyaApiPy
import pyotp
import threading
import time
import sqlite3
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
import json
import uvicorn
import csv
from datetime import datetime, timedelta
import asyncio
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

conn = sqlite3.connect("trading_multi.db", check_same_thread=False)

# In-memory cache for scrip master data
scrip_cache = {
    "indices": {},  # {index_name: {"token": str, "expiries": [str], "increment": int}}
    "options": {},  # {tsym: {"token": str, "strike": float, "option_type": str}}
    "last_updated": None
}

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
            previous_close REAL
        )
        """)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS scrips (
            tsym TEXT PRIMARY KEY,
            token TEXT,
            symbol TEXT,
            instrument TEXT,
            strike REAL,
            option_type TEXT,
            expiry TEXT,
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
    exchange: str = "NFO"
    strike_price: float
    buy_type: str = "Fixed"
    buy_threshold: float = 110
    previous_close: Optional[float] = None
    producttype: str = "INTRADAY"
    stop_loss_type: str = "Fixed"
    stop_loss_value: float = 5.0
    points_condition: float = 0
    sell_type: Optional[str] = "Fixed"
    sell_threshold: Optional[float] = 90

class UpdateTradeRequest(BaseModel):
    username: str
    position_id: str
    stop_loss_type: Optional[str] = "Fixed"
    stop_loss_value: Optional[float] = 5.0
    points_condition: Optional[float] = 0

class OptionChainRequest(BaseModel):
    username: str
    index_name: str = "BANKNIFTY"

smart_api_instances = {}
ltp_cache = {}
auth_tokens = {}
refresh_tokens = {}
feed_tokens = {}

def parse_scrip_file(filepath, exchange):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            scrips = {}
            for row in reader:
                tsym = row['TradingSymbol']
                token = row['Token']
                symbol = row['Symbol']
                instrument = row['Instrument']
                strike = float(row['StrikePrice']) if row['StrikePrice'] != "-1" else None
                option_type = row['OptionType'] if 'OptionType' in row else None
                expiry = row['Expiry'] if 'Expiry' in row else None

                scrips[tsym] = {
                    "token": token,
                    "symbol": symbol,
                    "instrument": instrument,
                    "strike": strike,
                    "option_type": option_type,
                    "expiry": expiry,
                    "exchange": exchange
                }
            return scrips
    except Exception as e:
        logger.error(f"Failed to parse {exchange} scrip master from {filepath}: {str(e)}")
        return {}

def store_scrip_data(scrips, exchange):
    with conn:
        cursor = conn.cursor()
        for tsym, data in scrips.items():
            cursor.execute("""
                INSERT OR REPLACE INTO scrips (tsym, token, symbol, instrument, strike, option_type, expiry, exchange)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (tsym, data["token"], data["symbol"], data["instrument"], data["strike"], data["option_type"], data["expiry"], data["exchange"]))
        conn.commit()

def load_scrip_cache_from_db():
    with conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM scrips")
        rows = cursor.fetchall()
        for row in rows:
            tsym, token, symbol, instrument, strike, option_type, expiry, exchange = row
            if instrument == "FUTIDX" and tsym.endswith("F"):
                index_name = symbol
                if index_name not in scrip_cache["indices"]:
                    scrip_cache["indices"][index_name] = {"token": None, "expiries": [], "increment": None}
                scrip_cache["indices"][index_name]["token"] = token
                scrip_cache["indices"][index_name]["expiries"].append(expiry)
                # Calculate increment if not set
                if scrip_cache["indices"][index_name]["increment"] is None:
                    strikes = sorted([r[4] for r in rows if r[2] == index_name and r[4] is not None])
                    if len(strikes) > 1:
                        scrip_cache["indices"][index_name]["increment"] = int(strikes[1] - strikes[0])
            if instrument == "OPTIDX" and option_type in ["CE", "PE"]:
                scrip_cache["options"][tsym] = {
                    "token": token,
                    "strike": strike,
                    "option_type": option_type
                }
    scrip_cache["last_updated"] = datetime.now()
    logger.info("Scrip cache loaded from database")

async def download_and_update_scrip_cache():
    exchanges = ["NFO", "NSE", "CDS", "MCX", "BSE", "BFO"]  # Include all extracted text files
    base_dir = os.path.dirname(os.path.abspath(__file__))
    for exchange in exchanges:
        filepath = os.path.join(base_dir, f"{exchange}_symbols.txt")
        if os.path.exists(filepath):
            scrips = parse_scrip_file(filepath, exchange)
            store_scrip_data(scrips, exchange)
    load_scrip_cache_from_db()
    logger.info("Scrip master cache updated from local text files successfully")

async def schedule_scrip_update():
    while True:
        last_updated = scrip_cache["last_updated"]
        if not last_updated or (datetime.now() - last_updated) > timedelta(days=1):
            await download_and_update_scrip_cache()
        await asyncio.sleep(3600)  # Check every hour

def authenticate_user(username: str, password: str, broker: str, api_key: str, totp_token: str, vendor_code: Optional[str] = None, imei: str = "trading_app"):
    if broker == "AngelOne":
        smart_api = SmartConnect(api_key)
        try:
            totp = pyotp.TOTP(totp_token).now()
            data = smart_api.generateSession(username, password, totp)
            if data['status'] == False:
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
            ret = smart_api.login(userid=username, password=password, twoFA=totp, vendor_code=vendor_code, api_secret=api_key, imei=imei)
            if ret is None or ret.get('stat') != 'Ok':
                raise Exception(f"Authentication failed: {ret.get('emsg', 'Unknown error') if ret else 'No response'}")
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
            return False
        auth_tokens[username] = data['data']['jwtToken']
        feed_tokens[username] = api_client.getfeedToken()
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
        raise HTTPException(status_code=400, detail="No LTP data available")

def place_order(api_client, broker: str, orderparams: dict, position_type: str, username: str):
    if broker == "AngelOne":
        orderparams["transactiontype"] = "BUY" if position_type == "LONG" else "SELL"
        try:
            response = api_client.placeOrderFullResponse(orderparams)
            if response.get('status') and 'data' in response and 'orderid' in response['data']:
                return {"order_id": response['data']['orderid'], "status": "success"}
            if response.get('errorcode') == 'AB1010' and refresh_angelone_session(username, api_client):
                response = api_client.placeOrderFullResponse(orderparams)
                if response.get('status') and 'data' in response and 'orderid' in response['data']:
                    return {"order_id": response['data']['orderid'], "status": "success"}
            api_client = full_reauth_user(username)
            response = api_client.placeOrderFullResponse(orderparams)
            if response.get('status') and 'data' in response and 'orderid' in response['data']:
                return {"order_id": response['data']['orderid'], "status": "success"}
            raise HTTPException(status_code=400, detail=f"Order failed: {response.get('message', 'Unknown error')}")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Order placement failed: {str(e)}")
    elif broker == "Shoonya":
        orderparams["buy_or_sell"] = "B" if position_type == "LONG" else "S"
        orderparams["price_type"] = "MKT"
        try:
            response = api_client.place_order(**orderparams)
            if response and response.get('stat') == 'Ok' and 'norenordno' in response:
                return {"order_id": response['norenordno'], "status": "success"}
            if response and response.get('emsg', '').startswith("Session Expired"):
                api_client = full_reauth_user(username)
                response = api_client.place_order(**orderparams)
                if response and response.get('stat') == 'Ok' and 'norenordno' in response:
                    return {"order_id": response['norenordno'], "status": "success"}
            raise HTTPException(status_code=400, detail=f"Order failed: {response.get('emsg', 'Unknown error') if response else 'No response'}")
        except Exception as e:
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
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT broker FROM users WHERE username = ?", (username,))
            broker = cursor.fetchone()[0]
        orderparams = {
            "variety": "NORMAL",
            "tradingsymbol": position_data['symbol'],
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
            "tradingsymbol": position_data['symbol'],
            "quantity": 1,
            "price_type": "MKT",
            "price": 0,
            "retention": "DAY"
        }
        place_order(api_client, broker, orderparams, "EXIT", username)
        with conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE open_positions SET position_active = 0 WHERE position_id = ?", (position_data['position_id'],))
            conn.commit()
        logger.info(f"Stop-loss or sell threshold hit for {username}. Sold at {ltp}")

def get_shoonya_option_chain(api_client, index_name: str = "BANKNIFTY"):
    try:
        # Check if scrip cache is up-to-date
        if not scrip_cache["last_updated"] or (datetime.now() - scrip_cache["last_updated"]) > timedelta(days=1):
            asyncio.run(download_and_update_scrip_cache())

        index_name = index_name.upper()
        if index_name not in scrip_cache["indices"]:
            raise HTTPException(status_code=400, detail=f"Index {index_name} not found in scrip cache")

        index_data = scrip_cache["indices"][index_name]
        index_token = index_data["token"]
        incrementor = index_data["increment"] or 50  # Fallback to 50 if not computed
        expiries = sorted(index_data["expiries"])
        expiry = expiries[0]  # Use nearest expiry

        # Fetch LTP (single API call)
        ret = api_client.get_quotes(exchange="NSE", token=index_token)
        if not ret or 'lp' not in ret:
            raise HTTPException(status_code=400, detail="Failed to fetch index LTP")
        ltp = float(ret["lp"])
        ltp_adjusted = ltp - (ltp % incrementor)

        # Fetch option chain using cached options (single API call)
        strike = f"{index_name}{expiry}P{int(ltp_adjusted)}"
        chain = api_client.get_option_chain(exchange="NFO", tradingsymbol=strike, strikeprice=int(ltp_adjusted), count=50)
        if not chain or 'values' not in chain:
            error_msg = chain.get('emsg', 'Unknown error') if chain else 'No response'
            if "market" in error_msg.lower() or "closed" in error_msg.lower():
                return {"message": "Market is closed, no live option chain data available", "data": []}
            raise HTTPException(status_code=400, detail=f"Failed to fetch option chain: {error_msg}")

        chainscrips = []
        for scrip in chain['values']:
            scripdata = api_client.get_quotes(exchange=scrip['exch'], token=scrip['token'])
            chainscrips.append(scripdata)

        # Build option chain data using cached options
        option_chain_data = []
        for scrip_data in chainscrips:
            tsym = scrip_data["tsym"]
            cached_option = scrip_cache["options"].get(tsym, {})
            strike_price = cached_option.get("strike", float(scrip_data["tsym"].split("P")[-1] if "P" in scrip_data["tsym"] else scrip_data["tsym"].split("C")[-1]))
            option_type = cached_option.get("option_type", "PE" if "P" in tsym[-6:] else "CE")
            option_chain_data.append({
                "strike": str(int(strike_price)),
                "ce_oi": scrip_data.get("oi", "N/A") if option_type == "CE" else "N/A",
                "ce_ltp": scrip_data.get("lp", "N/A") if option_type == "CE" else "N/A",
                "ce_token": scrip_data.get("token", "N/A") if option_type == "CE" else "N/A",
                "pe_oi": scrip_data.get("oi", "N/A") if option_type == "PE" else "N/A",
                "pe_ltp": scrip_data.get("lp", "N/A") if option_type == "PE" else "N/A",
                "pe_token": scrip_data.get("token", "N/A") if option_type == "PE" else "N/A",
                "expiry": expiry
            })

        # Combine CE and PE data
        final_chain_data = []
        strikes = sorted(set([item["strike"] for item in option_chain_data]))
        for strike in strikes:
            ce_data = next((item for item in option_chain_data if item["strike"] == strike and item["ce_ltp"] != "N/A"), None)
            pe_data = next((item for item in option_chain_data if item["strike"] == strike and item["pe_ltp"] != "N/A"), None)
            final_chain_data.append({
                "strike": strike,
                "ce_oi": ce_data["ce_oi"] if ce_data else "N/A",
                "ce_ltp": ce_data["ce_ltp"] if ce_data else "N/A",
                "ce_token": ce_data["ce_token"] if ce_data else "N/A",
                "pe_oi": pe_data["pe_oi"] if pe_data else "N/A",
                "pe_ltp": pe_data["pe_ltp"] if pe_data else "N/A",
                "pe_token": pe_data["pe_token"] if pe_data else "N/A",
                "expiry": expiry
            })

        return final_chain_data

    except Exception as e:
        logger.error(f"Error in get_shoonya_option_chain for {index_name}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching option chain: {str(e)}")

@app.on_event("startup")
async def startup_event():
    load_scrip_cache_from_db()  # Load initial cache from database
    asyncio.create_task(schedule_scrip_update())  # Schedule daily updates
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
        api_client, auth_token, refresh_token, feed_token = authenticate_user(
            user.username, user.password, user.broker, user.api_key, user.totp_token, user.vendor_code, user.imei
        )
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
                                 "sell_type", "sell_threshold", "previous_close"], row)) for row in trades]}

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
            raise HTTPException(status_code=400, detail="Option chain data is only available for Shoonya broker")
        
        option_chain_data = get_shoonya_option_chain(api_client, request.index_name)
        if isinstance(option_chain_data, dict) and "message" in option_chain_data:
            return option_chain_data
        return {"message": f"Option chain data for {request.index_name} based on current LTP", "data": option_chain_data}
    
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Option chain fetch error for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)