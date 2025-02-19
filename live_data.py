import pyotp
from Smartapi import SmartConnect, WebSocket  



# User Credentials (DO NOT SHARE PUBLICLY)
# --- CONFIGURATION ---
API_KEY = "y2gLEdxZ"
CLIENT_CODE = "A62128571"
PASSWORD = "0852"
TOTP_SECRET = "654AU7VYVAOGKZGB347HKVIAB4"

# Generate TOTP dynamically
totp = pyotp.TOTP(TOTP_SECRET).now()

# Initialize SmartConnect
obj = SmartConnect(api_key=API_KEY)
data = obj.generateSession(CLIENT_CODE, PASSWORD, totp)

# Check if login was successful
if "feedToken" in data:
    feedToken = obj.getfeedToken()
    print("Feed Token:", feedToken)
else:
    print("Login Failed:", data)
    exit()

# WebSocket Configuration
FEED_TOKEN = feedToken
TOKEN = "nse_cm|26009"

WS = WebSocket(FEED_TOKEN, CLIENT_CODE)

def on_tick(ws, tick):
    print("Received Tick Data:", tick)

def on_connect(ws, response):
    print("Connected:", response)
    ws.send_request(TOKEN)

def on_close(ws, code, reason):
    print(f"Connection Closed: Code-{code}, Reason-{reason}")
    ws.stop()

# Assign the callbacks
WS.on_ticks = on_tick
WS.on_connect = on_connect
WS.on_close = on_close

# Start WebSocket
print("Connecting to WebSocket...")
WS.connect()
