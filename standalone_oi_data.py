from fastapi import FastAPI, HTTPException
from api_helper import ShoonyaApiPy
import pyotp
import logging
from pydantic import BaseModel

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Hardcoded credentials
USER = "FN106240"
PWD = "Roli@786514"
FACTOR2 = "J3H65MJW6RF72V2N5V5UUL27IQ7P4YND"  # TOTP secret
VC = "FN106240_U"
APP_KEY = "41c9f94b1d39017949e23631ca7353e5"
IMEI = "abc1234"

# Initialize Shoonya API
api = ShoonyaApiPy()

# Login to Shoonya API
def login_shoonya():
    try:
        totp = pyotp.TOTP(FACTOR2).now()
        logger.info(f"Generated TOTP: {totp}")
        ret = api.login(userid=USER, password=PWD, twoFA=totp, vendor_code=VC, api_secret=APP_KEY, imei=IMEI)
        logger.info(f"Login response: {ret}")
        if ret.get('stat') != 'Ok':
            logger.error(f"Login failed: {ret}")
            raise Exception(f"Login failed: {ret.get('emsg')}")
        logger.info("Successfully logged into Shoonya API")
        return True
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=500, detail=f"Login error: {str(e)}")

# Pydantic model for request
class OptionChainRequest(BaseModel):
    index_name: str
    strike_price: float

# Function to fetch option chain (adapted from oiData.py)
def get_option_chain(index_name: str, strike_price: float):
    try:
        incrementor = 50 if index_name == "NIFTY" else 100
        strike_price = int(strike_price - (strike_price % incrementor))
        start_index = 13 if index_name == "NIFTY" else 17
        
        # Search for expiry
        exch = 'NFO'
        query = 'nifty' if index_name == "NIFTY" else 'banknifty'
        ret = api.searchscrip(exchange=exch, searchtext=query)
        if not ret or 'values' not in ret:
            logger.error(f"Failed to fetch scrip data: {ret}")
            raise HTTPException(status_code=400, detail="Failed to fetch scrip data")
        
        symbols = ret['values']
        expiry = ""
        for symbol in symbols:
            if symbol['tsym'].endswith("0"):
                expiry = symbol['tsym'][9:16]
                break
        if not expiry:
            logger.error("Could not determine expiry date")
            raise HTTPException(status_code=400, detail="Could not determine expiry date")
        
        # Fetch option chain
        strike = f"{index_name}{expiry}P{strike_price}"
        logger.info(f"Fetching option chain for {strike} with strike price {strike_price}")
        chain = api.get_option_chain(exchange=exch, tradingsymbol=strike, strikeprice=strike_price, count=5)
        if not chain or 'values' not in chain:
            logger.error(f"Failed to fetch option chain: {chain}")
            raise HTTPException(status_code=400, detail="Failed to fetch option chain")
        
        chainscrips = []
        for scrip in chain['values']:
            scripdata = api.get_quotes(exchange=scrip['exch'], token=scrip['token'])
            chainscrips.append(scripdata)
        
        # Format response
        option_chain_data = []
        for i in range(5):
            ce_data = chainscrips[9 - i]  # CE data (descending order)
            pe_data = chainscrips[9 + i + 1]  # PE data (ascending order)
            strike_price_extracted = ce_data["tsym"][start_index:start_index + 5]
            option_chain_data.append({
                "strike": strike_price_extracted,
                "ce_oi": ce_data["oi"],
                "ce_ltp": ce_data["lp"],
                "ce_token": ce_data["token"],
                "pe_oi": pe_data["oi"],
                "pe_ltp": pe_data["lp"],
                "pe_token": pe_data["token"]
            })
        
        return option_chain_data
    
    except Exception as e:
        logger.error(f"Error in get_option_chain: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching option chain: {str(e)}")

@app.on_event("startup")
async def startup_event():
    login_shoonya()

@app.post("/api/get_option_chain")
async def fetch_option_chain(request: OptionChainRequest):
    try:
        option_chain_data = get_option_chain(request.index_name, request.strike_price)
        return {"message": f"Option chain data for {request.index_name} around strike {request.strike_price}", "data": option_chain_data}
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Endpoint error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)