import csv
import json
import os
from datetime import datetime

BLOCK_DEALS_CSV = r"c:\Users\vamsi\Downloads\Block-Deals-Combined-19-04-2024-to-19-04-2026.csv"
BULK_DEALS_CSV = r"c:\Users\vamsi\Downloads\Bulk-Deals-Combined-19-04-2024-to-19-04-2026.csv"
OUTPUT_JSON = os.path.join(os.path.dirname(__file__), "public", "deals.json")
NSE_DATE_FMT = "%d-%m-%Y"

def safe_int(v):
    try: return int(str(v).replace(",", "").strip() or 0)
    except: return 0

def safe_float(v):
    try: return float(str(v).replace(",", "").strip() or 0)
    except: return 0.0

def normalise_date(raw_date):
    try:
        dt = datetime.strptime(raw_date.strip().title(), "%d-%b-%Y")
        return dt.strftime(NSE_DATE_FMT)
    except Exception:
        return raw_date.strip()

def parse_csv(filepath, deal_type):
    deals = []
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return deals
        
    with open(filepath, 'r', encoding='utf-8-sig', errors='replace') as f:
        reader = csv.DictReader(f)
        # Handle trailing spaces in header names
        reader.fieldnames = [name.strip() for name in reader.fieldnames]
        
        for row in reader:
            if not row.get("Date"):
                continue
            
            qty = safe_int(row.get("Quantity Traded", 0))
            price = safe_float(row.get("Trade Price / Wght. Avg. Price", 0))
            
            deals.append({
                "id": "",  # no ID in CSV
                "date": normalise_date(row.get("Date", "")),
                "symbol": row.get("Symbol", "").strip(),
                "client": row.get("Client Name", "").strip(),
                "buy_sell": row.get("Buy / Sell", "").strip().upper(),
                "quantity": qty,
                "price": price,
                "value_cr": round((qty * price) / 10_000_000, 2),
                "type": deal_type
            })
    return deals

def main():
    print("Loading block deals...")
    block_deals = parse_csv(BLOCK_DEALS_CSV, "block")
    print(f"Loaded {len(block_deals)} block deals.")

    print("Loading bulk deals...")
    bulk_deals = parse_csv(BULK_DEALS_CSV, "bulk")
    print(f"Loaded {len(bulk_deals)} bulk deals.")

    all_deals = block_deals + bulk_deals
    
    # Sort deals by parsed date descending, then symbol
    def sort_key(d):
        try:
            dt = datetime.strptime(d["date"], NSE_DATE_FMT)
        except:
            dt = datetime.min
        return (dt, d["symbol"])
    
    all_deals.sort(key=sort_key, reverse=True)
    
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding='utf-8') as f:
        json.dump(all_deals, f, indent=2)
        
    print(f"Saved total {len(all_deals)} records to {OUTPUT_JSON}")

if __name__ == "__main__":
    main()
