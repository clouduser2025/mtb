from api_helper import ShoonyaApiPy, get_time
import datetime
import logging
import time
import yaml
import pandas as pd
import os
import pyotp

# Setup logging
logging.basicConfig(level=logging.DEBUG)

# WebSocket flag
socket_opened = False

# Callback functions
def event_handler_order_update(message):
    print("Order update: " + str(message))

def event_handler_quote_update(message):
    print(f"Quote update: {time.strftime('%d-%m-%Y %H:%M:%S')} {message}")

def open_callback():
    global socket_opened
    socket_opened = True
    print('WebSocket connected')

# Initialize API
api = ShoonyaApiPy()

# Load credentials from cred.yml in the same directory
cred_path = os.path.join(os.path.dirname(__file__), 'cred.yml')
try:
    with open(cred_path, 'r') as f:
        cred = yaml.load(f, Loader=yaml.FullLoader)
        print("Credentials loaded successfully from", cred_path)
except FileNotFoundError:
    print(f"Error: cred.yml not found at {cred_path}")
    exit()
except Exception as e:
    print(f"Error loading cred.yml: {e}")
    exit()

# Login function with TOTP generation
def login_to_api():
    try:
        totp = pyotp.TOTP(cred['totp_secret'])
        twofa_code = totp.now()
        print("Generated TOTP code:", twofa_code)

        print("Attempting login with the following credentials:")
        print(f"User ID: {cred['user']}")
        print(f"Password: {'*' * len(cred['pwd'])}")
        print(f"TwoFA: {twofa_code}")
        print(f"Vendor Code: {cred['vc']}")
        print(f"API Secret: {cred['apikey']}")
        print(f"IMEI: {cred['imei']}")

        ret = api.login(
            userid=cred['user'],
            password=cred['pwd'],
            twoFA=twofa_code,
            vendor_code=cred['vc'],
            api_secret=cred['apikey'],
            imei=cred['imei']
        )
        print("API Response:", ret)

        if ret:
            print("Login successful")
            return True
        else:
            print("Login failed: API returned None or False")
            return False
    except KeyError as e:
        print(f"Login error: Missing key in cred.yml - {e}")
        return False
    except Exception as e:
        print(f"Login error: {e}")
        return False

# Function to get option chain data
def get_option_chain_data(exchange, symbol, expiry_date, strike_price, strike_count=5):
    try:
        expiry_str = expiry_date.strftime('%d%b%y').upper()
        search_query = f"{symbol} {expiry_str}"
        search_result = api.searchscrip(exchange=exchange, searchtext=search_query)
        
        if not search_result or 'values' not in search_result or not search_result['values']:
            print(f"No symbols found for {search_query}")
            return None

        base_symbol = search_result['values'][0]['tsym']
        print(f"Using base symbol: {base_symbol}")

        chain = api.get_option_chain(
            exchange=exchange,
            tradingsymbol=base_symbol,
            strikeprice=str(strike_price),  # Use user-provided strike price
            count=str(strike_count)         # Convert to string for API
        )

        if not chain or 'values' not in chain:
            print("No option chain data available")
            return None

        chain_data = []
        for scrip in chain['values']:
            quote = api.get_quotes(exchange=scrip['exch'], token=scrip['token'])
            if quote:
                chain_data.append({
                    'TradingSymbol': scrip['tsym'],
                    'Token': scrip['token'],
                    'StrikePrice': scrip.get('strprc', 'N/A'),
                    'OptionType': scrip.get('optt', 'N/A'),
                    'LTP': quote.get('lp', 'N/A'),
                    'Open': quote.get('op', 'N/A'),
                    'High': quote.get('h', 'N/A'),
                    'Low': quote.get('l', 'N/A'),
                    'Close': quote.get('c', 'N/A'),
                    'Volume': quote.get('v', 'N/A')
                })

        df = pd.DataFrame(chain_data)
        return df

    except Exception as e:
        print(f"Error fetching option chain: {e}")
        return None

# Main frontend loop
def main():
    if not login_to_api():
        return

    while True:
        print("\n=== Option Chain Fetcher ===")
        print("Enter details to fetch option chain data")
        print("q => quit")

        choice = input("\nContinue? (y/q): ").lower()
        if choice == 'q':
            api.logout()
            print("Logged out. Goodbye!")
            break
        
        if choice != 'y':
            continue

        exchange = input("Enter exchange (e.g., NSE, NFO, MCX): ").upper()
        symbol = input("Enter symbol (e.g., NIFTY, BANKNIFTY, CRUDEOIL): ").upper()
        expiry_input = input("Enter expiry date (DD-MM-YYYY): ")

        try:
            expiry_date = datetime.datetime.strptime(expiry_input, '%d-%m-%Y')
        except ValueError:
            print("Invalid date format. Please use DD-MM-YYYY")
            continue

        strike_price_input = input("Enter strike price (e.g., 50000): ")
        try:
            strike_price = float(strike_price_input)  # Ensure it’s a valid number
        except ValueError:
            print("Invalid strike price. Please enter a numeric value.")
            continue

        strike_count = input("Enter number of strikes to fetch (default 5): ")
        strike_count = int(strike_count) if strike_count.isdigit() else 5

        result = get_option_chain_data(exchange, symbol, expiry_date, strike_price, strike_count)
        if result is not None:
            print("\nOption Chain Data:")
            print(result.to_string(index=False))
        else:
            print("Failed to fetch option chain data")

if __name__ == "__main__":
    main()