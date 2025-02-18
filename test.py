import requests

# URL for fetching instrument data
url = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json'

# Function to get the token for a given symbol
def get_token(symbol_input):
    try:
        # Fetch data from the URL
        response = requests.get(url)
        
        # Check if the request was successful
        if response.status_code == 200:
            # Parse the JSON response
            data = response.json()
            
            # Loop through the data to find the matching symbol
            for instrument in data:
                # Check if the symbol matches
                if instrument['symbol'] == symbol_input:
                    # Return the corresponding token
                    return instrument['token']
            
            # If symbol not found
            return "Symbol not found."
        else:
            return "Error fetching data."
    
    except Exception as e:
        return f"An error occurred: {str(e)}"

# Main part of the program
if __name__ == "__main__":
    # Take user input for the symbol
    symbol_input = input("Enter the symbol: ")
    
    # Get the token for the symbol
    token = get_token(symbol_input)
    
    # Display the result
    print(f"Token for {symbol_input}: {token}")
