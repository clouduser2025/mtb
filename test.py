# --- CONFIGURATION ---
API_KEY = "y2gLEdxZ"
CLIENT_CODE = "A62128571"
PASSWORD = "0852"
TOTP_SECRET = "654AU7VYVAOGKZGB347HKVIAB4"

# Import necessary libraries
from SmartApi import SmartConnect
import pyotp
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- SmartAPI Object ---
smartApi = SmartConnect(api_key=API_KEY)

# --- Login Process ---
try:
    # Generate TOTP (Time-based One-Time Password)
    totp = pyotp.TOTP(TOTP_SECRET).now()

    # Attempt to login
    login_data = smartApi.generateSession(CLIENT_CODE, PASSWORD, totp)

    if not login_data["status"]:
        raise Exception(f"Login failed with message: {login_data}")

    # Retrieve the JWT token for subsequent API calls
    authToken = login_data["data"]["jwtToken"]
    feedToken = smartApi.getfeedToken()

    logger.info("Login Successful!")
    logger.info(f"Auth Token: {authToken[:10]}...")  # Only log first 10 chars for security

except Exception as e:
    logger.error(f"Login Error: {e}")

# Now you can use 'authToken' or 'feedToken' for making API calls, 
# like fetching LTP, OHLC data, or placing orders, depending on the API's methods.