"""
test_api.py — Verify NSE deal data fetching

Tests:
  1. Live snapshot  (bulk / block / short)
  2. Historical bulk deals   via nse_largedeals_historical()
  3. Historical block deals  via nse_largedeals_historical()
  4. Historical short-selling via nse_largedeals_historical()
"""
import json, sys, os

# Allow importing from the same directory
sys.path.insert(0, os.path.dirname(__file__))
from fetch_nse_real import nse_largedeals, nse_largedeals_historical

SEP = "=" * 60

# ─────────────────────────────────────────────────────────────────────────────
# 1. LIVE SNAPSHOT
# ─────────────────────────────────────────────────────────────────────────────
for mode in ("bulk_deals", "block_deals", "short_deals"):
    print(f"\n{SEP}")
    print(f"LIVE SNAPSHOT — {mode.upper()}")
    print(SEP)
    try:
        df = nse_largedeals(mode=mode)
        if hasattr(df, "shape"):
            print(f"  Rows: {df.shape[0]}  Cols: {df.shape[1]}")
            if not df.empty:
                print(df.head(3).to_string())
        else:
            print(f"  Records: {len(df)}")
            if df:
                print(json.dumps(df[0], indent=2))
    except Exception as e:
        print(f"  ERROR: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# 2. HISTORICAL  (small date range so it's fast)
# ─────────────────────────────────────────────────────────────────────────────
FROM_DATE = "15-08-2023"
TO_DATE   = "22-08-2023"

for mode in ("bulk_deals", "block_deals", "short_deals"):
    print(f"\n{SEP}")
    print(f"HISTORICAL {mode.upper()}  ({FROM_DATE} -> {TO_DATE})")
    print(SEP)
    try:
        df = nse_largedeals_historical(FROM_DATE, TO_DATE, mode=mode)
        if hasattr(df, "shape"):
            print(f"  Rows: {df.shape[0]}  Cols: {df.shape[1]}")
            if not df.empty:
                print(df.head(3).to_string())
            else:
                print("  [EMPTY DataFrame]")
        else:
            print(f"  Records: {len(df)}")
            if df:
                print(json.dumps(df[0], indent=2))
            else:
                print("  [No records returned]")
    except Exception as e:
        print(f"  ERROR: {e}")

print(f"\n{SEP}")
print("DONE")
print(SEP)
