import express from "express";
import { spawn } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import 'dotenv/config';
import pool from "./db/pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;
app.use(express.text({ limit: '50mb' }));

let fetchRunning = false;
let fetchLog = [];

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Parse DD-MM-YYYY or DD-Mon-YYYY string → JS Date */
function parseDate(str) {
  if (!str) return new Date(0);
  const parts = str.split("-");
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    let monthIdx;
    if (isNaN(parseInt(parts[1], 10))) {
      const ms = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
      monthIdx = ms[parts[1].toLowerCase().substring(0, 3)];
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

/** MySQL DATE string 'YYYY-MM-DD' → 'DD-MM-YYYY' display format */
function toDisplayDate(mysqlDate) {
  if (!mysqlDate) return '';
  const [y, m, d] = mysqlDate.split('-');
  return `${d}-${m}-${y}`;
}

/** JS Date → 'YYYY-MM-DD' for MySQL queries */
function toMysqlDate(jsDate) {
  const y = jsDate.getFullYear();
  const m = String(jsDate.getMonth() + 1).padStart(2, '0');
  const d = String(jsDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Normalise a MySQL row back to the old JSON shape the frontend expects */
function normaliseRow(row) {
  return {
    id:       row.deal_id || '',
    date:     toDisplayDate(row.deal_date),
    symbol:   row.symbol,
    client:   row.client,
    buy_sell: row.buy_sell,
    quantity: Number(row.quantity),
    price:    Number(row.price),
    value_cr: Number(row.value_cr),
    type:     row.deal_type,
  };
}

// ─── Analytics Engine (kept in JS — needs cross-row FIFO/scoring logic) ──────

function computeAlerts(deals) {
  const alerts = [];
  const buys = {};
  const sorted = [...deals].sort((a, b) => parseDate(a.date) - parseDate(b.date));

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
        const diffDays = Math.round(
          (parseDate(deal.date) - parseDate(latestBuy.date)) / (1000 * 60 * 60 * 24)
        );
        const tradedQty = Math.min(remainingSell, latestBuy.quantity);
        const pnlRs  = (deal.price - latestBuy.price) * tradedQty;
        const pnlCr  = pnlRs / 10000000;
        const pnlPct = latestBuy.price > 0
          ? ((deal.price - latestBuy.price) / latestBuy.price) * 100 : 0;

        alerts.push({
          client: deal.client, symbol: deal.symbol,
          prevAction: "BUY", prevDate: latestBuy.date,
          prevQty: latestBuy.quantity, prevPrice: latestBuy.price,
          currentDate: deal.date, currentQty: deal.quantity, currentPrice: deal.price,
          diffDays, pnlCr, pnlPct, tradedQty,
          alert_msg: `${deal.client} bought ${latestBuy.quantity.toLocaleString('en-IN')} shares on ${latestBuy.date}, now selling ${deal.quantity.toLocaleString('en-IN')} shares ${diffDays} day${diffDays !== 1 ? "s" : ""} later.`,
        });

        latestBuy.quantity -= tradedQty;
        remainingSell -= tradedQty;
        if (latestBuy.quantity <= 0) prevBuys.pop();
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
      map[a.client] = { client: a.client, totalPnlCr: 0, wins: 0, losses: 0, trades: 0,
        symbols: new Set(), minDays: a.diffDays, maxDays: a.diffDays, alerts: [], symbolPnLs: {} };
    }
    const c = map[a.client];
    c.totalPnlCr += a.pnlCr;
    c.trades++;
    c.symbols.add(a.symbol);
    c.alerts.push(a);
    if (a.pnlCr >= 0) c.wins++; else c.losses++;
    if (a.diffDays < c.minDays) c.minDays = a.diffDays;
    if (a.diffDays > c.maxDays) c.maxDays = a.diffDays;
    c.symbolPnLs[a.symbol] = (c.symbolPnLs[a.symbol] || 0) + a.pnlCr;
  }
  return Object.values(map).map(c => {
    const sortedSymbols = Object.entries(c.symbolPnLs)
      .map(([sym, pnlCr]) => ({ symbol: sym, pnlCr }))
      .sort((x, y) => Math.abs(y.pnlCr) - Math.abs(x.pnlCr));
    return {
      ...c, sortedSymbols,
      symbols: [...c.symbols],
      winRate: c.trades > 0 ? (c.wins / c.trades) * 100 : 0,
      holdingInterval: c.minDays === c.maxDays ? `${c.minDays}d` : `${c.minDays}-${c.maxDays}d`,
      alerts: c.alerts.sort((x, y) => parseDate(y.currentDate) - parseDate(x.currentDate)),
    };
  }).sort((a, b) => b.totalPnlCr - a.totalPnlCr);
}

function computeConviction(transactions) {
  const STRATEGIC_CLIENTS = [
    "SBI MUTUAL FUND","HDFC MF","ICICI PRUDENTIAL","AXIS MF",
    "KOTAK MUTUAL FUND","NIPPON INDIA","UTI MF","ADITYA BIRLA SUN LIFE",
    "SOCIETE GENERALE","GOLDMAN SACHS","MORGAN STANLEY","BNP PARIBAS"
  ];
  const HFT_CLIENTS = ["GRAVITON","HRTI","NK SECURITIES","QE SECURITIES","MICROCURVES","TOWER RESEARCH"];

  const symbolMap = {};
  for (const tx of transactions) {
    const sym = tx.symbol;
    if (!symbolMap[sym]) {
      symbolMap[sym] = {
        symbol: sym, blockValueSum: 0, blockQtySum: 0, convictionScore: 0,
        strategicBuyers: new Set(), hftBuyQty: 0, hftSellQty: 0,
        totalBuyQty: 0, totalSellQty: 0, lastPrice: tx.price,
        dualWindowTrack: {}, scriptTransactions: [], dualWindowClients: new Set(),
      };
    }
    const entry = symbolMap[sym];
    const val = Number(tx.value_cr || 0);
    const qty = Number(tx.quantity || 0);
    const client = (tx.client || "").toUpperCase();

    entry.scriptTransactions.push(tx);
    if (tx.buy_sell === "BUY") entry.totalBuyQty += qty;
    else entry.totalSellQty += qty;

    if (tx.type === "block") { entry.blockValueSum += val; entry.blockQtySum += qty; }

    const isHFT = HFT_CLIENTS.some(h => client.includes(h));
    const isStrategic = STRATEGIC_CLIENTS.some(s => client.includes(s));
    if (isHFT) { if (tx.buy_sell === "BUY") entry.hftBuyQty += qty; else entry.hftSellQty += qty; }
    if (isStrategic && tx.buy_sell === "BUY" && !entry.strategicBuyers.has(tx.client)) {
      entry.strategicBuyers.add(tx.client);
      entry.convictionScore += 2;
    }
    if (!entry.dualWindowTrack[tx.client]) entry.dualWindowTrack[tx.client] = new Set();
    entry.dualWindowTrack[tx.client].add(tx.type);
  }

  const results = Object.values(symbolMap).map(m => {
    let dualPoints = 0;
    Object.entries(m.dualWindowTrack).forEach(([client, types]) => {
      if (types.has('bulk') && types.has('block')) { dualPoints += 3; m.dualWindowClients.add(client); }
    });
    const finalScore = Math.min(10, m.convictionScore + dualPoints);
    const floor = m.blockQtySum > 0 ? (m.blockValueSum * 10000000) / m.blockQtySum : null;
    const pctFromFloor = (floor && m.lastPrice) ? ((m.lastPrice - floor) / floor) * 100 : null;

    const reasons = [];
    if (m.strategicBuyers.size > 0) reasons.push(`${m.strategicBuyers.size} Strategic Buyer(s) (MF/FII) entered.`);
    if (m.dualWindowClients.size > 0) reasons.push(`Dual-Window (Bulk+Block) accumulation by ${m.dualWindowClients.size} client(s).`);
    if (floor) {
      if (pctFromFloor < 0) reasons.push(`Trading BELOW institutional floor (₹${floor.toFixed(2)}).`);
      else if (pctFromFloor < 2) reasons.push(`Trading NEAR institutional floor (support zone).`);
      else reasons.push(`Strong price support at institutional floor (₹${floor.toFixed(2)}).`);
    }
    const hftRatio = m.totalBuyQty > 0 ? (m.hftBuyQty / m.totalBuyQty) : 0;
    if (hftRatio > 0.6) reasons.push("High HFT noise detected (churn > 60%).");
    if (finalScore < 3 && reasons.length === 0) reasons.push("Lacks significant institutional support or block deal volume.");

    return {
      symbol: m.symbol, score: finalScore, floor, pctFromFloor,
      strategicBuyers: Array.from(m.strategicBuyers), lastPrice: m.lastPrice,
      reasoning: reasons.join(" "),
      txns: m.scriptTransactions.sort((a, b) => parseDate(b.date) - parseDate(a.date)).slice(0, 50),
    };
  });
  return results.sort((a, b) => b.score - a.score);
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get("/api/status", (_req, res) => {
  res.json({ running: fetchRunning, log: fetchLog.slice(-50) });
});

// ── Dashboard ──────────────────────────────────────────────────────────────────
app.get("/api/dashboard", async (req, res) => {
  try {
    const dayWindow      = parseInt(req.query.days   || "30",  10);
    const activeTab      = req.query.tab    || "all";
    const filterBuySell  = (req.query.filter || "ALL").toUpperCase();
    const search         = (req.query.search || "").trim();
    const page           = parseInt(req.query.page  || "1",   10);
    const limit          = parseInt(req.query.limit || "200", 10);
    const leaderboardType = req.query.leaderboardType || "all";

    // 1. Latest date in DB
    const [[latestRow]] = await pool.query(
      "SELECT MAX(deal_date) AS latest FROM deals"
    );
    const latestDbDate = latestRow.latest;
    if (!latestDbDate) return res.json({ error: "No data available" });

    const latestJs  = new Date(latestDbDate);
    const cutoffJs  = new Date(latestJs);
    cutoffJs.setDate(cutoffJs.getDate() - dayWindow);
    const cutoffStr = toMysqlDate(cutoffJs);

    // 2. Summary counts (all window deals — fast aggregation in SQL)
    const [summaryRows] = await pool.query(
      `SELECT deal_type, buy_sell, COUNT(*) AS cnt, SUM(value_cr) AS total_val
       FROM deals
       WHERE deal_date >= ?
       GROUP BY deal_type, buy_sell`,
      [cutoffStr]
    );

    let bulk = 0, block = 0, short = 0, totalBuyValue = 0, totalSellValue = 0;
    for (const r of summaryRows) {
      if (r.deal_type === 'bulk')  bulk  += Number(r.cnt);
      if (r.deal_type === 'block') block += Number(r.cnt);
      if (r.deal_type === 'short') short += Number(r.cnt);
      if (r.buy_sell === 'BUY')  totalBuyValue  += Number(r.total_val);
      if (r.buy_sell === 'SELL') totalSellValue += Number(r.total_val);
    }

    // 3. Table data — filtered + paginated
    //    Always exclude aggregate short-sell rows (no client, zero price) — NSE snapshot artifacts
    let tableWhere = "deal_date >= ? AND NOT (deal_type = 'short' AND client = '' AND price = 0)";
    const tableParams = [cutoffStr];

    if (activeTab === 'bulk')  { tableWhere += " AND deal_type = 'bulk'"; }
    if (activeTab === 'block') { tableWhere += " AND deal_type = 'block'"; }
    if (activeTab === 'short') { tableWhere += " AND deal_type = 'short'"; }
    if (activeTab === 'large') { tableWhere += " AND deal_type IN ('bulk','block')"; }
    if (filterBuySell !== 'ALL') { tableWhere += " AND buy_sell = ?"; tableParams.push(filterBuySell); }
    if (search) {
      tableWhere += " AND (symbol LIKE ? OR client LIKE ?)";
      tableParams.push(`%${search}%`, `%${search}%`);
    }

    const [[{ totalItems }]] = await pool.query(
      `SELECT COUNT(*) AS totalItems FROM deals WHERE ${tableWhere}`,
      tableParams
    );

    const offset = (page - 1) * limit;
    const [tableRows] = await pool.query(
      `SELECT * FROM deals WHERE ${tableWhere}
       ORDER BY deal_date DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...tableParams, limit, offset]
    );
    const tableData = tableRows.map(normaliseRow);

    // 4. Window deals for JS analytics (alerts, leaderboard, conviction)
    let analyticsWhere = "deal_date >= ?";
    const analyticsParams = [cutoffStr];
    if (leaderboardType !== 'all') {
      analyticsWhere += " AND deal_type = ?";
      analyticsParams.push(leaderboardType);
    }
    const [windowRows] = await pool.query(
      `SELECT * FROM deals WHERE ${analyticsWhere}
       ORDER BY deal_date ASC, FIELD(buy_sell,'BUY','SELL'), id ASC`,
      analyticsParams
    );
    const windowDeals = windowRows.map(normaliseRow);

    // Also fetch all deals for alert computation (to catch older matching buys)
    let allWhere = "1=1";
    const allParams = [];
    if (leaderboardType !== 'all') { allWhere = "deal_type = ?"; allParams.push(leaderboardType); }
    const [allRows] = await pool.query(
      `SELECT * FROM deals WHERE ${allWhere} ORDER BY deal_date ASC, FIELD(buy_sell,'BUY','SELL'), id ASC`,
      allParams
    );
    const allDeals = allRows.map(normaliseRow);

    const allAlerts     = computeAlerts(allDeals);
    const windowAlerts  = allAlerts.filter(a => parseDate(a.currentDate) >= cutoffJs);
    const leaderboard   = computeLeaderboard(windowAlerts);

    // 5. Window deals (all types) for conviction
    const [convRows] = await pool.query(
      `SELECT * FROM deals WHERE deal_date >= ?
       ORDER BY deal_date ASC, FIELD(buy_sell,'BUY','SELL'), id ASC`,
      [cutoffStr]
    );
    const convDeals = convRows.map(normaliseRow);
    const conviction = computeConviction(convDeals);

    // 6. Distinct dates count
    const [[{ dateCnt }]] = await pool.query(
      "SELECT COUNT(DISTINCT deal_date) AS dateCnt FROM deals WHERE deal_date >= ?",
      [cutoffStr]
    );

    res.json({
      summary: {
        bulk, block, short, totalBuyValue, totalSellValue,
        alertsCount: windowAlerts.length,
        latestDbDate,
      },
      table: { data: tableData, totalItems: Number(totalItems), page, limit },
      alerts: windowAlerts,
      leaderboard,
      conviction,
      allDatesLength: Number(dateCnt),
    });
  } catch (err) {
    console.error("/api/dashboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── All deals (legacy compat) ──────────────────────────────────────────────────
app.get("/api/deals", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM deals ORDER BY deal_date DESC");
    res.json(rows.map(normaliseRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Refresh (fetch from NSE via Python, writes directly to MySQL) ──────────────
app.post("/api/refresh", (_req, res) => {
  if (fetchRunning) return res.status(409).json({ error: "Fetch already in progress", running: true });
  fetchRunning = true;
  fetchLog = [];

  const pythonExe = existsSync(join(__dirname, "venv", "Scripts", "python.exe"))
    ? join(__dirname, "venv", "Scripts", "python.exe")
    : "python";
  const script = join(__dirname, "fetch_nse_real.py");

  const child = spawn(pythonExe, [script], { cwd: __dirname });
  child.stdout.on("data", d => { fetchLog.push(d.toString().trim()); });
  child.stderr.on("data", d => { fetchLog.push("ERR: " + d.toString().trim()); });
  child.on("close", () => { fetchRunning = false; });
  res.json({ started: true, message: "Incremental fetch started." });
});

// ── Upload CSV (merge into MySQL directly) ─────────────────────────────────────
app.post("/api/upload-csv", (req, res) => {
  const type = req.query.type || "bulk";
  if (!req.body || typeof req.body !== 'string')
    return res.status(400).json({ error: "Missing CSV body" });

  const tmpPath = join(__dirname, `tmp_${Date.now()}.csv`);
  try {
    writeFileSync(tmpPath, req.body);
    const pythonExe = existsSync(join(__dirname, "venv", "Scripts", "python.exe"))
      ? join(__dirname, "venv", "Scripts", "python.exe")
      : "python";
    const child = spawn(pythonExe, [join(__dirname, "merge_uploaded_csv.py"), tmpPath, type], { cwd: __dirname });
    child.on("close", code => {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
      res.json({ success: code === 0 });
    });
  } catch (err) {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    res.status(500).json({ error: err.message });
  }
});

// ── Clients list ───────────────────────────────────────────────────────────────
app.get("/api/clients", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    let where = "1=1";
    const params = [];
    if (q) { where = "client LIKE ?"; params.push(`%${q}%`); }

    const [rows] = await pool.query(
      `SELECT
         client,
         COUNT(*) AS totalTxns,
         SUM(CASE WHEN buy_sell='BUY'  THEN value_cr ELSE 0 END) AS totalBuyCr,
         SUM(CASE WHEN buy_sell='SELL' THEN value_cr ELSE 0 END) AS totalSellCr,
         COUNT(DISTINCT symbol) AS uniqueSymbols
       FROM deals
       WHERE ${where}
       GROUP BY client
       ORDER BY totalBuyCr DESC
       LIMIT 500`,
      params
    );

    // Compute open positions count per client (FIFO — needs JS)
    const clients = [];
    for (const r of rows) {
      const [txns] = await pool.query(
        `SELECT buy_sell, symbol, quantity FROM deals
         WHERE client = ?
         ORDER BY deal_date ASC, FIELD(buy_sell,'BUY','SELL'), id ASC`,
        [r.client]
      );

      const queues = {};
      let openCount = 0;
      for (const d of txns) {
        const sym = d.symbol;
        if (!queues[sym]) queues[sym] = [];
        if (d.buy_sell === "BUY") {
          queues[sym].push({ remaining: Number(d.quantity) });
        } else {
          let rem = Number(d.quantity);
          while (rem > 0 && queues[sym].length > 0) {
            const oldest = queues[sym][0];
            const matched = Math.min(rem, oldest.remaining);
            oldest.remaining -= matched;
            rem -= matched;
            if (oldest.remaining <= 0) queues[sym].shift();
          }
        }
      }
      const MIN_OPEN_SHARES = 100; // NSE data artifacts rarely exceed this on same-day round-trips
      for (const lots of Object.values(queues)) {
        openCount += lots.filter(l => l.remaining >= MIN_OPEN_SHARES).length;
      }

      clients.push({
        client:            r.client,
        totalTxns:         Number(r.totalTxns),
        totalBuyCr:        Number(r.totalBuyCr),
        totalSellCr:       Number(r.totalSellCr),
        uniqueSymbols:     Number(r.uniqueSymbols),
        openPositionsCount: openCount,
      });
    }

    res.json(clients);
  } catch (err) {
    console.error("/api/clients error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Client search autocomplete ─────────────────────────────────────────────────
app.get("/api/client-search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q || q.length < 2) return res.json([]);
  try {
    const [rows] = await pool.query(
      "SELECT DISTINCT client FROM deals WHERE client LIKE ? LIMIT 15",
      [`%${q}%`]
    );
    res.json(rows.map(r => r.client));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Client portfolio ───────────────────────────────────────────────────────────
app.get("/api/client-portfolio", async (req, res) => {
  const clientName = (req.query.client || "").trim();
  if (!clientName) return res.json({ error: "client param required" });

  try {
    const [rows] = await pool.query(
      `SELECT * FROM deals
       WHERE client = ?
       ORDER BY deal_date ASC, FIELD(buy_sell,'BUY','SELL'), id ASC`,
      [clientName]
    );

    if (rows.length === 0)
      return res.json({ client: clientName, transactions: [], openPositions: [], summary: {} });

    const transactions = rows.map(normaliseRow);

    // FIFO open positions
    const queues = {};
    const openPositions = [];
    for (const deal of transactions) {
      const sym = deal.symbol;
      if (!queues[sym]) queues[sym] = [];
      if (deal.buy_sell === "BUY") {
        queues[sym].push({ date: deal.date, qty: deal.quantity, price: deal.price, type: deal.type, remaining: deal.quantity });
      } else {
        let rem = deal.quantity;
        while (rem > 0 && queues[sym].length > 0) {
          const oldest = queues[sym][0];
          const matched = Math.min(rem, oldest.remaining);
          oldest.remaining -= matched;
          rem -= matched;
          if (oldest.remaining <= 0) queues[sym].shift();
        }
      }
    }
    const MIN_OPEN_VALUE_CR = 0.0000001; // ₹1 minimum — filters NSE data micro-residuals
    for (const [symbol, lots] of Object.entries(queues)) {
      for (const lot of lots) {
        const valueAtCost = (lot.remaining * lot.price) / 10000000;
        if (lot.remaining > 0 && valueAtCost >= MIN_OPEN_VALUE_CR) {
          openPositions.push({
            symbol, buyDate: lot.date, buyPrice: lot.price,
            openQty: lot.remaining, type: lot.type,
            valueAtCost,
          });
        }
      }
    }
    openPositions.sort((a, b) => parseDate(b.buyDate) - parseDate(a.buyDate));

    // Aggregate open lots by symbol for the holdings overview table
    const bySymbol = {};
    for (const pos of openPositions) {
      if (!bySymbol[pos.symbol]) {
        bySymbol[pos.symbol] = {
          symbol: pos.symbol,
          type: pos.type,
          totalOpenQty: 0,
          weightedPriceSum: 0,
          valueAtCost: 0,
          heldSince: pos.buyDate,
        };
      }
      const s = bySymbol[pos.symbol];
      s.totalOpenQty     += pos.openQty;
      s.weightedPriceSum += pos.openQty * pos.buyPrice;
      s.valueAtCost      += pos.valueAtCost;
      if (parseDate(pos.buyDate) < parseDate(s.heldSince)) s.heldSince = pos.buyDate;
    }
    const openPositionsBySymbol = Object.values(bySymbol)
      .map(s => ({
        symbol:       s.symbol,
        type:         s.type,
        totalOpenQty: s.totalOpenQty,
        avgBuyPrice:  s.totalOpenQty > 0 ? s.weightedPriceSum / s.totalOpenQty : 0,
        valueAtCost:  s.valueAtCost,
        heldSince:    s.heldSince,
      }))
      .sort((a, b) => b.valueAtCost - a.valueAtCost);

    const totalBuyCr  = transactions.filter(d => d.buy_sell === "BUY") .reduce((s, d) => s + (d.value_cr || 0), 0);
    const totalSellCr = transactions.filter(d => d.buy_sell === "SELL").reduce((s, d) => s + (d.value_cr || 0), 0);
    const uniqueSymbols = [...new Set(transactions.map(d => d.symbol))];

    res.json({
      client: clientName,
      transactions: [...transactions].reverse(),
      openPositions,
      openPositionsBySymbol,
      summary: {
        totalTxns: transactions.length,
        totalBuyCr, totalSellCr,
        openPositionsCount: openPositionsBySymbol.length,
        uniqueSymbols: uniqueSymbols.length,
        openValueCr: openPositions.reduce((s, p) => s + p.valueAtCost, 0),
      },
    });
  } catch (err) {
    console.error("/api/client-portfolio error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Symbol search autocomplete ────────────────────────────────────────────────
app.get("/api/symbol-search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q || q.length < 1) return res.json([]);
  try {
    const [rows] = await pool.query(
      `SELECT symbol, COUNT(*) AS txns
       FROM deals
       WHERE symbol LIKE ? AND NOT (deal_type = 'short' AND client = '' AND price = 0)
       GROUP BY symbol
       ORDER BY CASE WHEN symbol = ? THEN 0 WHEN symbol LIKE ? THEN 1 ELSE 2 END, txns DESC
       LIMIT 15`,
      [`%${q}%`, q.toUpperCase(), `${q}%`]
    );
    res.json(rows.map(r => ({ symbol: r.symbol, txns: Number(r.txns) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Script Portfolio (open positions by client for a symbol) ──────────────────
app.get("/api/script-portfolio", async (req, res) => {
  const symbol = (req.query.symbol || "").trim().toUpperCase();
  if (!symbol) return res.json({ error: "symbol param required" });

  try {
    // Get all deals for this symbol, ordered for FIFO matching
    const [rows] = await pool.query(
      `SELECT * FROM deals
       WHERE symbol = ? AND NOT (deal_type = 'short' AND client = '' AND price = 0)
       ORDER BY deal_date ASC, FIELD(buy_sell,'BUY','SELL'), id ASC`,
      [symbol]
    );

    if (rows.length === 0)
      return res.json({ symbol, clients: [], transactions: [], summary: {} });

    const transactions = rows.map(normaliseRow);

    // Group transactions by client
    const clientTxns = {};
    for (const tx of transactions) {
      if (!clientTxns[tx.client]) clientTxns[tx.client] = [];
      clientTxns[tx.client].push(tx);
    }

    // FIFO per client to compute open positions
    const MIN_OPEN_SHARES = 100;
    const clientsWithPositions = [];

    for (const [client, txns] of Object.entries(clientTxns)) {
      const queue = []; // FIFO buy queue

      for (const deal of txns) {
        if (deal.buy_sell === "BUY") {
          queue.push({ date: deal.date, qty: deal.quantity, price: deal.price, type: deal.type, remaining: deal.quantity });
        } else {
          let rem = deal.quantity;
          while (rem > 0 && queue.length > 0) {
            const oldest = queue[0];
            const matched = Math.min(rem, oldest.remaining);
            oldest.remaining -= matched;
            rem -= matched;
            if (oldest.remaining <= 0) queue.shift();
          }
        }
      }

      // Sum remaining open lots
      const openLots = queue.filter(l => l.remaining >= MIN_OPEN_SHARES);
      const totalOpenQty = openLots.reduce((s, l) => s + l.remaining, 0);

      if (totalOpenQty < MIN_OPEN_SHARES) continue; // skip micro-residuals

      const weightedPriceSum = openLots.reduce((s, l) => s + l.remaining * l.price, 0);
      const avgBuyPrice = totalOpenQty > 0 ? weightedPriceSum / totalOpenQty : 0;
      const valueAtCost = (totalOpenQty * avgBuyPrice) / 10000000;

      // Compute total bought and sold
      const totalBought = txns.filter(t => t.buy_sell === "BUY").reduce((s, t) => s + t.quantity, 0);
      const totalSold   = txns.filter(t => t.buy_sell === "SELL").reduce((s, t) => s + t.quantity, 0);
      const totalBuyCr  = txns.filter(t => t.buy_sell === "BUY").reduce((s, t) => s + (t.value_cr || 0), 0);
      const totalSellCr = txns.filter(t => t.buy_sell === "SELL").reduce((s, t) => s + (t.value_cr || 0), 0);

      // Oldest date they bought the share (first ever BUY transaction)
      const firstBuy = txns.find(t => t.buy_sell === "BUY");
      const heldSince = firstBuy ? firstBuy.date : null;

      clientsWithPositions.push({
        client,
        totalOpenQty,
        avgBuyPrice,
        valueAtCost,
        totalBought,
        totalSold,
        totalBuyCr,
        totalSellCr,
        heldSince,
        totalTxns: txns.length,
        transactions: [...txns].reverse(), // newest first for display
      });
    }

    // Sort by value at cost descending
    clientsWithPositions.sort((a, b) => b.valueAtCost - a.valueAtCost);

    // Summary
    const totalOpenQtyAll = clientsWithPositions.reduce((s, c) => s + c.totalOpenQty, 0);
    const totalOpenValueCr = clientsWithPositions.reduce((s, c) => s + c.valueAtCost, 0);
    const uniqueClients = clientsWithPositions.length;

    res.json({
      symbol,
      clients: clientsWithPositions,
      summary: {
        totalClients: uniqueClients,
        totalOpenQty: totalOpenQtyAll,
        totalOpenValueCr,
        totalTransactions: transactions.length,
      },
    });
  } catch (err) {
    console.error("/api/script-portfolio error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 NSE backend running on http://localhost:${PORT}  [MySQL mode]`);
  console.log(`   GET  /api/dashboard → Supercharged API-driven analytics`);
  console.log(`   GET  /api/client-portfolio → Client portfolio & open positions`);
  console.log(`   GET  /api/script-portfolio → Script search & open positions by client`);
});
