import json
import random
from datetime import datetime, timedelta
import os

end_date = datetime.today()
start_date = end_date - timedelta(days=120)
current = start_date

deals = []
stock_symbols = ["PAYTM", "RELIANCE", "INFY", "TCS", "HDFCBANK", "ZOMATO", "SUZLON", "ADANIENT", "ITC", "SBIN"]
clients = ["MORGAN STANLEY ASIA", "SOCIETE GENERALE", "GOLDMAN SACHS", "VANGUARD", "NOMURA INDIA", "JUPITER FUND", "BLACKROCK"]

id_counter = 1

# Generate some base deals
while current <= end_date:
    # skip weekends
    if current.weekday() >= 5:
        current += timedelta(days=1)
        continue
        
    num_deals = random.randint(3, 8)
    for _ in range(num_deals):
        sym = random.choice(stock_symbols)
        client = random.choice(clients)
        action = random.choice(["BUY", "SELL"])
        
        # 10% chance of a pairing (to create reversal alerts over 30 days)
        if random.random() < 0.1:
            action = "BUY"
            # create a matched SELL 3-5 days in the future
            future_date = current + timedelta(days=random.randint(3, 5))
            if future_date <= end_date and future_date.weekday() < 5:
                deals.append({
                    "id": f"bulk_{id_counter+1000}",
                    "date": future_date.strftime("%d-%b-%Y"),
                    "symbol": sym,
                    "client": client,
                    "buy_sell": "SELL",
                    "quantity": random.randint(500000, 2000000),
                    "price": round(random.uniform(100.0, 2500.0), 2),
                    "value_cr": round(random.uniform(50.0, 300.0), 2),
                    "type": "bulk"
                })
        
        qty = random.randint(500000, 2000000)
        price = round(random.uniform(100.0, 2500.0), 2)
        val = round((qty * price) / 10000000, 2)
        
        deals.append({
            "id": f"bulk_{id_counter}",
            "date": current.strftime("%d-%b-%Y"),
            "symbol": sym,
            "client": client,
            "buy_sell": action,
            "quantity": qty,
            "price": price,
            "value_cr": val,
            "type": random.choice(["bulk", "block"])
        })
        id_counter += 1
        
    current += timedelta(days=1)

# Sort strictly by date descending
deals.sort(key=lambda x: datetime.strptime(x['date'], '%d-%b-%Y'), reverse=True)

public_dir = os.path.join(os.getcwd(), "public")
if not os.path.exists(public_dir):
    os.makedirs(public_dir)

with open(os.path.join(public_dir, "deals.json"), "w") as f:
    json.dump(deals, f, indent=4)
print(f"✅ Generated {len(deals)} mock deals across 30 days ({start_date.strftime('%d-%b-%Y')} to {end_date.strftime('%d-%b-%Y')}) to public/deals.json")
