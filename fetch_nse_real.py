"""
NSE Bulk, Block & Short-Selling Deals Fetcher — Incremental Mode + Today's Snapshot

First run  : Fetches full 120-day history and saves to public/deals.json
Subsequent : Reads existing deals.json, finds latest date present,
             fetches only from (latest_date + 1) → today, merges & saves.

Deal types fetched:
  bulk          → /api/historical/bulk-deals
  block         → /api/historical/block-deals
  short         → /api/historical/short-selling

Also provides:
  nse_largedeals(mode)             — Today's live snapshot from NSE
  nse_largedeals_historical(...)   — Historical deals for any date range
  mode: 'bulk_deals' | 'short_deals' | 'block_deals'

Usage:
  python fetch_nse_real.py            # incremental (default)
  python fetch_nse_real.py --full     # force full 120-day re-fetch
  python fetch_nse_real.py --days 60  # force full but only N days back
"""
import json, os, time, argparse
from datetime import datetime, timedelta
import nsepythonserver as nse

try:
    import pandas as pd
except ImportError:
    pd = None

# PATCH: Windows curl doesn't support brotli ('br'). Remove it to prevent curl: (61) error.
if hasattr(nse, 'curl_headers'):
    nse.curl_headers = nse.curl_headers.replace(', br', '').replace('br,', '').replace('br', '')

SLEEP_BETWEEN_REQUESTS = 2       # seconds between each API call
FULL_HISTORY_DAYS      = 120     # how far back for a fresh full fetch
DATA_FILE              = os.path.join(os.path.dirname(__file__), "public", "deals.json")

NSE_DATE_FMT = "%d-%m-%Y"


# ─── Fetch one date-range + deal type ─────────────────────────────────────────
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
        print(f"  Unknown response: {list(payload.keys()) if isinstance(payload, dict) else type(payload)}")
    except Exception as e:
        print(f"  ERROR: {e}")
    return []


# ─── Normalise a raw NSE row ───────────────────────────────────────────────────
def normalise(row, deal_type):
    """
    Normalise a raw API row into a common schema.
    """
    def safe_int(v):
        try: return int(str(v).replace(",", "").strip() or 0)
        except: return 0
    def safe_float(v):
        try: return float(str(v).replace(",", "").strip() or 0)
        except: return 0.0

    def parse_nse_date(raw):
        """Parse DD-Mon-YYYY or DD-MM-YYYY → DD-MM-YYYY."""
        for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(raw, fmt).strftime(NSE_DATE_FMT)
            except Exception:
                pass
        return raw  # keep as-is if unparseable

    if deal_type == "short":
        raw_date = row.get("SS_DATE", row.get("DATE", row.get("date", "")))
        qty   = safe_int(row.get("QTY_SOLD", row.get("BD_QTY_TRD", row.get("qty", 0))))
        price = safe_float(row.get("AVG_PRICE", row.get("BD_TP_WATP", row.get("watp", 0))))
        return {
            "id":       row.get("_id", ""),
            "date":     parse_nse_date(raw_date),
            "symbol":   row.get("SCRIP_NAME", row.get("SYMBOL", row.get("symbol", ""))),
            "client":   row.get("CLIENT_NAME", row.get("clientName", "")),
            "buy_sell": "SELL",
            "quantity": qty,
            "price":    price,
            "value_cr": round((qty * price) / 10_000_000, 2),
            "type":     deal_type,
        }
    else:
        raw_date = row.get("BD_DT_DATE", row.get("date", ""))
        qty   = safe_int(row.get("BD_QTY_TRD", row.get("qty", 0)))
        price = safe_float(row.get("BD_TP_WATP", row.get("watp", 0)))
        return {
            "id":       row.get("_id", ""),
            "date":     parse_nse_date(raw_date),
            "symbol":   row.get("BD_SYMBOL", row.get("symbol", "")),
            "client":   row.get("BD_CLIENT_NAME", row.get("clientName", "")),
            "buy_sell": (row.get("BD_BUY_SELL") or row.get("buySell") or "").strip().upper(),
            "quantity": qty,
            "price":    price,
            "value_cr": round((qty * price) / 10_000_000, 2),
            "type":     deal_type,
        }


# ─── API path mapping ─────────────────────────────────────────────────────────
DEAL_TYPE_TO_API = {
    "bulk":  "bulk-deals",
    "block": "block-deals",
    "short": "short-selling",
}


# ─── Fetch a date range in 29-day chunks ──────────────────────────────────────
def fetch_range(start: datetime, end: datetime, deal_type="bulk"):
    if deal_type not in DEAL_TYPE_TO_API:
        raise ValueError(f"deal_type must be one of {list(DEAL_TYPE_TO_API)}")

    deals = []
    chunk_days = 29
    cur = start
    api_kind = DEAL_TYPE_TO_API[deal_type]

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


# ─── Load existing data ────────────────────────────────────────────────────────
def load_existing():
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"  Could not load existing data: {e}")
        return []


