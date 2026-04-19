import requests
import json
import os
from datetime import datetime, timedelta

def fetch_nse():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://www.nseindia.com/report-detail/display-bulk-and-block-deals",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest"
    }
    
    session = requests.Session()
    session.headers.update(headers)
    
    # 1. Get cookies
    print("Getting base cookies...")
    try:
        session.get("https://www.nseindia.com", timeout=10)
    except Exception as e:
        print("Failed to get cookies:", e)
        return
        
    end_date = datetime.today()
    start_date = end_date - timedelta(days=30)
    start_str = start_date.strftime("%d-%m-%Y")
    end_str = end_date.strftime("%d-%m-%Y")
    
    deals = []
    
    # 2. Fetch bulk deals
    bulk_url = f"https://www.nseindia.com/api/historical/bulk-deals?from={start_str}&to={end_str}"
    print(f"Fetching bulk deals: {bulk_url}")
    try:
        r = session.get(bulk_url, timeout=10)
        print("Status", r.status_code)
        if r.status_code == 200:
            data = r.json()
            if "data" in data:
                print(f"Got {len(data['data'])} bulk deals")
                for index, row in enumerate(data['data']):
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
            else:
                 print("No 'data' key in response, got:", data)
    except Exception as e:
        print("Bulk Fetch Error:", e)

    # 3. Fetch block deals
    block_url = f"https://www.nseindia.com/api/historical/block-deals?from={start_str}&to={end_str}"
    print(f"Fetching block deals: {block_url}")
    try:
        r2 = session.get(block_url, timeout=10)
        if r2.status_code == 200:
            data = r2.json()
            if "data" in data:
                print(f"Got {len(data['data'])} block deals")
                for index, row in enumerate(data['data']):
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
    except Exception as e:
         print("Block Fetch Error:", e)

    with open("public/deals.json", "w") as f:
        json.dump(deals, f, indent=4)
    print(f"✅ Saved {len(deals)} items to public/deals.json")

if __name__ == '__main__':
    fetch_nse()
