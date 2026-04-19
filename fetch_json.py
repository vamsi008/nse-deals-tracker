import pandas as pd
from nsepython import nse_largedeals_historical
from datetime import datetime, timedelta
import json
import time
import os

end_date = datetime.today()
start_date = end_date - timedelta(days=30)
current_date = start_date

deals = []

while current_date <= end_date:
    date_str = current_date.strftime("%d-%m-%Y")
    print(f"Fetching data for {date_str}...")
    try:
        # bulk-deals
        try:
            data = nse_largedeals_historical(date_str, date_str, "bulk-deals")
            if data and isinstance(data, list) and len(data) > 0:
                df = pd.DataFrame(data)
                if not df.empty:
                    for _, row in df.iterrows():
                        deals.append({
                            "id": row.get('_id', f"bulk_{date_str}_{_}"),
                            "date": row.get('BD_DT_DATE', date_str),
                            "symbol": row.get('BD_SYMBOL', ''),
                            "client": row.get('BD_CLIENT_NAME', ''),
                            "buy_sell": row.get('BD_BUY_SELL', ''),
                            "quantity": int(row.get('BD_QTY_TRD', 0)),
                            "price": float(row.get('BD_TP_WATP', 0.0)),
                            "value_cr": round((int(row.get('BD_QTY_TRD', 0)) * float(row.get('BD_TP_WATP', 0.0))) / 10000000, 2),
                            "type": "bulk"
                        })
        except Exception as e:
            print(f"Error bulk deals on {date_str}: {e}")

        time.sleep(0.5)
        
        # block-deals
        try:
            data_block = nse_largedeals_historical(date_str, date_str, "block-deals")
            if data_block and isinstance(data_block, list) and len(data_block) > 0:
                df_b = pd.DataFrame(data_block)
                if not (df_b is None or df_b.empty):
                    for _, row in df_b.iterrows():
                        deals.append({
                            "id": row.get('_id', f"block_{date_str}_{_}"),
                            "date": row.get('BD_DT_DATE', date_str),
                            "symbol": row.get('BD_SYMBOL', ''),
                            "client": row.get('BD_CLIENT_NAME', ''),
                            "buy_sell": row.get('BD_BUY_SELL', ''),
                            "quantity": int(row.get('BD_QTY_TRD', 0)),
                            "price": float(row.get('BD_TP_WATP', 0.0)),
                            "value_cr": round((int(row.get('BD_QTY_TRD', 0)) * float(row.get('BD_TP_WATP', 0.0))) / 10000000, 2),
                            "type": "block"
                        })
        except Exception as e:
             print(f"Error block deals on {date_str}: {e}")

    except Exception as e:
        print(f"General error on {date_str}: {e}")
        
    current_date += timedelta(days=1)
    time.sleep(0.5)

public_dir = os.path.join(os.getcwd(), "public")
if not os.path.exists(public_dir):
    os.makedirs(public_dir)

with open(os.path.join(public_dir, "deals.json"), "w") as f:
    json.dump(deals, f, indent=4)
    
print(f"\n✅ Data saved to public/deals.json. Total records: {len(deals)}")
