"""
NSE Bulk, Block & Short-Selling Deals Fetcher — MySQL Mode

First run  : Fetches full 120-day history and inserts into MySQL
Subsequent : Finds latest date in MySQL DB, fetches only from
             (latest_date + 1) → today, inserts new rows.

Usage:
  python fetch_nse_real.py            # incremental (default)
  python fetch_nse_real.py --full     # force full 120-day re-fetch
  python fetch_nse_real.py --days 60  # force full but only N days back
"""
import os, time, argparse
from datetime import datetime, timedelta

import nsepythonserver as nse

try:
    import mysql.connector
except ImportError:
    print("ERROR: mysql-connector-python not installed.")
    print("       Run: pip install mysql-connector-python")
    raise

from dotenv import dotenv_values

# ─── Config ───────────────────────────────────────────────────────────────────
_env = dotenv_values(os.path.join(os.path.dirname(__file__), ".env"))

DB_CONFIG = {
    "host":     _env.get("DB_HOST",     "127.0.0.1"),
    "port":     int(_env.get("DB_PORT", "3306")),
    "user":     _env.get("DB_USER",     "nse_user"),
    "password": _env.get("DB_PASSWORD", "nse_pass"),
    "database": _env.get("DB_NAME",     "nse_deals"),
    "charset":  "utf8mb4",
}

SLEEP_BETWEEN_REQUESTS = 2
FULL_HISTORY_DAYS      = 120
NSE_DATE_FMT           = "%d-%m-%Y"
MYSQL_DATE_FMT         = "%Y-%m-%d"

# PATCH: Windows curl doesn't support brotli
if hasattr(nse, 'curl_headers'):
    nse.curl_headers = nse.curl_headers.replace(', br','').replace('br,','').replace('br','')


# ─── DB helpers ───────────────────────────────────────────────────────────────
def get_connection():
    return mysql.connector.connect(**DB_CONFIG)


def get_latest_date_from_db(deal_type):
    """Return the latest deal_date for a given type, or None."""
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        "SELECT MAX(deal_date) FROM deals WHERE deal_type = %s",
        (deal_type,)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row[0] if row else None  # datetime.date or None


