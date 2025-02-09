from fastapi import FastAPI, HTTPException
from SmartApi import SmartConnect
import pyotp
from logzero import logger

# --- FastAPI Init ---
app = FastAPI()

# --- CONFIGURATION ---
API_KEY = "y2gLEdxZ"  
CLIENT_CODE = "A62128571"
PASSWORD = "0852"
TOTP_SECRET = "654AU7VYVAOGKZGB347HKVIAB4"

# --- FUNCTION TO FETCH LTP ---
def fetch_ltp(exchange: str, symbol: str):
    """
    Fetch Last Traded Price (LTP) for given exchange & symbol.
    """
    try:
        smartApi = SmartConnect(api_key=API_KEY)

        # Generate TOTP
        totp = pyotp.TOTP(TOTP_SECRET).now()
        login_data = smartApi.generateSession(CLIENT_CODE, PASSWORD, totp)

        if not login_data["status"]:
            return {"error": "Login Failed", "details": login_data}

        # Fetch LTP
        response = smartApi.ltpData(exchange=exchange, tradingsymbol=symbol, symboltoken=symbol)

        if response["status"]:
            ltp = response["data"]["ltp"]
            return {"symbol": symbol, "ltp": ltp}
        else:
            return {"error": response.get("message", "Failed to fetch LTP")}

    except Exception as e:
        logger.error(f"Error fetching LTP: {e}")
        return {"error": str(e)}

# --- API Endpoint ---
@app.get("/api/fetch_ltp/{exchange}/{symbol}")
def get_ltp(exchange: str, symbol: str):
    """
    API to fetch live LTP based on exchange & symbol.
    """
    ltp_data = fetch_ltp(exchange, symbol)
    if "error" in ltp_data:
        raise HTTPException(status_code=400, detail=ltp_data)
    return ltp_data
