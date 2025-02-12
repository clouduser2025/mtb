from fastapi import FastAPI, HTTPException
from SmartApi import SmartConnect
import pyotp
import uvicorn
from pydantic import BaseModel
from logzero import logger

# --- CONFIGURATION ---
API_KEY = "y2gLEdxZ"
CLIENT_CODE = "A62128571"
PASSWORD = "0852"
TOTP_SECRET = "654AU7VYVAOGKZGB347HKVIAB4"

# FastAPI App
app = FastAPI()

# Create SmartAPI Object
smartApi = SmartConnect(api_key=API_KEY)

# --- Generate TOTP ---
def generate_totp():
    return pyotp.TOTP(TOTP_SECRET).now()

# --- API Request Model ---
class OptionChainRequest(BaseModel):
    symbol: str
    expiry: str

# --- LOGIN ---
def login():
    totp = generate_totp()
    login_data = smartApi.generateSession(CLIENT_CODE, PASSWORD, totp)

    if login_data.get("status"):
        logger.info("✅ Login Successful!")
        return True
    else:
        logger.error("❌ Login Failed!")
        return False

def get_symbol_token(symbol):
    """
    Fetches the symbol token using SmartAPI's `searchscrip` method.
    """
    try:
        response = smartApi.searchscrip(exchange="NSE", searchtext=symbol)
        if response.get("status"):
            return response["data"][0]["symboltoken"]  # Get the first match
        else:
            logger.error(f"❌ Symbol Search Failed: {response.get('message', 'Unknown Error')}")
            return None
    except Exception as e:
        logger.error(f"❌ Error in Symbol Search: {e}")
        return None

# --- FETCH OPTION CHAIN API ENDPOINT ---
@app.post("/api/fetch_option_chain")
async def fetch_option_chain(data: OptionChainRequest):
    if not login():
        raise HTTPException(status_code=401, detail="Login failed")

    try:
        # Call SmartAPI's option chain API
        response = smartApi.getOptionChain(exchange="NSE", tradingsymbol=data.symbol, expirydate=data.expiry)

        if response.get("status"):
            options_data = []
            for option in response["data"]:
                options_data.append({
                    "strike_price": option["strikePrice"],
                    "call": {
                        "volume": option["CE"]["volume"],
                        "oi": option["CE"]["openInterest"],
                        "oi_change": f"{option['CE']['changeinOpenInterest']}%",
                        "ltp": option["CE"]["ltp"],
                        "ltp_change": f"{option['CE']['change']}%"
                    },
                    "put": {
                        "volume": option["PE"]["volume"],
                        "oi": option["PE"]["openInterest"],
                        "oi_change": f"{option['PE']['changeinOpenInterest']}%",
                        "ltp": option["PE"]["ltp"],
                        "ltp_change": f"{option['PE']['change']}%"
                    }
                })

            result = {
                "symbol": data.symbol,
                "expiry": data.expiry,
                "options_chain": options_data
            }

            print("\n🔹 API Response:\n", result)  # ✅ PRINT RESPONSE IN COMMAND PROMPT
            return result

        else:
            error_msg = "Failed to fetch option chain"
            print("❌", error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
    
    except Exception as e:
        logger.error(f"❌ Error fetching option chain: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- RUN SERVER ---
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5000)
