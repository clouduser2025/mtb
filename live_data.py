# live_data.py

from fastapi import FastAPI
from SmartApi import SmartConnect
import pyotp
from logzero import logger
from fastapi.middleware.cors import CORSMiddleware
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
import json
import time

# --- CONFIGURATION ---
api_key = "y2gLEdxZ"
username = "A62128571"
pwd = "0852"
token = "654AU7VYVAOGKZGB347HKVIAB4"

# --- SmartAPI Initialization ---
smartApi = SmartConnect(api_key)

# --- Login Process ---
try:
    totp = pyotp.TOTP(token).now()
    data = smartApi.generateSession(username, pwd, totp)

    if data['status'] == False:
        logger.error(data)
        raise Exception("Login failed")
    
    authToken = data['data']['jwtToken']
    refreshToken = data['data']['refreshToken']
    feedToken = smartApi.getfeedToken()
    
    # Fetch User Profile
    res = smartApi.getProfile(refreshToken)
    smartApi.generateToken(refreshToken)
    exchanges = res['data']['exchanges']

    logger.info("Login Successful!")

except Exception as e:
    logger.error(f"Login Error: {e}")
    exit()

# --- FastAPI App ---
app = FastAPI()

# Add CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- WebSocket Setup ---
correlation_id = "abc123"
action = 1
mode = 1

token_list = [
    {
        "exchangeType": 1,  # 1 for NSE
        "tokens": ["26009", "26010"]  # Multiple tokens for different stocks
    }
]
token_list1 = [
    {
        "action": 0,  # 0 for unsubscribe
        "exchangeType": 1,
        "tokens": ["26009", "26010"]
    }
]

sws = SmartWebSocketV2(authToken, api_key, username, feedToken)

def on_data(wsapp, message):
    # Parse the JSON message
    data = json.loads(message)
    logger.info("Ticks: {}".format(data))
    # Example: Process the data further here
    for tick in data:
        if 'ltp' in tick:
            logger.info(f"Symbol: {tick.get('symbol', 'N/A')}, LTP: {tick['ltp']}")

def on_open(wsapp):
    logger.info("WebSocket connection opened")
    sws.subscribe(correlation_id, mode, token_list)

def on_error(wsapp, error):
    logger.error(f"WebSocket error: {error}")
    retry_count = 0
    max_retries = 3
    while retry_count < max_retries:
        try:
            logger.info(f"Attempting to reconnect (Attempt {retry_count + 1})...")
            sws.connect()
            break
        except Exception as e:
            retry_count += 1
            if retry_count == max_retries:
                logger.error("Max retry attempts reached. Connection failed.")
                break
            logger.info(f"Retrying in 5 seconds...")
            time.sleep(5)  # Wait before retrying

def on_close(wsapp):
    logger.info("WebSocket connection closed")

def close_connection():
    sws.close_connection()

# Assign the callbacks.
sws.on_open = on_open
sws.on_data = on_data
sws.on_error = on_error
sws.on_close = on_close

# Connect WebSocket
sws.connect()

# --- API Endpoints ---
@app.get("/")
async def root():
    return {"message": "Hello, World! Welcome to Live Data Server"}

@app.on_event("startup")
async def startup_event():
    logger.info("Starting up the application...")

@app.on_event("shutdown")
def shutdown_event():
    logger.info("Shutting down the application...")
    close_connection()

# --- Run the Server ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)