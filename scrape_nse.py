import time
import json
from playwright.sync_api import sync_playwright

def scrape_nse_deals():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        bulk_deals_data = None
        block_deals_data = None

        def handle_response(response):
            nonlocal bulk_deals_data, block_deals_data
            if "historical/bulk-deals" in response.url and response.status == 200:
                print("Caught bulk deals response!")
                try:
                    data = response.json()
                    bulk_deals_data = data
                except Exception as e:
                    print(f"Error parsing bulk deals: {e}")
            elif "historical/block-deals" in response.url and response.status == 200:
                print("Caught block deals response!")
                try:
                    data = response.json()
                    block_deals_data = data
                except Exception as e:
                    print(f"Error parsing block deals: {e}")

        page.on("response", handle_response)
        
        print("Navigating to NSE...")
        page.goto("https://www.nseindia.com/report-detail/display-bulk-and-block-deals")
        page.wait_for_load_state("networkidle")
        
        print("Waiting for 1Y dropdown or button...")
        try:
            # Look for a dropdown or tabs. Usually it's a dropdown with id 'dateRange' or similar, or a list of items.
            # We can also try selecting Custom dates.
            # Let's see if 1Y button exists.
            print("Clicking 1Y option if it exists.")
            # Adjust the selector based on what works on NSE
            page.click("text='1 Year'", timeout=5000)
        except Exception:
            try:
                # Perhaps it's an option in a select dropdown
                page.select_option("select", label="1 Year")
            except Exception:
                try:
                    page.click("text='1Y'", timeout=5000)
                except Exception as e:
                    print(f"Failed to click 1Y: {e}")

        # Wait to allow API requests to be captured
        time.sleep(10)
        
        if bulk_deals_data:
            with open("bulk_1y.json", "w") as f:
                json.dump(bulk_deals_data, f)
            print("Saved bulk_1y.json")
        if block_deals_data:
            with open("block_1y.json", "w") as f:
                json.dump(block_deals_data, f)
            print("Saved block_1y.json")

        browser.close()

if __name__ == "__main__":
    scrape_nse_deals()
