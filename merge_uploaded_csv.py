import sys
import os
import json
from datetime import datetime
from init_db_from_csv import parse_csv

DATA_FILE = os.path.join(os.path.dirname(__file__), "public", "deals.json")
NSE_DATE_FMT = "%d-%m-%Y"

def load_existing():
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"Could not load existing data: {e}")
        return []

def merge_deals(existing, new_deals):
    seen = {}
    def key(d):
        return (d.get("date"), d.get("symbol"), d.get("client"),
                d.get("buy_sell"), d.get("type"), d.get("quantity"), d.get("price"))

    for d in existing:
        k = key(d)
        seen[k] = d
    for d in new_deals:
        k = key(d)
        seen[k] = d   # new wins

    return list(seen.values())

def main():
    if len(sys.argv) < 3:
        print("Usage: python merge_uploaded_csv.py <csv_path> <deal_type>")
        sys.exit(1)
        
    csv_path = sys.argv[1]
    deal_type = sys.argv[2]
    
    print(f"Parsing uploaded CSV. Type: {deal_type}")
    new_deals = parse_csv(csv_path, deal_type)
    print(f"Parsed {len(new_deals)} records from CSV.")
    
    existing = load_existing()
    print(f"Loaded {len(existing)} existing records.")
    
    merged = merge_deals(existing, new_deals)
    
    def sort_key(d):
        try:
            dt = datetime.strptime(d["date"], NSE_DATE_FMT)
        except:
            dt = datetime.min
        return (dt, d["symbol"])
    
    merged.sort(key=sort_key, reverse=True)
    
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)
        
    print(f"Successfully saved {len(merged)} total records.")

if __name__ == "__main__":
    main()
