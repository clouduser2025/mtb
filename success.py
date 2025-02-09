
# Import necessary libraries
from SmartApi import SmartConnect  # or from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger

# --- CONFIGURATION ---
API_KEY = "y2gLEdxZ"  
CLIENT_CODE = "A62128571"
PASSWORD = "0852"
TOTP_SECRET = "654AU7VYVAOGKZGB347HKVIAB4"

# Create SmartAPI Object
smartApi = SmartConnect(api_key=API_KEY)

# --- STEP 1: GENERATE TOTP ---
try:
    totp = pyotp.TOTP(TOTP_SECRET).now()
except Exception as e:
    logger.error("Invalid TOTP Token.")
    raise e

# --- STEP 2: LOGIN ---
logger.info("Logging into SmartAPI...")
login_data = smartApi.generateSession(CLIENT_CODE, PASSWORD, totp)

if not login_data["status"]:
    logger.error(f"Login Failed: {login_data}")
    exit()
else:
    authToken = login_data["data"]["jwtToken"]
    feedToken = smartApi.getfeedToken()
    logger.info("Login Successful!")

# --- STEP 3: FETCH LTP DATA ---
def fetch_ltp(exchange, symbol_token):
    """
    Fetches Last Traded Price (LTP) from SmartAPI using `ltpData()`.
    """
    try:
        # Use the correct method `ltpData()` instead of `getQuote()`
        response = smartApi.ltpData(exchange=exchange, tradingsymbol=symbol_token, symboltoken=symbol_token)

        if response["status"]:
            ltp = response["data"]["ltp"]
            logger.info(f"{symbol_token} LTP = {ltp}")
        else:
            logger.error(f"Error fetching LTP: {response.get('message', 'Unknown Error')}")
    except Exception as e:
        logger.error(f"LTP Fetch Error: {e}")

# --- SYMBOLS TO FETCH LTP FOR ---
symbols = [
    {"exchange": "NSE", "symbol_token": "3045"},  # Example: SBIN-EQ
]

# Fetch LTP for each symbol
for symbol in symbols:
    fetch_ltp(symbol["exchange"], symbol["symbol_token"])

# --- STEP 4: LOGOUT ---
try:
    logout_response = smartApi.terminateSession(CLIENT_CODE)
    logger.info("Logout Successful!")
except Exception as e:
    logger.error(f"Logout Failed: {e}")
