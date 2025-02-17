from fastapi import FastAPI, Query
from SmartApi import SmartConnect
import pyotp
import requests
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Query
import requests


from fastapi import APIRouter

router = APIRouter()

@router.get("/ltp")
def get_ltp():
    return {"message": "LTP Server is running!"}

# --- CONFIGURATION ---
API_KEY = "y2gLEdxZ"
CLIENT_CODE = "A62128571"
PASSWORD = "0852"
TOTP_SECRET = "654AU7VYVAOGKZGB347HKVIAB4"

# --- SmartAPI Object ---
smartApi = SmartConnect(api_key=API_KEY)

# --- Login Process ---
logger.info("Logging into SmartAPI...")
try:
    totp = pyotp.TOTP(TOTP_SECRET).now()
    login_data = smartApi.generateSession(CLIENT_CODE, PASSWORD, totp)

    if not login_data["status"]:
        logger.error(f"Login Failed: {login_data}")
        exit()
    else:
        authToken = login_data["data"]["jwtToken"]
        feedToken = smartApi.getfeedToken()
        logger.info("Login Successful!")
except Exception as e:
    logger.error(f"Login Error: {e}")

# --- FastAPI App ---
app = FastAPI()


# ✅ Add CORS Middleware (Allow Frontend to Access API)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow requests from any frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Helper Function: Fetch Symbol Token ---
def get_symbol_token(exchange: str, symbol: str):
    try:
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/searchScrip"
        headers = {
            "Authorization": f"Bearer {authToken}",  # Use authToken instead of API_KEY
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
        }
        payload = {"exchange": exchange, "searchscrip": symbol}
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code != 200:
            logger.error(f"API Error: {response.status_code} - {response.text}")
            return None

        data = response.json()
        if data.get("status") and "data" in data and len(data["data"]) > 0:
            symbol_token = data["data"][0]["symboltoken"]
            logger.info(f"✅ Token for {symbol} is {symbol_token}")
            return symbol_token
        else:
            logger.error(f"❌ No valid symbol token found for {symbol}. Response: {data}")
            return None
    except requests.exceptions.RequestException as e:
        logger.error(f"🔴 Error fetching symbol token: {e}")
        return None
    
# --- API Endpoint: Fetch LTP ---
@app.get("/api/fetch_ltp")
async def fetch_ltp(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbol: str = Query(..., description="Stock Symbol (e.g. RELIANCE)"),
    token: str = Query(None, description="Symbol Token (Optional)")
):
    try:
        # Fetch token if not provided
        if not token:
            logger.info(f"Fetching token for {symbol}...")
            token = get_symbol_token(exchange, symbol)
            if not token:
                return {"status": False, "message": "Failed to fetch symbol token"}

        # Fetch LTP
        response = smartApi.ltpData(exchange=exchange, tradingsymbol=symbol, symboltoken=token)
        if response["status"]:
            ltp = response["data"]["ltp"]
            logger.info(f"✅ {symbol} LTP = {ltp}")
            return {"status": True, "ltp": ltp}
        else:
            logger.error(f"Error fetching LTP: {response.get('message', 'Unknown Error')}")
            return {"status": False, "message": "LTP fetch failed"}
    except Exception as e:
        logger.error(f"LTP Fetch Error: {e}")
        return {"status": False, "message": "Server Error"}

# --- API Endpoint: Fetch OHLC Mode ---
@app.get("/api/fetch_ohlc")
async def fetch_ohlc(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbols: str = Query(None, description="Comma-separated stock symbols (e.g. RELIANCE, TCS)"),
    symbol: str = Query(None, description="Single stock symbol (e.g. SBIN-EQ)"),  # Temporary addition
):
    try:
        # Use symbols if provided, otherwise fall back to symbol
        symbol_input = symbols if symbols else symbol
        if not symbol_input:
            return {"status": False, "message": "No symbol or symbols provided"}

        symbol_list = symbol_input.split(",")
        symbol_tokens = []
        
        for sym in symbol_list:
            token = get_symbol_token(exchange, sym)
            if token:
                symbol_tokens.append(token)
            else:
                return {"status": False, "message": f"Failed to fetch token for {sym}"}

        payload = {
            "mode": "OHLC",
            "exchangeTokens": {exchange: symbol_tokens}
        }
        
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        headers = {
            "Authorization": f"Bearer {authToken}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
        }
        
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code != 200:
            logger.error(f"API Error: {response.status_code} - {response.text}")
            return {"status": False, "message": "Error fetching OHLC data"}

        data = response.json()
        
        if data.get("status") and "data" in data:
            return {"status": True, "data": data["data"]}
        else:
            logger.error(f"Error fetching OHLC data: {data.get('message', 'Unknown error')}")
            return {"status": False, "message": "Failed to fetch OHLC data"}
    
    except Exception as e:
        logger.error(f"Error: {e}")
        return {"status": False, "message": "Server Error"}

# --- API Endpoint: Fetch Full Mode ---
@app.get("/api/fetch_full")
async def fetch_full(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbols: str = Query(..., description="Comma-separated stock symbols (e.g. SBIN-EQ)"),
):
    try:
        symbol_list = symbols.split(",")
        symbol_tokens = [get_symbol_token(exchange, symbol) for symbol in symbol_list if get_symbol_token(exchange, symbol)]

        if not symbol_tokens:
            return {"status": False, "message": "Failed to fetch tokens for any symbol"}

        payload = {
            "mode": "FULL",
            "exchangeTokens": {exchange: symbol_tokens}
        }

        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        headers = {
            "Authorization": f"Bearer {authToken}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
        }

        response = requests.post(url, headers=headers, json=payload)

        if response.status_code == 200:
            data = response.json()
            if data.get("status"):
                return {
                    "status": True,
                    "message": "SUCCESS",
                    "errorcode": "",
                    "data": {
                        "fetched": data.get("data", []),
                        "unfetched": []
                    }
                }
            else:
                return {"status": False, "message": "Failed to fetch Full data"}
        else:
            return {"status": False, "message": f"API Error: {response.status_code} - {response.text}"}

    except Exception as e:
        logger.error(f"Error fetching Full data: {e}")
        return {"status": False, "message": "Server Error"}

# --- Shutdown Hook ---
@app.on_event("shutdown")
def shutdown_event():
    print("Server is shutting down. Logging out...")
    try:
        logout_response = smartApi.terminateSession(CLIENT_CODE)
        logger.info("Logout Successful!")
    except Exception as e:
        logger.error(f"Logout Failed: {e}")
