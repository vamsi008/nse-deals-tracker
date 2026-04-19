from nsepython import nse_largedeals_historical
from datetime import datetime, timedelta

end_date = datetime.today()
start_date = end_date - timedelta(days=30)
start_str = start_date.strftime("%d-%m-%Y")
end_str = end_date.strftime("%d-%m-%Y")

print(f"Fetching from {start_str} to {end_str}")
data_bulk = nse_largedeals_historical(start_str, end_str, "bulk-deals")
print("Response type:", type(data_bulk))
if isinstance(data_bulk, dict):
    print("Keys in response:", data_bulk.keys())
    if 'data' not in data_bulk:
        print("Full response:", data_bulk)
else:
    print("Response:", data_bulk)
