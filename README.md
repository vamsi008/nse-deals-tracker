# NSE Deals Tracker

A powerful, full-stack React and Node.js application for tracking, analyzing, and visualizing Bulk and Block deals on the National Stock Exchange (NSE). 

The tracker provides deep transparency into institutional trading behavior, breaking down aggregated bulk data into actionable Insights—like the famous "Smart Money Leaderboard" and chronological "Reversal Alerts."

---

## 📸 Application Screenshots

*(**Note:** Save your screenshots to the `src/assets/` or `public/` directory and replace the placeholders below. E.g., `![Main Dashboard](./public/dashboard.png)`)*

### 1. Main Dashboard (All Deals)
![Main Dashboard Placeholder](https://via.placeholder.com/800x400.png?text=Main+Dashboard+-+All+Deals)
*Shows the completely filterable, paginated log of historic deals along with dynamically calculated "Total Buy" and "Total Sell" metrics based on live filters.*

### 2. Smart Money Leaderboard
![Leaderboard Placeholder](https://via.placeholder.com/800x400.png?text=Smart+Money+Leaderboard)
*Tracks cumulative P&L across all traded stocks for every active institutional client.*

### 3. Top 10 Profitable Clients (Expanded Constituent Trades)
![Top 10 Expanded Placeholder](https://via.placeholder.com/800x400.png?text=Top+10+Expanded+Constituent+Trades)
*Expanding a client reveals their exact mathematical pairings of block buys and sells, isolating exact holding periods and P&L percentages chronologically.*

### 4. Reversal Alerts
![Reversal Alerts Placeholder](https://via.placeholder.com/800x400.png?text=Reversal+Alerts)
*A dedicated scanner that isolates "Buy->Sell" reversals inside defined duration windows.*

---

## ✨ Core Features
- **Dynamic Filtering Engine**: Fully interconnected filters. If you search for a client on the "All Deals" table, the Top Dashboard Summary Cards recalculate the Total Value traded natively!
- **Incremental Data Merge**: Supports incremental CSV and JSON uploads by mathematically deduplicating identical trade blocks.
- **Tree-Based Data Expansion**: Dive into any aggregate client metric to see the exact sequential "Constituent Trades" that composed it.
- **LIFO/FIFO Quantity Splitting algorithms**: Automatically splits and deducts matching trade quantities between bulk blocks organically to calculate accurate P&L.
- **Dedicated Real-time Leaderboards**.

---

## 🛠️ Tech Stack
- **Frontend**: React.js, Vite, Vanilla CSS 
- **Backend / API**: Express.js, Node.js
- **Data Extractor**: Python (`requests`, `beautifulsoup`)

---

## 🚀 Setup & Installation

### Requirements
You'll need the following installed on your machine:
- [Node.js](https://nodejs.org/en/) (v16+)
- [Python 3+](https://www.python.org/downloads/) (for the underlying scraper/merge utilities)

### 1. Clone the repository
```bash
git clone https://github.com/vamsi008/nse-deals-tracker.git
cd nse-deals-tracker
```

### 2. Install dependencies
Install the required packages for both the Vite frontend and Express backend.
```bash
npm install
```

### 3. Start the application
The project comes wired with a `concurrently` dev script. This will spin up the Express API server on `:3001` and the Vite React server on `:5173` simultaneously.
```bash
npm run dev
```

### 4. Access the tracker
Open your browser and navigate to the local Vite URL output by the terminal.
```
http://localhost:5173
```
