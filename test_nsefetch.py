from nsepython import nsefetch
import pandas as pd

# Let's test a known past date where deals would definitely exist
url = "https://www.nseindia.com/api/historical/bulk-deals?from=01-01-2024&to=05-01-2024"
payload = nsefetch(url)
print("01-01-2024 to 05-01-2024 Response:")
print(type(payload), payload.keys() if isinstance(payload, dict) else payload)

url2 = "https://www.nseindia.com/api/historical/bulk-deals?from=01-01-2025&to=05-01-2025"
payload2 = nsefetch(url2)
print("01-01-2025 to 05-01-2025 Response:")
print(type(payload2), payload2.keys() if isinstance(payload2, dict) else payload2)
