import express from "express";
import { spawn } from "child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;
app.use(express.text({ limit: '50mb' }));

const DATA_FILE = join(__dirname, "public", "deals.json");

let fetchRunning = false;
let fetchLog     = [];

// ─── Analytics Engine (Ported from React) ─────────────────────────────────────
function parseDate(str) {
  if (!str) return new Date(0);
  const parts = str.split("-");
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    let monthIdx;
    if (isNaN(parseInt(parts[1], 10))) {
      const ms = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      monthIdx = ms[parts[1].toLowerCase().substring(0,3)];
    } else {
      monthIdx = parseInt(parts[1], 10) - 1;
    }
    const year = parseInt(parts[2], 10);
    if (!isNaN(day) && monthIdx !== undefined && !isNaN(year)) {
      return new Date(year, monthIdx, day);
    }
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function computeAlerts(deals) {
  const alerts = [];
  const buys = {};

  const sorted = [...deals].sort(
    (a, b) => parseDate(a.date) - parseDate(b.date)
  );

  for (const deal of sorted) {
    const key = `${deal.client}||${deal.symbol}`;
    if (deal.buy_sell === "BUY") {
      buys[key] = buys[key] || [];
      buys[key].push({ ...deal });
    } else if (deal.buy_sell === "SELL" && buys[key]?.length > 0) {
      let remainingSell = deal.quantity;

      while (remainingSell > 0 && buys[key].length > 0) {
        const prevBuys = buys[key];
        const latestBuy = prevBuys[prevBuys.length - 1];
        const buyDate = parseDate(latestBuy.date);
        const sellDate = parseDate(deal.date);
        const diffDays = Math.round((sellDate - buyDate) / (1000 * 60 * 60 * 24));

        const tradedQty = Math.min(remainingSell, latestBuy.quantity);
        const pnlRs = (deal.price - latestBuy.price) * tradedQty;
        const pnlCr = pnlRs / 10000000;
        const pnlPct = latestBuy.price > 0 ? ((deal.price - latestBuy.price) / latestBuy.price) * 100 : 0;

        alerts.push({
          client: deal.client,
          symbol: deal.symbol,
          prevAction: "BUY",
          prevDate: latestBuy.date,
          prevQty: latestBuy.quantity,
          prevPrice: latestBuy.price,
          currentDate: deal.date,
          currentQty: deal.quantity,
          currentPrice: deal.price,
          diffDays,
          pnlCr,
          pnlPct,
          tradedQty,
          alert_msg: `${deal.client} bought ${latestBuy.quantity.toLocaleString('en-IN')} shares on ${latestBuy.date}, now selling ${deal.quantity.toLocaleString('en-IN')} shares ${diffDays} day${diffDays !== 1 ? "s" : ""} later.`,
        });

        latestBuy.quantity -= tradedQty;
        remainingSell -= tradedQty;

        if (latestBuy.quantity <= 0) {
          prevBuys.pop();
        }
      }
    }
  }
  alerts.sort((a, b) => parseDate(b.currentDate) - parseDate(a.currentDate));
  return alerts;
}

function computeLeaderboard(alerts) {
  const map = {};
  for (const a of alerts) {
    if (!map[a.client]) {
      map[a.client] = { client: a.client, totalPnlCr: 0, wins: 0, losses: 0, trades: 0, symbols: new Set(), minDays: a.diffDays, maxDays: a.diffDays, alerts: [] };
    }
    map[a.client].totalPnlCr += a.pnlCr;
    map[a.client].trades += 1;
    map[a.client].symbols.add(a.symbol);
    map[a.client].alerts.push(a);
    if (a.pnlCr >= 0) map[a.client].wins += 1;
    else map[a.client].losses += 1;
    if (a.diffDays < map[a.client].minDays) map[a.client].minDays = a.diffDays;
    if (a.diffDays > map[a.client].maxDays) map[a.client].maxDays = a.diffDays;
    if (!map[a.client].symbolPnLs) map[a.client].symbolPnLs = {};
    if (!map[a.client].symbolPnLs[a.symbol]) map[a.client].symbolPnLs[a.symbol] = 0;
    map[a.client].symbolPnLs[a.symbol] += a.pnlCr;
  }
  
  return Object.values(map)
    .map(c => {
      const sortedSymbols = Object.keys(c.symbolPnLs || {})
        .map(sym => ({ symbol: sym, pnlCr: c.symbolPnLs[sym] }))
        .sort((x, y) => Math.abs(y.pnlCr) - Math.abs(x.pnlCr));
      
      return {
        ...c,
        sortedSymbols,
        symbols: [...c.symbols],
        winRate: c.trades > 0 ? (c.wins / c.trades) * 100 : 0,
        holdingInterval: c.minDays === c.maxDays ? `${c.minDays}d` : `${c.minDays}-${c.maxDays}d`,
        alerts: c.alerts.sort((x, y) => parseDate(y.currentDate) - parseDate(x.currentDate))
      };
    })
    .sort((a, b) => b.totalPnlCr - a.totalPnlCr); // Default sort desc
}

// ─── Caching Layer ────────────────────────────────────────────────────────────
let memDeals = null;
let allAlertsCache = null;

function loadDeals() {
  if (memDeals) return memDeals;
  if (!existsSync(DATA_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
    const sorted = raw.sort((a, b) => parseDate(b.date) - parseDate(a.date));
    memDeals = sorted;
    allAlertsCache = computeAlerts(sorted);
    return memDeals;
  } catch {
    return [];
  }
}

function invalidateCache() {
  memDeals = null;
  allAlertsCache = null;
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get("/api/status", (_req, res) => {
  res.json({ running: fetchRunning, log: fetchLog.slice(-50) });
});

app.get("/api/dashboard", (req, res) => {
  const allDeals = loadDeals();
  if (allDeals.length === 0) return res.json({ error: "No data available" });

  const dayWindow = parseInt(req.query.days || "30", 10);
  const activeTab = req.query.tab || "all";
  const filterBuySell = req.query.filter || "ALL"; // BUY, SELL, ALL
  const search = (req.query.search || "").trim().toLowerCase();
  const page = parseInt(req.query.page || "1", 10);
  const limit = parseInt(req.query.limit || "200", 10);

  // 1. Calculate windowCutoff relative to max date in DB
  const timestamps = allDeals.map(d => parseDate(d.date).getTime()).filter(t => !isNaN(t));
  const maxDate = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date();
  maxDate.setDate(maxDate.getDate() - dayWindow);
  
  // 2. Filter base deals to window
  const windowDeals = allDeals.filter(d => parseDate(d.date) >= maxDate);
  
  // 3. Compute Summary Counts
  const bulkDeals = windowDeals.filter(d => d.type === "bulk");
  const blockDeals = windowDeals.filter(d => d.type === "block");
  const shortDeals = windowDeals.filter(d => d.type === "short");
  
  // Alerts in window
  const windowAlerts = (allAlertsCache || []).filter(a => parseDate(a.currentDate) >= maxDate);
  
  // 4. Compute Totals based on current 'filter' (BUY/SELL/ALL)
  let totalsDeals = windowDeals;
  if (filterBuySell !== "ALL") {
    totalsDeals = totalsDeals.filter(d => d.buy_sell === filterBuySell);
  }
  const totalBuyValue = totalsDeals.filter(d => d.buy_sell === "BUY").reduce((s, d) => s + (d.value_cr || 0), 0);
  const totalSellValue = totalsDeals.filter(d => d.buy_sell === "SELL").reduce((s, d) => s + (d.value_cr || 0), 0);
  
  // 5. Select Tab Data
  let tabDeals = windowDeals;
  if (activeTab === "bulk") tabDeals = bulkDeals;
  if (activeTab === "block") tabDeals = blockDeals;
  if (activeTab === "short") tabDeals = shortDeals;
  if (activeTab === "large") tabDeals = windowDeals.filter(d => d.type === "bulk" || d.type === "block");
  
  // 6. Apply search & filter to Table Data
  let tableDeals = tabDeals;
  if (filterBuySell !== "ALL") tableDeals = tableDeals.filter(d => d.buy_sell === filterBuySell);
  if (search) {
    tableDeals = tableDeals.filter(d => 
      (d.symbol || "").toLowerCase().includes(search) ||
      (d.client || "").toLowerCase().includes(search)
    );
  }
  // ColFilters can be passed as JSON if needed, but omitted for brevity (frontend can do it or pass it)
  // For simplicity, let's assume search handles general queries.
  
  // 7. Paginate
  const totalItems = tableDeals.length;
  const paginatedDeals = tableDeals.slice((page - 1) * limit, page * limit);
  
  // 8. Leaderboard
  const leaderboardType = req.query.leaderboardType || "all";
  let targetDealsForAlerts = allDeals;
  if (leaderboardType !== "all") {
    targetDealsForAlerts = allDeals.filter(d => d.type === leaderboardType);
  }
  const typedAlerts = computeAlerts(targetDealsForAlerts);
  const typedWindowAlerts = typedAlerts.filter(a => parseDate(a.currentDate) >= maxDate);
  const fullLeaderboard = computeLeaderboard(typedWindowAlerts);
  
  // Return everything
  res.json({
    summary: {
      bulk: bulkDeals.length,
      block: blockDeals.length,
      short: shortDeals.length,
      totalBuyValue,
      totalSellValue,
      alertsCount: windowAlerts.length,
      latestDbDate: maxDate // Just for debugging, not actual latest
    },
    table: {
      data: paginatedDeals,
      totalItems,
      page,
      limit
    },
    alerts: windowAlerts,
    leaderboard: fullLeaderboard,
    allDatesLength: new Set(windowDeals.map(d => d.date)).size,
    totalRawDeals: allDeals.length
  });
});

/** GET /api/deals — serve current deals.json (fallback for old compatibility) */
app.get("/api/deals", (_req, res) => {
  res.json(loadDeals());
});

app.post("/api/refresh", (_req, res) => {
  if (fetchRunning) return res.status(409).json({ error: "Fetch already in progress", running: true });
  fetchRunning = true;
  fetchLog = [];

  const pythonExe = existsSync(join(__dirname, "venv", "Scripts", "python.exe"))
    ? join(__dirname, "venv", "Scripts", "python.exe")
    : "python";
  const script = join(__dirname, "fetch_nse_real.py");

  const child = spawn(pythonExe, [script], { cwd: __dirname });
  child.stdout.on("data", (d) => { fetchLog.push(d.toString().trim()); });
  child.stderr.on("data", (d) => { fetchLog.push("ERR: " + d.toString().trim()); });
  child.on("close", (code) => {
    fetchRunning = false;
    invalidateCache(); // Reload json on next request!
  });
  res.json({ started: true, message: "Incremental fetch started." });
});

app.post("/api/upload-csv", (req, res) => {
  const type = req.query.type || "bulk";
  if (!req.body || typeof req.body !== 'string') return res.status(400).json({ error: "Missing CSV body" });
  
  const tmpPath = join(__dirname, `tmp_${Date.now()}.csv`);
  try {
    writeFileSync(tmpPath, req.body);
    const pythonExe = existsSync(join(__dirname, "venv", "Scripts", "python.exe"))
      ? join(__dirname, "venv", "Scripts", "python.exe")
      : "python";
    const child = spawn(pythonExe, [join(__dirname, "merge_uploaded_csv.py"), tmpPath, type], { cwd: __dirname });
    child.on("close", (code) => {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
      if (code === 0) invalidateCache();
      res.json({ success: code === 0 });
    });
  } catch (err) {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 NSE backend running on http://localhost:${PORT}`);
  console.log(`   GET  /api/dashboard → Supercharged API-driven analytics`);
});