def insert_deals(records):
    """
    Bulk-insert a list of normalised dicts into MySQL.
    Uses INSERT IGNORE to skip duplicates (unique key on deal).
    """
    if not records:
        return 0

    conn = get_connection()
    cur  = conn.cursor()

    sql = """
        INSERT IGNORE INTO deals
            (deal_id, deal_date, symbol, client, buy_sell, quantity, price, value_cr, deal_type)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    rows = []
    for d in records:
        rows.append((
            d.get("id", "")[:64],
            d["mysql_date"],
            d["symbol"][:50],
            d["client"][:399],
            d["buy_sell"],
            int(d["quantity"]),
            float(d["price"]),
            float(d["value_cr"]),
            d["type"],
        ))

    cur.executemany(sql, rows)
    affected = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return affected


# ─── NSE fetch helpers ────────────────────────────────────────────────────────
DEAL_TYPE_TO_API = {
    "bulk":  "bulk-deals",
    "block": "block-deals",
    "short": "short-selling",
}

SNAPSHOT_URL = "https://www.nseindia.com/api/snapshot-capital-market-largedeal"
MODE_MAP = {
    "bulk":  "BULK_DEALS_DATA",
    "block": "BLOCK_DEALS_DATA",
    "short": "SHORT_DEALS_DATA",
}


def parse_nse_date(raw):
    """Parse DD-Mon-YYYY or DD-MM-YYYY → (display DD-MM-YYYY, mysql YYYY-MM-DD)."""
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.strftime(NSE_DATE_FMT), dt.strftime(MYSQL_DATE_FMT)
        except Exception:
            pass
    return raw, None


def safe_int(v):
    try: return int(str(v).replace(",","").strip() or 0)
    except: return 0

def safe_float(v):
    try: return float(str(v).replace(",","").strip() or 0)
    except: return 0.0


def normalise(row, deal_type):
    if deal_type == "short":
        raw_date = row.get("SS_DATE", row.get("DATE", row.get("date", "")))
        qty      = safe_int(row.get("QTY_SOLD", row.get("BD_QTY_TRD", 0)))
        price    = safe_float(row.get("AVG_PRICE", row.get("BD_TP_WATP", 0)))
        sym      = row.get("SCRIP_NAME", row.get("SYMBOL", ""))
        client   = row.get("CLIENT_NAME", row.get("clientName", ""))
        bs       = "SELL"
    else:
        raw_date = row.get("BD_DT_DATE", row.get("date", ""))
        qty      = safe_int(row.get("BD_QTY_TRD", row.get("qty", 0)))
        price    = safe_float(row.get("BD_TP_WATP", row.get("watp", 0)))
        sym      = row.get("BD_SYMBOL", row.get("symbol", ""))
        client   = row.get("BD_CLIENT_NAME", row.get("clientName", ""))
        bs       = (row.get("BD_BUY_SELL") or row.get("buySell") or "").strip().upper()

    display_date, mysql_date = parse_nse_date(raw_date)
    return {
        "id":         row.get("_id", ""),
        "date":       display_date,
        "mysql_date": mysql_date,
        "symbol":     sym,
        "client":     client,
        "buy_sell":   bs,
        "quantity":   qty,
        "price":      price,
        "value_cr":   round((qty * price) / 10_000_000, 2),
        "type":       deal_type,
    }


def fetch_chunk(from_str, to_str, kind):
    url = f"https://www.nseindia.com/api/historical/{kind}?from={from_str}&to={to_str}"
    print(f"  GET {url}")
    try:
        payload = nse.nsefetch(url)
        if isinstance(payload, dict) and "data" in payload:
            print(f"  Records: {len(payload['data'])}")
            return payload["data"]
        if isinstance(payload, list):
            return payload
    except Exception as e:
        print(f"  ERROR: {e}")
    return []


def fetch_range(start, end, deal_type="bulk"):
    api_kind   = DEAL_TYPE_TO_API[deal_type]
    deals      = []
    chunk_days = 29
    cur        = start

    while cur <= end:
        chunk_end = min(cur + timedelta(days=chunk_days), end)
        f_str = cur.strftime(NSE_DATE_FMT)
        t_str = chunk_end.strftime(NSE_DATE_FMT)
        print(f"\n[RANGE] {deal_type.upper()} {f_str} -> {t_str}")
        rows = fetch_chunk(f_str, t_str, api_kind)
        deals.extend(normalise(r, deal_type) for r in rows)
        print(f"  Waiting {SLEEP_BETWEEN_REQUESTS}s...")
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        cur = chunk_end + timedelta(days=1)

    return deals


def fetch_snapshot():
    """Fetch today's live snapshot for all 3 deal types."""
    print(f"\n[INFO] Fetching Realtime Snapshot Data from NSE...")
    new_data = []
    try:
        payload = nse.nsefetch(SNAPSHOT_URL)
        if payload:
            for dtype, key in MODE_MAP.items():
                raw_list = payload.get(key, [])
                print(f"  [SNAPSHOT {dtype.upper()}] {len(raw_list)} records found.")
                for r in raw_list:
                    new_data.append(normalise(r, dtype))
        else:
            print("  [ERROR] Snapshot payload was empty.")
    except Exception as e:
        print(f"  [ERROR] Failed to fetch realtime snapshot: {e}")
    return new_data


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--days", type=int, default=FULL_HISTORY_DAYS)
    args = parser.parse_args()

    today = datetime.today().replace(hour=0, minute=0, second=0, microsecond=0)

    # Determine latest dates in MySQL per type
    l_bulk  = get_latest_date_from_db("bulk")
    l_block = get_latest_date_from_db("block")
    l_short = get_latest_date_from_db("short")

    if args.full or (l_bulk is None and l_block is None and l_short is None):
        start = today - timedelta(days=args.days)
        print(f"\n[FULL FETCH] {start.strftime(NSE_DATE_FMT)} -> {today.strftime(NSE_DATE_FMT)}")
        new_data = fetch_range(start, today, "bulk")
        new_data.extend(fetch_range(start, today, "block"))
        new_data.extend(fetch_range(start, today, "short"))
    else:
        new_data = fetch_snapshot()
        if not new_data:
            print("\n[INFO] Nothing new to insert.")
            return

    # Filter out records with invalid dates
    valid = [d for d in new_data if d.get("mysql_date")]
    print(f"\n[INSERT] Inserting {len(valid)} records into MySQL...")
    inserted = insert_deals(valid)
    print(f"[DONE]  {inserted} new rows inserted (duplicates ignored).")


if __name__ == "__main__":
    main()
