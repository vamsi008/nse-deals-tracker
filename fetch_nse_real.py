"""
NSE Bulk & Block Deals Fetcher — Incremental Mode

First run  : Fetches full 120-day history and saves to public/deals.json
Subsequent : Reads existing deals.json, finds latest date present,
             fetches only from (latest_date + 1) → today, merges & saves.

Usage:
  python fetch_nse_real.py            # incremental (default)
  python fetch_nse_real.py --full     # force full 120-day re-fetch
  python fetch_nse_real.py --days 60  # force full but only N days back
"""
import requests
import json, os, time, argparse
from datetime import datetime, timedelta

SLEEP_BETWEEN_REQUESTS = 10      # seconds between each API call
FULL_HISTORY_DAYS      = 120     # how far back for a fresh full fetch
DATA_FILE              = os.path.join(os.path.dirname(__file__), "public", "deals.json")

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer":         "https://www.nseindia.com/report-detail/display-bulk-and-block-deals",
    "X-Requested-With":"XMLHttpRequest",
    "Connection":      "keep-alive",
}

NSE_DATE_FMT = "%d-%m-%Y"


# ─── Session ──────────────────────────────────────────────────────────────────
def make_session():
    s = requests.Session()
    s.headers.update(HEADERS)
    print("[NSE] Getting homepage to establish session cookies...")
    try:
        r = s.get("https://www.nseindia.com", timeout=15)
        print(f"  Homepage: {r.status_code}")
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        s.get("https://www.nseindia.com/report-detail/display-bulk-and-block-deals", timeout=15)
        print("  Reports page loaded. Session ready.")
        time.sleep(SLEEP_BETWEEN_REQUESTS)
    except Exception as e:
        print(f"  Warning: {e}")
    return s


# ─── Fetch one date-range + deal type ─────────────────────────────────────────
def fetch_chunk(session, from_str, to_str, kind):
    url = f"https://www.nseindia.com/api/historical/{kind}?from={from_str}&to={to_str}"
    print(f"  GET {url}")
    try:
        r = session.get(url, timeout=20)
        print(f"  Status: {r.status_code}  Size: {len(r.content)} bytes")
        if r.status_code != 200:
            return []
        payload = r.json()
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
    def safe_int(v):
        try: return int(str(v).replace(",", "").strip() or 0)
        except: return 0
    def safe_float(v):
        try: return float(str(v).replace(",", "").strip() or 0)
        except: return 0.0

    qty   = safe_int(row.get("BD_QTY_TRD", 0))
    price = safe_float(row.get("BD_TP_WATP", 0))

    # Normalise date: NSE returns "DD-Mon-YYYY" e.g. "15-Apr-2025"
    raw_date = row.get("BD_DT_DATE", "")
    try:
        dt = datetime.strptime(raw_date, "%d-%b-%Y")
        norm_date = dt.strftime(NSE_DATE_FMT)
    except Exception:
        norm_date = raw_date  # keep as-is if unparseable

    return {
        "id":       row.get("_id", ""),
        "date":     norm_date,
        "symbol":   row.get("BD_SYMBOL", ""),
        "client":   row.get("BD_CLIENT_NAME", ""),
        "buy_sell": (row.get("BD_BUY_SELL") or "").strip().upper(),
        "quantity": qty,
        "price":    price,
        "value_cr": round((qty * price) / 10_000_000, 2),
        "type":     deal_type,
    }


# ─── Fetch a date range in 29-day chunks ──────────────────────────────────────
def fetch_range(session, start: datetime, end: datetime, deal_type="bulk"):
    deals = []
    chunk_days = 29
    cur = start
    api_kind = "bulk-deals" if deal_type == "bulk" else "block-deals"

    while cur <= end:
        chunk_end = min(cur + timedelta(days=chunk_days), end)
        f_str = cur.strftime(NSE_DATE_FMT)
        t_str = chunk_end.strftime(NSE_DATE_FMT)
        print(f"\n[RANGE] {deal_type.upper()} {f_str} -> {t_str}")

        rows = fetch_chunk(session, f_str, t_str, api_kind)
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
    """Returns a tuple of (latest_bulk_date, latest_block_date)."""
    l_bulk = None
    l_block = None
    for rec in records:
        raw = rec.get("date", "")
        dtype = rec.get("type", "")
        try:
            dt = datetime.strptime(raw, NSE_DATE_FMT)
            if dtype == 'bulk' and (l_bulk is None or dt > l_bulk): l_bulk = dt
            if dtype == 'block' and (l_block is None or dt > l_block): l_block = dt
        except Exception:
            pass
    return l_bulk, l_block


# ─── Merge & deduplicate ───────────────────────────────────────────────────────
def merge_deals(existing, new_deals):
    """
    Merge existing + new, deduplicate by (date, symbol, client, buy_sell, type).
    Newer records win on conflict.
    """
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
    l_bulk, l_block = latest_dates(existing) if existing else (None, None)

    if args.full or (l_bulk is None and l_block is None):
        # ── Full fetch ──
        start = today - timedelta(days=args.days)
        print(f"\n[FULL FETCH] {start.strftime(NSE_DATE_FMT)} -> {today.strftime(NSE_DATE_FMT)}  ({args.days} days)")
        session = make_session()
        new_data = fetch_range(session, start, today, "bulk")
        new_data.extend(fetch_range(session, start, today, "block"))
        merged = merge_deals(existing, new_data)
    else:
        # ── Incremental fetch ──
        session = make_session()
        new_data = []

        # Bulk
        fetch_bulk_from = (l_bulk + timedelta(days=1)) if l_bulk else (today - timedelta(days=args.days))
        if fetch_bulk_from.date() <= today.date():
            print(f"\n[INCREMENTAL BULK] {fetch_bulk_from.strftime(NSE_DATE_FMT)} -> {today.strftime(NSE_DATE_FMT)}")
            new_data.extend(fetch_range(session, fetch_bulk_from, today, "bulk"))
        else:
            print(f"\n[INFO] Bulk deals already up to date (last date: {l_bulk.strftime(NSE_DATE_FMT) if l_bulk else 'None'})")

        # Block
        fetch_block_from = (l_block + timedelta(days=1)) if l_block else (today - timedelta(days=args.days))
        if fetch_block_from.date() <= today.date():
            print(f"\n[INCREMENTAL BLOCK] {fetch_block_from.strftime(NSE_DATE_FMT)} -> {today.strftime(NSE_DATE_FMT)}")
            new_data.extend(fetch_range(session, fetch_block_from, today, "block"))
        else:
            print(f"\n[INFO] Block deals already up to date (last date: {l_block.strftime(NSE_DATE_FMT) if l_block else 'None'})")

        if not new_data:
            print("\n[INFO] Nothing to fetch.")
            save(existing)  # Update timestamp
            return

        print(f"\n  New records fetched overall: {len(new_data)}")
        merged = merge_deals(existing, new_data)

    save(merged)


if __name__ == "__main__":
    main()
