from fastapi import FastAPI, Query
import requests
from logzero import logger

app = FastAPI()

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
        
        if response.status_code != 200:
            logger.error(f"API Error: {response.status_code} - {response.text}")
            return None
        
        data = response.json()
        if data.get("status") and "data" in data and len(data["data"]) > 0:
            return data["data"][0]["symboltoken"]
        else:
            logger.error(f"No valid symbol token found for {symbol}. Response: {data}")
            return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Error fetching symbol token: {e}")
        return None

@app.get("/api/fetch_ohlc")
async def fetch_ohlc(
    exchange: str = Query("NSE", description="Stock Exchange (NSE/BSE)"),
    symbol: str = Query(..., description="Stock Symbol (e.g. SBIN-EQ)")
):
    try:
        token = get_symbol_token(exchange, symbol)
        if not token:
            return {"status": False, "message": "Failed to fetch symbol token"}

        payload = {"exchange": exchange, "symboltoken": token}
        url = "https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/ohlc"
        headers = {
            "Authorization": f"Bearer {authToken}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code != 200:
            logger.error(f"API Error: {response.status_code} - {response.text}")
            return {"status": False, "message": "Error fetching OHLC data"}
        
        data = response.json()
        if data.get("status") and "data" in data:
            return {"status": True, "data": data["data"]}
        else:
            return {"status": False, "message": "OHLC fetch failed"}
    except Exception as e:
        logger.error(f"Error: {e}")
        return {"status": False, "message": "Server Error"}
