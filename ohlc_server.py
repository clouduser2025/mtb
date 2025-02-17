import requests
import pyotp
from fastapi import FastAPI, Query
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
from SmartApi import SmartConnect

app = FastAPI()

# Enable CORS to allow frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Configuration
API_KEY = "y2gLEdxZ"
CLIENT_CODE = "A62128571"
PASSWORD = "0852"
TOTP_SECRET = "654AU7VYVAOGKZGB347HKVIAB4"

# Authenticate with SmartAPI
try:
    smartApi = SmartConnect(api_key=API_KEY)
    totp = pyotp.TOTP(TOTP_SECRET).now()
    login_data = smartApi.generateSession(CLIENT_CODE, PASSWORD, totp)

    if login_data["status"]:
        authToken = login_data["data"]["jwtToken"]
        feedToken = smartApi.getfeedToken()
        logger.info("✅ Login Successful!")
    else:
        logger.error(f"❌ Login Failed: {login_data}")
        exit()
except Exception as e:
    logger.error(f"🔴 Login Error: {e}")
    exit()

# Fetch Symbol Token
def get_symbol_token(exchange: str, symbol: str):
    try:
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/searchScrip"
        headers = {
            "Authorization": f"Bearer {authToken}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
        }
        payload = {"exchange": exchange, "searchscrip": symbol}
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("status") and "data" in data and data["data"]:
                return data["data"][0]["symboltoken"]
        logger.error(f"❌ No valid token found for {symbol}. Response: {data}")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"🔴 Error fetching symbol token: {e}")
        return None

# Fetch OHLC Data
@app.get("/api/fetch_ohlc")
async def fetch_ohlc(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbol: str = Query(..., description="Stock Symbol (e.g. SBIN-EQ)"),
):
    try:
        token = get_symbol_token(exchange, symbol)
        if not token:
            return {"status": False, "message": "❌ Failed to fetch symbol token"}

        # Use the token to fetch OHLC data
        payload = {"exchange": exchange, "symboltoken": token}
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/ohlc"
        headers = {
            "Authorization": f"Bearer {authToken}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("status") and "data" in data:
                # Extracting OHLC data from the response
                ohlc_data = data["data"][0]  # Assuming there is at least one item
                return {
                    "status": True,
                    "data": {
                        "symbol": symbol,
                        "exchange": exchange,
                        "ltp": ohlc_data["ltp"],
                        "open": ohlc_data["open"],
                        "high": ohlc_data["high"],
                        "low": ohlc_data["low"],
                        "close": ohlc_data["close"],
                    },
                }

        logger.error(f"❌ API Error: {response.status_code} - {response.text}")
        return {"status": False, "message": "Error fetching OHLC data"}
    except Exception as e:
        logger.error(f"🔴 Server Error: {e}")
        return {"status": False, "message": "Server Error"}

# Shutdown Hook
@app.on_event("shutdown")
def shutdown_event():
    try:
        logout_response = smartApi.terminateSession(CLIENT_CODE)
        logger.info("✅ Logout Successful!")
    except Exception as e:
        logger.error(f"❌ Logout Failed: {e}")
