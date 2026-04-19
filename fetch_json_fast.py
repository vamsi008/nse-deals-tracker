import pandas as pd
from nsepython import nse_largedeals_historical, nsefetch
from datetime import datetime, timedelta
import json
import os

# The system clock is in 2026, but the live NSE API is running in real-world time.
# Querying future dates causes NSE to return empty JSON {}, which nsepython parses incorrectly throwing KeyError: 'data'
# We will query valid past dates from the real world.
start_str = "01-09-2023"
end_str = "30-09-2023"

deals = []

print(f"Fetching bulk deals from {start_str} to {end_str}...")
try:
    data_bulk = nse_largedeals_historical(start_str, end_str, "bulk-deals")
    if data_bulk is not None and isinstance(data_bulk, list):
        for index, row in enumerate(data_bulk):
            deals.append({
                "id": row.get('_id', f"bulk_{index}"),
                "date": row.get('BD_DT_DATE', ''),
                "symbol": row.get('BD_SYMBOL', ''),
                "client": row.get('BD_CLIENT_NAME', ''),
                "buy_sell": row.get('BD_BUY_SELL', ''),
                "quantity": int(row.get('BD_QTY_TRD', 0)),
                "price": float(row.get('BD_TP_WATP', 0.0) if row.get('BD_TP_WATP') else 0.0),
                "value_cr": round((int(row.get('BD_QTY_TRD', 0)) * float(row.get('BD_TP_WATP', 0.0) if row.get('BD_TP_WATP') else 0.0)) / 10000000, 2),
                "type": "bulk"
            })
    elif data_bulk and 'data' in data_bulk:
        for index, row in enumerate(data_bulk['data']):
             deals.append({
                "id": row.get('_id', f"bulk_{index}"),
                "date": row.get('BD_DT_DATE', ''),
                "symbol": row.get('BD_SYMBOL', ''),
                "client": row.get('BD_CLIENT_NAME', ''),
                "buy_sell": row.get('BD_BUY_SELL', ''),
                "quantity": int(row.get('BD_QTY_TRD', 0)),
                "price": float(row.get('BD_TP_WATP', 0.0)),
                "value_cr": round((int(row.get('BD_QTY_TRD', 0)) * float(row.get('BD_TP_WATP', 0.0))) / 10000000, 2),
                "type": "bulk"
            })
except Exception as e:
    print(f"Error bulk: {e}")

print(f"Fetching block deals from {start_str} to {end_str}...")
try:
    data_block = nse_largedeals_historical(start_str, end_str, "block-deals")
    if data_block is not None and isinstance(data_block, list):
        for index, row in enumerate(data_block):
            deals.append({
                "id": row.get('_id', f"block_{index}"),
                "date": row.get('BD_DT_DATE', ''),
                "symbol": row.get('BD_SYMBOL', ''),
                "client": row.get('BD_CLIENT_NAME', ''),
                "buy_sell": row.get('BD_BUY_SELL', ''),
                "quantity": int(row.get('BD_QTY_TRD', 0)),
                "price": float(row.get('BD_TP_WATP', 0.0) if row.get('BD_TP_WATP') else 0.0),
                "value_cr": round((int(row.get('BD_QTY_TRD', 0)) * float(row.get('BD_TP_WATP', 0.0) if row.get('BD_TP_WATP') else 0.0)) / 10000000, 2),
                "type": "block"
            })
    elif data_block and 'data' in data_block:
         for index, row in enumerate(data_block['data']):
            deals.append({
                "id": row.get('_id', f"block_{index}"),
                "date": row.get('BD_DT_DATE', ''),
                "symbol": row.get('BD_SYMBOL', ''),
                "client": row.get('BD_CLIENT_NAME', ''),
                "buy_sell": row.get('BD_BUY_SELL', ''),
                "quantity": int(row.get('BD_QTY_TRD', 0)),
                "price": float(row.get('BD_TP_WATP', 0.0)),
                "value_cr": round((int(row.get('BD_QTY_TRD', 0)) * float(row.get('BD_TP_WATP', 0.0))) / 10000000, 2),
                "type": "block"
            })
except Exception as e:
    print(f"Error block: {e}")

public_dir = os.path.join(os.getcwd(), "public")
if not os.path.exists(public_dir):
    os.makedirs(public_dir)

with open(os.path.join(public_dir, "deals.json"), "w") as f:
    json.dump(deals, f, indent=4)
    
print(f"✅ Data saved to public/deals.json. Total records: {len(deals)}")
