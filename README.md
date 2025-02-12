(trade) C:\Users\shafe\multi_broker>uvicorn app:app --host 0.0.0.0 --port 8000
[I 250210 17:18:20 smartConnect:121] in pool
[I 250210 17:18:20 ltp_server:27] Logging into SmartAPI...
[I 250210 17:18:21 ltp_server:38] Login Successful!
INFO:     Started server process [23340]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)

uvicorn app:app --host 0.0.0.0 --port 8000
pip install -r requirements.txt && npm install && npm run build

C:\Users\shafe>curl -X POST http://127.0.0.1:8000/api/register_user -H "Content-Type: application/json" -d "{\"username\":\"test_user\",\"broker\":\"Angel\",\"api_key\":\"sample_api_key\",\"totp_token\":\"sample_totp_token\",\"default_quantity\":10}"
{"message":"User registered successfully"}
C:\Users\shafe>

(trade) C:\Users\shafe\multi_broker>curl -X POST http://127.0.0.1:8000/api/register_user -H "Content-Type: application/json" -d "{\"username\":\"new_user\",\"broker\":\"Angel\",\"api_key\":\"sample_api_key\",\"totp_token\":\"sample_totp_token\",\"default_quantity\":10}"
{"message":"User registered successfully"}
(trade) C:\Users\shafe\multi_broker>

 How the Table Works
✅ Username → The trader who executed the trade.
✅ Symbol → The stock or instrument traded.
✅ Entry Price → The price at which the trade was executed.
✅ Threshold → The price condition (buy/sell trigger point).
✅ Exit Type → The method used to exit the trade (Fixed, Percentage, or Points).
✅ Exit Value → The stop-loss or stop-gain condition.
✅ Position → LONG (buy) or SHORT (sell).

curl -X POST "https://ramdoot.onrender.com/api/register_user" ^
     -H "Content-Type: application/json" ^
     -d "{\"username\":\"test_user\",\"broker\":\"Angel\",\"api_key\":\"123456\",\"totp_token\":\"ABCDEFGH\",\"default_quantity\":1}"
