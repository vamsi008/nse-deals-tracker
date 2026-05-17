"""
merge_uploaded_csv.py — MySQL Mode
Parses an uploaded CSV (bulk or block) and inserts new records into MySQL.
Usage: python merge_uploaded_csv.py <csv_path> <deal_type>
"""
import sys, os
from datetime import datetime

try:
    import mysql.connector
except ImportError:
    print("ERROR: mysql-connector-python not installed.")
    print("       Run: pip install mysql-connector-python")
    raise

from dotenv import dotenv_values
from init_db_from_csv import parse_csv

_env = dotenv_values(os.path.join(os.path.dirname(__file__), ".env"))

DB_CONFIG = {
    "host":     _env.get("DB_HOST",     "127.0.0.1"),
    "port":     int(_env.get("DB_PORT", "3306")),
    "user":     _env.get("DB_USER",     "nse_user"),
    "password": _env.get("DB_PASSWORD", "nse_pass"),
    "database": _env.get("DB_NAME",     "nse_deals"),
    "charset":  "utf8mb4",
}

NSE_DATE_FMT   = "%d-%m-%Y"
MYSQL_DATE_FMT = "%Y-%m-%d"


def to_mysql_date(display_date):
    """Convert DD-MM-YYYY to YYYY-MM-DD."""
    try:
        return datetime.strptime(display_date, NSE_DATE_FMT).strftime(MYSQL_DATE_FMT)
    except Exception:
        return None


def insert_deals(records):
    if not records:
        return 0
    conn = mysql.connector.connect(**DB_CONFIG)
    cur  = conn.cursor()
    sql  = """
        INSERT IGNORE INTO deals
            (deal_id, deal_date, symbol, client, buy_sell, quantity, price, value_cr, deal_type)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    rows = []
    for d in records:
        mysql_date = to_mysql_date(d.get("date", ""))
        if not mysql_date:
            continue
        rows.append((
            str(d.get("id", ""))[:64],
            mysql_date,
            str(d.get("symbol", ""))[:50],
            str(d.get("client", ""))[:399],
            d.get("buy_sell", "BUY").upper(),
            int(d.get("quantity", 0)),
            float(d.get("price", 0)),
            float(d.get("value_cr", 0)),
            d.get("type", "bulk"),
        ))
    cur.executemany(sql, rows)
    affected = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return affected


def main():
    if len(sys.argv) < 3:
        print("Usage: python merge_uploaded_csv.py <csv_path> <deal_type>")
        sys.exit(1)

    csv_path  = sys.argv[1]
    deal_type = sys.argv[2]

    print(f"Parsing uploaded CSV. Type: {deal_type}")
    new_deals = parse_csv(csv_path, deal_type)
    print(f"Parsed {len(new_deals)} records from CSV.")

    inserted = insert_deals(new_deals)
    print(f"Successfully inserted {inserted} new records into MySQL (duplicates ignored).")


if __name__ == "__main__":
    main()
