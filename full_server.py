from fastapi import FastAPI, Query
from SmartApi import SmartConnect
import pyotp
import requests
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware

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
            "Authorization": f"Bearer {API_KEY}",
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

# --- API Endpoint: Fetch Market Data (LTP, OHLC, FULL) ---
@app.get("/api/fetch_market_data")
async def fetch_market_data(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbol: str = Query(..., description="Stock Symbol (e.g. RELIANCE)"),
    mode: str = Query("LTP", description="Data Mode: LTP, OHLC, FULL"),
    token: str = Query(None, description="Symbol Token (Optional)")
):
    try:
        # Fetch token if not provided
        if not token:
            logger.info(f"Fetching token for {symbol}...")
            token = get_symbol_token(exchange, symbol)
            if not token:
                return {"status": False, "message": "Failed to fetch symbol token"}

        # Fetch Market Data
        payload = {
            "mode": mode.upper(),
            "exchangeTokens": {exchange: [token]},
        }
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        headers = {
            "Authorization": f"Bearer {authToken}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code == 200:
            data = response.json()
            if data["status"]:
                logger.info(f"✅ {mode} Data for {symbol}: {data['data']['fetched']}")
                return {"status": True, "data": data["data"]["fetched"]}
            else:
                logger.error(f"Error fetching {mode} data: {data.get('message', 'Unknown Error')}")
                return {"status": False, "message": "Data fetch failed"}
        else:
            logger.error(f"API Error: {response.status_code} - {response.text}")
            return {"status": False, "message": "API request failed"}

    except Exception as e:
        logger.error(f"Market Data Fetch Error: {e}")
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
