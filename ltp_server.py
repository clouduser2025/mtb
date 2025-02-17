from fastapi import FastAPI, Query
from SmartApi import SmartConnect
import pyotp
import requests
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
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
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        headers = {
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
        }
        payload = {
            "mode": "LTP",  # Default LTP mode
            "exchangeTokens": {exchange: [symbol]}
        }
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code != 200:
            logger.error(f"API Error: {response.status_code} - {response.text}")
            return None

        data = response.json()
        if data.get("status") and "data" in data and len(data["data"]["fetched"]) > 0:
            symbol_token = data["data"]["fetched"][0]["symbolToken"]
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

        # Fetch LTP using Live Market Data API
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        headers = {
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
        }
        payload = {
            "mode": "LTP",
            "exchangeTokens": {exchange: [token]}
        }
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("status") and "data" in data and "fetched" in data["data"]:
                fetched_data = data["data"]["fetched"]
                if fetched_data:
                    ltp = fetched_data[0].get("ltp")
                    logger.info(f"✅ {symbol} LTP = {ltp}")
                    return {"status": True, "ltp": ltp}
                else:
                    logger.error(f"❌ No LTP data available for {symbol}")
                    return {"status": False, "message": "LTP data not available"}
            else:
                logger.error(f"Error fetching LTP: {data.get('message', 'Unknown Error')}")
                return {"status": False, "message": "LTP fetch failed"}
        else:
            logger.error(f"API Error: {response.status_code} - {response.text}")
            return {"status": False, "message": "LTP fetch failed"}
    except Exception as e:
        logger.error(f"LTP Fetch Error: {e}")
        return {"status": False, "message": "Server Error"}

# --- API Endpoint: Fetch OHLC Mode ---
@app.get("/api/fetch_ohlc")
async def fetch_ohlc(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbol: str = Query(..., description="Stock Symbol (e.g. RELIANCE)"),
    token: str = Query(None, description="Symbol Token (Optional)")
):
    try:
        if not token:
            token = get_symbol_token(exchange, symbol)
            if not token:
                return {"status": False, "message": "Failed to fetch symbol token"}

        # Fetch OHLC Data
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        headers = {
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
        }
        payload = {
            "mode": "OHLC",
            "exchangeTokens": {exchange: [token]}
        }
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code == 200:
            data = response.json()
            if data.get("status") and "data" in data and "fetched" in data["data"]:
                fetched_data = data["data"]["fetched"]
                if fetched_data:
                    ohlc = fetched_data[0]
                    logger.info(f"✅ {symbol} OHLC = {ohlc}")
                    return {"status": True, "ohlc": ohlc}
                else:
                    logger.error(f"❌ No OHLC data available for {symbol}")
                    return {"status": False, "message": "OHLC data not available"}
            else:
                logger.error(f"Error fetching OHLC: {data.get('message', 'Unknown Error')}")
                return {"status": False, "message": "OHLC fetch failed"}
        else:
            logger.error(f"API Error: {response.status_code} - {response.text}")
            return {"status": False, "message": "OHLC fetch failed"}
    except Exception as e:
        logger.error(f"OHLC Fetch Error: {e}")
        return {"status": False, "message": "Server Error"}

# --- API Endpoint: Fetch Full Mode ---
@app.get("/api/fetch_full")
async def fetch_full(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbol: str = Query(..., description="Stock Symbol (e.g. RELIANCE)"),
    token: str = Query(None, description="Symbol Token (Optional)")
):
    try:
        if not token:
            token = get_symbol_token(exchange, symbol)
            if not token:
                return {"status": False, "message": "Failed to fetch symbol token"}

        # Fetch Full Data
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        headers = {
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
        }
        payload = {
            "mode": "FULL",
            "exchangeTokens": {exchange: [token]}
        }
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code == 200:
            data = response.json()
            if data.get("status") and "data" in data and "fetched" in data["data"]:
                fetched_data = data["data"]["fetched"]
                if fetched_data:
                    full_data = fetched_data[0]
                    logger.info(f"✅ {symbol} Full Data = {full_data}")
                    return {"status": True, "full_data": full_data}
                else:
                    logger.error(f"❌ No Full data available for {symbol}")
                    return {"status": False, "message": "Full data not available"}
            else:
                logger.error(f"Error fetching Full data: {data.get('message', 'Unknown Error')}")
                return {"status": False, "message": "Full data fetch failed"}
        else:
            logger.error(f"API Error: {response.status_code} - {response.text}")
            return {"status": False, "message": "Full data fetch failed"}
    except Exception as e:
        logger.error(f"Full Data Fetch Error: {e}")
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
