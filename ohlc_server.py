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

# Fetch Market Data
@app.get("/api/fetch_market_data")
async def fetch_market_data(
    mode: str = Query("LTP", description="Mode (LTP/OHLC/FULL)"),
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbol: str = Query(..., description="Stock Symbol (e.g. SBIN-EQ)"),
):
    try:
        token = get_symbol_token(exchange, symbol)
        if not token:
            return {"status": False, "message": "❌ Failed to fetch symbol token"}

        # Define payload based on the mode
        payload = {
            "mode": mode.upper(),
            "exchangeTokens": {
                exchange: [token]
            }
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
            if data.get("status") and "data" in data:
                fetched_data = data["data"]["fetched"][0]  # Assuming at least one item
                if mode.upper() == "LTP":
                    return {
                        "status": True,
                        "data": {
                            "symbol": symbol,
                            "exchange": exchange,
                            "ltp": fetched_data["ltp"]
                        },
                    }
                elif mode.upper() == "OHLC":
                    return {
                        "status": True,
                        "data": {
                            "symbol": symbol,
                            "exchange": exchange,
                            "open": fetched_data["open"],
                            "high": fetched_data["high"],
                            "low": fetched_data["low"],
                            "close": fetched_data["close"]
                        },
                    }
                elif mode.upper() == "FULL":
                    return {
                        "status": True,
                        "data": {
                            "symbol": symbol,
                            "exchange": exchange,
                            "ltp": fetched_data["ltp"],
                            "open": fetched_data["open"],
                            "high": fetched_data["high"],
                            "low": fetched_data["low"],
                            "close": fetched_data["close"],
                            "lastTradeQty": fetched_data["lastTradeQty"],
                            "exchFeedTime": fetched_data["exchFeedTime"],
                            "exchTradeTime": fetched_data["exchTradeTime"],
                            "netChange": fetched_data["netChange"],
                            "percentChange": fetched_data["percentChange"],
                            "avgPrice": fetched_data["avgPrice"],
                            "tradeVolume": fetched_data["tradeVolume"],
                            "opnInterest": fetched_data["opnInterest"],
                            "lowerCircuit": fetched_data["lowerCircuit"],
                            "upperCircuit": fetched_data["upperCircuit"],
                            "totBuyQuan": fetched_data["totBuyQuan"],
                            "totSellQuan": fetched_data["totSellQuan"],
                            "52WeekLow": fetched_data["52WeekLow"],
                            "52WeekHigh": fetched_data["52WeekHigh"],
                            "depth": fetched_data["depth"]
                        },
                    }

        logger.error(f"❌ API Error: {response.status_code} - {response.text}")
        return {"status": False, "message": "Error fetching market data"}
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
