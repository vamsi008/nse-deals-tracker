# NSE Deals Tracker - Project Documentation

## Overview
The NSE Deals Tracker is a full-stack web application designed to track, visualize, and analyze NSE (National Stock Exchange) bulk, block, and short-sell deals. The system allows users to identify "smart money" movements, view profitability leaderboards, and get alerted on reversal patterns (buy-then-sell).

## Architecture
- **Frontend**: React.js with Vite, vanilla CSS.
- **Backend**: Node.js with Express.
- **Scripts**: Python (for data extraction and processing).
- **Data Store**: Local JSON file (`public/deals.json`).

## Core Components

### 1. Backend (`server.js`)
Serves as the analytics engine and API layer.
- **Analytics Engine**:
  - `computeAlerts(deals)`: Finds buy-sell reversal patterns for clients (FIFO matching).
  - `computeLeaderboard(alerts)`: Aggregates client PnL, win rates, and holding periods.
- **Endpoints**:
  - `GET /api/dashboard`: Main endpoint serving paginated deals, summary metrics, leaderboard, and alerts. Filterable by `days`, `tab`, `filter`, `search`, and `page`.
  - `GET /api/clients`: Returns all unique clients with summary statistics (Total Trades, Buy/Sell Value, Open Positions).
  - `GET /api/client-portfolio?client=<name>`: Returns full transaction history and currently open (unsold) positions for a specific client.
  - `POST /api/refresh`: Triggers the Python script (`fetch_nse_real.py`) to fetch daily live data incrementally.
  - `POST /api/upload-csv`: Accepts manual CSV uploads and merges them using `merge_uploaded_csv.py`.

### 2. Frontend (`src/App.jsx`)
A single-page React dashboard.
- **Key States**:
  - `activeTab`: Switches between 'all', 'large', 'bulk', 'block', 'short', 'leaderboard', 'top10', 'alerts', and 'portfolio'.
  - `dayWindow`: Filters the entire dashboard data within a specific time window (30D, 60D, etc.).
- **Tabs**:
  - **Data Tables**: Paginated view of raw deals with coloring for BUY/SELL and Bulk/Block/Short tags.
  - **Alerts**: Shows buy→sell reversal patterns with exact PnL and timelines.
  - **Leaderboard / Top 10**: Ranks clients based on total realized PnL. Includes tree-like drill-down views for expanding individual symbols traded.
  - **Client Portfolio**: A two-panel view where the left panel lists all clients, and the right panel shows the selected client's detailed transactions and open (unsold) positions.

### 3. Python Scripts
- **`fetch_nse_real.py`**: Connects to NSE India APIs, fetches the latest bulk/block/short-selling deals for the current or previous day, and appends them to `public/deals.json`.
- **`merge_uploaded_csv.py`**: Allows users to upload historical NSE CSV files, parses them, and intelligently merges them with the existing `public/deals.json` avoiding duplicates.

## Data Schema (`deals.json`)
Each deal object has the following structure:
```json
{
  "id": "Symbol-Type-Date-Client-Qty", // Unique Identifier
  "date": "DD-MMM-YYYY",
  "symbol": "RELIANCE",
  "client": "GOLDMAN SACHS",
  "buy_sell": "BUY" | "SELL",
  "quantity": 1500000,
  "price": 2450.50,
  "value_cr": 367.57,
  "type": "bulk" | "block" | "short"
}
```

## Setup & Running
```bash
# Install dependencies
npm install

# Start the application (runs Express and Vite concurrently)
npm run dev
```

## Important Notes for AI Assistants
- When modifying the UI, adhere to the modern, glassmorphic dark theme defined in `src/index.css`.
- The `deals.json` file can grow very large. Do not traverse or log the entire file. Use the backend endpoints for filtering and processing.
- The `server.js` analytics functions (like `computeAlerts`) rely on chronological sorting. Be careful if changing sorting or matching algorithms (uses FIFO queue matching).
- When resolving bugs, prefer looking into `server.js` for data formatting/processing issues and `src/App.jsx` for rendering logic.
