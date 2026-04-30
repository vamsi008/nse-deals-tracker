"""
Test NSE APIs using the session warm-up page from the Google snippet:
  https://www.nseindia.com/market-data/large-deals
"""
import requests, json, time

headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
    "accept": "application/json, text/plain, */*",
    "Referer": "https://www.nseindia.com/",
    "X-Requested-With": "XMLHttpRequest",
}

session = requests.Session()

print("=== Step 1: Homepage ===")
r0 = session.get("https://www.nseindia.com", headers=headers, timeout=15)
print(f"  Status: {r0.status_code}")
time.sleep(3)

print("\n=== Step 2: Warm-up via market-data/large-deals ===")
r1 = session.get("https://www.nseindia.com/market-data/large-deals", headers=headers, timeout=15)
print(f"  Status: {r1.status_code}")
print(f"  Cookies: {list(session.cookies.keys())}")
time.sleep(3)

FROM = "17-04-2026"
TO   = "30-04-2026"


def test_api(kind, label):
    url = f"https://www.nseindia.com/api/historical/{kind}?from={FROM}&to={TO}"
    print(f"\n  URL: {url}")
    resp = session.get(url, headers=headers, timeout=20)
    print(f"  HTTP Status : {resp.status_code}")
    print(f"  Size        : {len(resp.content)} bytes")
    if resp.status_code != 200:
        print(f"  FAILED — body: {resp.text[:300]}")
        return False
    try:
        data = resp.json()
    except Exception as e:
        print(f"  JSON error: {e}  raw: {resp.text[:200]}")
        return False

    records = data.get("data", data) if isinstance(data, dict) else data
    print(f"  Records     : {len(records)}")
    if records:
        first = records[0]
        print(f"  Keys        : {list(first.keys())}")
        date_val = first.get("BD_DT_DATE", "N/A")
        print(f"  First date  : {date_val}")
        sym = first.get("BD_SYMBOL", "N/A")
        client = first.get("BD_CLIENT_NAME", "N/A")
        print(f"  First row   : {sym} | {client}")
    print(f"  RESULT: {label} API --- {'WORKING' if records else 'EMPTY (no records)'}")
    return True


print("\n=== Step 3: Bulk Deals API ===")
bulk_ok = test_api("bulk-deals", "Bulk Deals")
time.sleep(3)

print("\n=== Step 4: Block Deals API ===")
block_ok = test_api("block-deals", "Block Deals")

print("\n" + "=" * 50)
print("SUMMARY")
print("=" * 50)
print(f"  Bulk Deals API  : {'WORKING' if bulk_ok  else 'BROKEN'}")
print(f"  Block Deals API : {'WORKING' if block_ok else 'BROKEN'}")
print("=" * 50)
