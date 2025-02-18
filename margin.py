# --- IMPORTS ---
from SmartApi import SmartConnect
import pyotp
import requests
import json

# --- CONFIGURATION ---
API_KEY = "y2gLEdxZ"
CLIENT_CODE = "A62128571"
PASSWORD = "0852"
TOTP_SECRET = "654AU7VYVAOGKZGB347HKVIAB4"

# --- SmartAPI Object ---
smartApi = SmartConnect(api_key=API_KEY)

# Login to get the session token
data = smartApi.generateSession(CLIENT_CODE, PASSWORD, pyotp.TOTP(TOTP_SECRET).now())
if data['status']:
    refreshToken = data['data']['refreshToken']
    # Use this refresh token to get the feed token
    feedToken = smartApi.getfeedToken()
    print(f"Login Successful. Feed Token: {feedToken}")
else:
    print("Login failed:", data['message'])
    exit()

def fetch_ltp(smartApi, exchange, tokens):
    url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote"
    headers = {
        "Authorization": f"Bearer {smartApi.get_token()}",
        "X-UserToken": smartApi.get_client_code(),
        "Content-Type": "application/json"
    }
    payload = {
        "mode": "LTP",
        "exchangeTokens": {
            exchange: tokens
        }
    }
    
    response = requests.post(url, headers=headers, data=json.dumps(payload))
    if response.status_code == 200:
        data = response.json()
        if data['status']:
            return data['data']['fetched']
        else:
            print(f"API response status is not success: {data['message']}")
            return None
    else:
        print(f"Failed to fetch LTP: {response.text}")
        return None

def get_ltp_data(smartApi, stock_symbol, expiry_date, strike_price):
    # Example tokens, replace with actual method or value to fetch tokens from Angel One API
    stock_token = "26000"  # Example token for NIFTY, replace with actual token
    call_option_symbol = f"{stock_symbol[:5]}{expiry_date}{strike_price}CE"
    put_option_symbol = f"{stock_symbol[:5]}{expiry_date}{strike_price}PE"
    
    # For real implementation, you would need to use the correct method or API call
    # to get these tokens, like smartApi.getInstrumentForFNO or similar if available
    call_option_token = "12345"  # Example token, replace with actual token
    put_option_token = "67890"  # Example token, replace with actual token
    
    # Fetch LTP for stock, call, and put options
    ltp_data = fetch_ltp(smartApi, "NSE", [stock_token])
    ltp_data.extend(fetch_ltp(smartApi, "NFO", [call_option_token, put_option_token]))
    
    return ltp_data

# Now that smartApi is initialized and logged in, you can use it to fetch LTP data
stock_symbol = "NIFTY"
expiry_date = "20FEB25"
strike_price = "23250"

ltp_results = get_ltp_data(smartApi, stock_symbol, expiry_date, strike_price)

if ltp_results:
    for result in ltp_results:
        if result['exchange'] == "NSE":
            print(f"Stock LTP for {stock_symbol}: {result['ltp']}")
        elif 'CE' in result['tradingSymbol']:
            print(f"Call Option LTP for {result['tradingSymbol']}: {result['ltp']}")
        elif 'PE' in result['tradingSymbol']:
            print(f"Put Option LTP for {result['tradingSymbol']}: {result['ltp']}")
else:
    print("Failed to fetch LTP data")