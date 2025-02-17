import requests
from fastapi import FastAPI, Query
import json

app = FastAPI()

# API URL for fetching market data
API_URL = 'https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/'

# API Headers
HEADERS = {
    'X-PrivateKey': 'API_KEY',
    'Accept': 'application/json',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': 'CLIENT_LOCAL_IP',
    'X-ClientPublicIP': 'CLIENT_PUBLIC_IP',
    'X-MACAddress': 'MAC_ADDRESS',
    'X-UserType': 'USER',
    'Authorization': 'Bearer AUTHORIZATION_TOKEN',
    'Content-Type': 'application/json'
}

# --- Fetch OHLC Data ---
@app.get("/api/fetch_ohlc")
async def fetch_ohlc(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbol: str = Query(..., description="Stock Symbol (e.g. SBIN-EQ)"),
    token: str = Query(None, description="Symbol Token (Optional)")
):
    try:
        # If no token provided, use the default symbol token (hardcoded for now)
        if not token:
            token = "3045"  # Example token for SBIN-EQ (Replace this with dynamic fetching logic)

        # Prepare request payload for OHLC Mode
        payload = {
            "mode": "OHLC",
            "exchangeTokens": {
                exchange: [token]  # Send token inside the exchange key
            }
        }

        # Make the request
        response = requests.post(API_URL, headers=HEADERS, data=json.dumps(payload))

        # Check response status
        if response.status_code == 200:
            data = response.json()

            # Handle response and extract relevant data
            if data["status"]:
                ohlc_data = data["data"]["fetched"]
                return {"status": True, "ohlc_data": ohlc_data}
            else:
                return {"status": False, "message": data["message"]}
        else:
            return {"status": False, "message": "API request failed", "error": response.text}
    
    except Exception as e:
        return {"status": False, "message": str(e)}


# --- Fetch Full Data ---
@app.get("/api/fetch_full")
async def fetch_full(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbol: str = Query(..., description="Stock Symbol (e.g. SBIN-EQ)"),
    token: str = Query(None, description="Symbol Token (Optional)")
):
    try:
        # If no token provided, use the default symbol token (hardcoded for now)
        if not token:
            token = "3045"  # Example token for SBIN-EQ (Replace this with dynamic fetching logic)

        # Prepare request payload for Full Mode
        payload = {
            "mode": "FULL",
            "exchangeTokens": {
                exchange: [token]  # Send token inside the exchange key
            }
        }

        # Make the request
        response = requests.post(API_URL, headers=HEADERS, data=json.dumps(payload))

        # Check response status
        if response.status_code == 200:
            data = response.json()

            # Handle response and extract relevant data
            if data["status"]:
                full_data = data["data"]["fetched"]
                return {"status": True, "full_data": full_data}
            else:
                return {"status": False, "message": data["message"]}
        else:
            return {"status": False, "message": "API request failed", "error": response.text}
    
    except Exception as e:
        return {"status": False, "message": str(e)}
