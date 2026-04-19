import datetime
import json

def fetch_data():
    try:
        from nsepython import bulk_deals, block_deals
        print("Imported nsepython functions successfully.")
    except Exception as e:
        print("Error importing:", e)
        import nsepython
        print("Functions available:", dir(nsepython))
        return

    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=30)
    
    try:
        print(f"Fetching from {start_date} to {end_date}")
        bulk_df = bulk_deals(start=start_date, end=end_date)
        block_df = block_deals(start=start_date, end=end_date)
        
        print("Bulk Deals shape:", bulk_df.shape if bulk_df is not None else "None")
        print("Block Deals shape:", block_df.shape if block_df is not None else "None")
        
        # Save exact structures for debugging
        if bulk_df is not None:
             print(bulk_df.head(2))
    except Exception as e:
        print("Error fetching:", e)

if __name__ == "__main__":
    fetch_data()