# ─── Find latest dates in existing records ────────────────────────────────────
def latest_dates(records):
    l_bulk  = None
    l_block = None
    l_short = None
    for rec in records:
        raw   = rec.get("date", "")
        dtype = rec.get("type", "")
        try:
            dt = datetime.strptime(raw, NSE_DATE_FMT)
            if dtype == "bulk"  and (l_bulk  is None or dt > l_bulk):  l_bulk  = dt
            if dtype == "block" and (l_block is None or dt > l_block): l_block = dt
            if dtype == "short" and (l_short is None or dt > l_short): l_short = dt
        except Exception:
            pass
    return l_bulk, l_block, l_short


# ─── Merge & deduplicate ───────────────────────────────────────────────────────
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


# ─── Save ─────────────────────────────────────────────────────────────────────
def save(deals):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(deals, f, indent=2)
    print(f"\n{'[OK]' if deals else '[EMPTY]'}  Saved {len(deals)} records -> {DATA_FILE}")


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full",  action="store_true", help="Force full re-fetch regardless of existing data")
    parser.add_argument("--days",  type=int, default=FULL_HISTORY_DAYS, help="Days back for full fetch (default 120)")
    args = parser.parse_args()

    today = datetime.today().replace(hour=0, minute=0, second=0, microsecond=0)

    existing = load_existing()
    l_bulk, l_block, l_short = latest_dates(existing) if existing else (None, None, None)

    if args.full or (l_bulk is None and l_block is None and l_short is None):
        # ── Full fetch ──
        start = today - timedelta(days=args.days)
        print(f"\n[FULL FETCH] {start.strftime(NSE_DATE_FMT)} -> {today.strftime(NSE_DATE_FMT)}  ({args.days} days)")
        new_data = fetch_range(start, today, "bulk")
        new_data.extend(fetch_range(start, today, "block"))
        new_data.extend(fetch_range(start, today, "short"))
        merged = merge_deals(existing, new_data)
    else:
        # ── Incremental fetch (using Live Snapshot) ──
        print("\n[INFO] Fetching Realtime Snapshot Data...")
        new_data = []
        
        try:
            payload = nse.nsefetch(SNAPSHOT_URL)
            if payload:
                # 1. Bulk Deals
                bulk_raw = payload.get(MODE_MAP["bulk_deals"], [])
                print(f"  [SNAPSHOT BULK] {len(bulk_raw)} records found.")
                for r in bulk_raw:
                    new_data.append(normalise(r, "bulk"))

                # 2. Block Deals
                block_raw = payload.get(MODE_MAP["block_deals"], [])
                print(f"  [SNAPSHOT BLOCK] {len(block_raw)} records found.")
                for r in block_raw:
                    new_data.append(normalise(r, "block"))

                # 3. Short Selling
                short_raw = payload.get(MODE_MAP["short_deals"], [])
                print(f"  [SNAPSHOT SHORT] {len(short_raw)} records found.")
                for r in short_raw:
                    new_data.append(normalise(r, "short"))
            else:
                print("  [ERROR] Snapshot payload was empty.")
        except Exception as e:
            print(f"  [ERROR] Failed to fetch realtime snapshot: {e}")

        if not new_data:
            print("\n[INFO] Nothing to fetch.")
            save(existing)  # Update timestamp
            return

        print(f"\n  New records fetched overall: {len(new_data)}")
        merged = merge_deals(existing, new_data)

    save(merged)


# ─── Today's Snapshot: Bulk / Short / Block Deals ────────────────────────────
SNAPSHOT_URL = "https://www.nseindia.com/api/snapshot-capital-market-largedeal"

MODE_MAP = {
    "bulk_deals":  "BULK_DEALS_DATA",
    "short_deals": "SHORT_DEALS_DATA",
    "block_deals": "BLOCK_DEALS_DATA",
}

HIST_MODE_MAP = {
    "bulk_deals":  "bulk-deals",
    "short_deals": "short-selling",
    "block_deals": "block-deals",
}

def nse_largedeals(mode="bulk_deals"):
    if mode not in MODE_MAP:
        raise ValueError(f"mode must be one of {list(MODE_MAP)}")

    try:
        print(f"[SNAPSHOT] GET {SNAPSHOT_URL}")
        payload = nse.nsefetch(SNAPSHOT_URL)
    except Exception as e:
        print(f"  ERROR fetching snapshot: {e}")
        return pd.DataFrame() if pd else []

    key = MODE_MAP[mode]
    data = payload.get(key, [])
    as_on = payload.get("as_on_date", "")
    print(f"  [{mode}] {len(data)} records  (as on {as_on})")

    if pd is not None:
        return pd.DataFrame(data)
    return data


# ─── Historical Deals (mirrors nsepythonserver reference API) ─────────────────
def nse_largedeals_historical(from_date, to_date, mode="bulk_deals"):
    if mode not in HIST_MODE_MAP:
        raise ValueError(f"mode must be one of {list(HIST_MODE_MAP)}")

    api_kind = HIST_MODE_MAP[mode]
    url = f"https://www.nseindia.com/api/historical/{api_kind}?from={from_date}&to={to_date}"
    print(f"[HISTORICAL] GET {url}")

    rows = fetch_chunk(from_date, to_date, api_kind)

    if pd is not None:
        return pd.DataFrame(rows)
    return rows


if __name__ == "__main__":
    main()
