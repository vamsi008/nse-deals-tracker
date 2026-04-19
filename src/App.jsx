import { useState, useEffect, useCallback, useMemo } from "react";
import "./index.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatCr(val) {
  if (val == null) return "–";
  return `₹${Number(val).toFixed(2)} Cr`;
}
function formatNum(val) {
  if (val == null) return "–";
  if (val >= 10000000) return `${(val / 10000000).toFixed(2)} Cr`;
  if (val >= 100000) return `${(val / 100000).toFixed(2)} L`;
  return val.toLocaleString("en-IN");
}
function formatPrice(val) {
  if (val == null) return "–";
  return `₹${Number(val).toFixed(2)}`;
}

// Parse our JSON date format "dd-mm-yyyy" or "dd-MMM-yyyy" → Date
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

// Compute reversal alerts: SELL records whose (client, symbol) had a prior BUY in window
function computeAlerts(deals) {
  const alerts = [];
  const buys = {};

  // Sort oldest-first to ensure we catch BUY before SELL
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
          alert_msg: `${deal.client} bought ${formatNum(latestBuy.quantity)} shares on ${latestBuy.date}, now selling ${formatNum(deal.quantity)} shares ${diffDays} day${diffDays !== 1 ? "s" : ""} later.`,
        });

        latestBuy.quantity -= tradedQty;
        remainingSell -= tradedQty;

        if (latestBuy.quantity <= 0) {
          prevBuys.pop();
        }
      }
    }
  }
  // Sort by sell date descending (most recent sell first)
  alerts.sort((a, b) => parseDate(b.currentDate) - parseDate(a.currentDate));
  return alerts;
}

export default function App() {
  const [rawDeals, setRawDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchLog, setFetchLog] = useState([]);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [lastFetched, setLastFetched] = useState(null);
  const [dayWindow, setDayWindow] = useState(30);
  const [leaderboardType, setLeaderboardType] = useState("all");
  const [leaderboardSortDesc, setLeaderboardSortDesc] = useState(true);
  const [leaderboardFilters, setLeaderboardFilters] = useState({ client: '', holding: '', trades: '', winRate: '', pnl: '', symbol: '' });
  const [expandedTop10Client, setExpandedTop10Client] = useState(null);
  const [colFilters, setColFilters] = useState({ date: '', type: '', symbol: '', client: '', buy_sell: '', quantity: '', price: '', value: '' });

  // Load deals from the Express API
  const loadDeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/deals?t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      const data = await response.json();
      const sorted = (Array.isArray(data) ? data : []).sort(
        (a, b) => parseDate(b.date) - parseDate(a.date)
      );
      setRawDeals(sorted);
      setLastFetched(new Date().toLocaleTimeString("en-IN"));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll /api/status until fetch is done, then reload data
  const pollUntilDone = useCallback(async () => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/status");
        const { running, log } = await res.json();
        setFetchLog(log || []);
        if (!running) {
          clearInterval(interval);
          setRefreshing(false);
          setFetchLog([]);
          await loadDeals();
        }
      } catch {
        clearInterval(interval);
        setRefreshing(false);
      }
    }, 3000);
  }, [loadDeals]);

  // Trigger incremental refresh via POST /api/refresh
  const triggerRefresh = useCallback(async () => {
    if (refreshing) return;

    let lastBulkStr = "No data";
    let lastBlockStr = "No data";
    const bulkDates = rawDeals.filter(d => d.type === "bulk").map(d => parseDate(d.date)).filter(d => !isNaN(d));
    if (bulkDates.length) lastBulkStr = new Date(Math.max(...bulkDates)).toLocaleDateString("en-IN", {day:'2-digit', month:'short', year:'numeric'});
    const blockDates = rawDeals.filter(d => d.type === "block").map(d => parseDate(d.date)).filter(d => !isNaN(d));
    if (blockDates.length) lastBlockStr = new Date(Math.max(...blockDates)).toLocaleDateString("en-IN", {day:'2-digit', month:'short', year:'numeric'});
    const todayStr = new Date().toLocaleDateString("en-IN", {day:'2-digit', month:'short', year:'numeric'});
    
    alert(`Initiating NSE Server Sync! 🔄\n\nBulk Deals: Catching up from ${lastBulkStr} ➔ ${todayStr}\nBlock Deals: Catching up from ${lastBlockStr} ➔ ${todayStr}`);

    setRefreshing(true);
    setFetchLog(["⏳ Starting incremental fetch from NSE…"]);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (res.status === 409) {
        setFetchLog(["⚠️ A fetch is already in progress…"]);
        pollUntilDone();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pollUntilDone();
    } catch (e) {
      setError(`Refresh failed: ${e.message}`);
      setRefreshing(false);
    }
  }, [refreshing, pollUntilDone, rawDeals]);

  // Upload CSV and merge
  const uploadCsv = useCallback(async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    setRefreshing(true);
    setFetchLog([`⏳ Uploading and merging ${type} CSV: ${file.name}…`]);
    try {
      const text = await file.text();
      const res = await fetch(`/api/upload-csv?type=${type}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: text
      });
      if (!res.ok) throw new Error("Upload failed");
      
      const resData = await res.json();
      if(resData.success) {
        setFetchLog([`✅ Successfully merged ${file.name}!`]);
        setTimeout(() => setRefreshing(false), 1000);
        await loadDeals();
      } else {
         throw new Error("Merge script failed");
      }
    } catch (err) {
      setError(`CSV Upload error: ${err.message}`);
      setRefreshing(false);
      setFetchLog([]);
    }
    e.target.value = null; // reset input
  }, [loadDeals]);

  // Load data on mount
  useEffect(() => { loadDeals(); }, [loadDeals]);

  // ── Derived Data ───────────────────────────────────────────────────
  // Filter to selected window
  const windowCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - dayWindow);
    return d;
  }, [dayWindow]);

  const deals = useMemo(() =>
    rawDeals.filter(d => parseDate(d.date) >= windowCutoff),
    [rawDeals, windowCutoff]);

  const bulkDeals  = useMemo(() => deals.filter(d => d.type === "bulk"),  [deals]);
  const blockDeals = useMemo(() => deals.filter(d => d.type === "block"), [deals]);
  const targetDealsForAlerts = useMemo(() => {
    if (leaderboardType === "all") return rawDeals;
    return rawDeals.filter(d => d.type === leaderboardType);
  }, [rawDeals, leaderboardType]);
  const allAlerts = useMemo(() => computeAlerts(targetDealsForAlerts), [targetDealsForAlerts]);
  const reversalAlerts = useMemo(() => 
    allAlerts.filter(a => parseDate(a.currentDate) >= windowCutoff),
    [allAlerts, windowCutoff]);

  const totalBuyValue = useMemo(() =>
    deals.filter(d => d.buy_sell === "BUY").reduce((s, d) => s + (d.value_cr || 0), 0),
    [deals]);
  const totalSellValue = useMemo(() =>
    deals.filter(d => d.buy_sell === "SELL").reduce((s, d) => s + (d.value_cr || 0), 0),
    [deals]);

  // ── Client Leaderboard from reversal alerts ───────────────────────────────
  const clientLeaderboard = useMemo(() => {
    const map = {};
    for (const a of reversalAlerts) {
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
          .sort((x, y) => Math.abs(y.pnlCr) - Math.abs(x.pnlCr)); // Rank by highest magnitude of impact
        
        return {
          ...c,
          sortedSymbols,
          symbols: [...c.symbols],
          winRate: c.trades > 0 ? (c.wins / c.trades) * 100 : 0,
          holdingInterval: c.minDays === c.maxDays ? `${c.minDays}d` : `${c.minDays}-${c.maxDays}d`,
          alerts: c.alerts.sort((x, y) => parseDate(y.currentDate) - parseDate(x.currentDate))
        };
      })
      .sort((a, b) => leaderboardSortDesc ? b.totalPnlCr - a.totalPnlCr : a.totalPnlCr - b.totalPnlCr);
  }, [reversalAlerts, leaderboardSortDesc]);

  const filteredClientLeaderboard = useMemo(() => {
    let list = clientLeaderboard;
    if (leaderboardFilters.client) list = list.filter(c => c.client.toLowerCase().includes(leaderboardFilters.client.toLowerCase()));
    if (leaderboardFilters.holding) list = list.filter(c => c.holdingInterval.toLowerCase().includes(leaderboardFilters.holding.toLowerCase()));
    if (leaderboardFilters.trades) list = list.filter(c => c.trades.toString().includes(leaderboardFilters.trades) || `${c.wins} / ${c.losses}`.includes(leaderboardFilters.trades));
    if (leaderboardFilters.winRate) list = list.filter(c => c.winRate.toFixed(0).includes(leaderboardFilters.winRate));
    if (leaderboardFilters.pnl) list = list.filter(c => c.totalPnlCr.toFixed(2).includes(leaderboardFilters.pnl) || (c.totalPnlCr >= 0 ? '+' : '').includes(leaderboardFilters.pnl));
    if (leaderboardFilters.symbol) list = list.filter(c => c.sortedSymbols.some(s => s.symbol.toLowerCase().includes(leaderboardFilters.symbol.toLowerCase())));
    return list;
  }, [clientLeaderboard, leaderboardFilters]);



  const baseDeals =
    activeTab === "bulk"  ? bulkDeals :
    activeTab === "block" ? blockDeals :
    deals;

  const filteredDeals = useMemo(() => {
    let list = baseDeals;
    if (filter !== "ALL") list = list.filter(d => d.buy_sell === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(d =>
        (d.symbol || "").toLowerCase().includes(q) ||
        (d.client || "").toLowerCase().includes(q)
      );
    }
    Object.entries(colFilters).forEach(([k, v]) => {
      const q = v.trim().toLowerCase();
      if (!q) return;
      list = list.filter(d => {
        if (k === 'value') return String(formatCr(d.value_cr)).toLowerCase().includes(q);
        if (k === 'price') return String(formatPrice(d.price)).toLowerCase().includes(q);
        if (k === 'quantity') return String(formatNum(d.quantity)).toLowerCase().includes(q);
        return String(d[k] || "").toLowerCase().includes(q);
      });
    });
    return list;
  }, [baseDeals, filter, search, colFilters]);

  // ── Unique dates in view ──────────────────────────────────────────────
  const latestDbDate = useMemo(() => {
    if (!rawDeals || rawDeals.length === 0) return null;
    const dates = rawDeals.map(d => parseDate(d.date)).filter(d => !isNaN(d));
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates)).toLocaleDateString("en-IN", {day:'2-digit', month:'short', year:'numeric'});
  }, [rawDeals]);

  const allDates = useMemo(() => [
    ...new Set(deals.map(d => d.date))
  ], [deals]);

  return (
    <div className="dashboard fade-in">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="header">
        <div className="title">
          <h1>🔍 NSE Deals Tracker</h1>
          <p>
            {dayWindow}-Day History • {allDates.length} Trading Days
            {latestDbDate && <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}> • DB Updated: <span style={{color: 'var(--color-buy)'}}>{latestDbDate}</span></span>}
            {lastFetched && ` • Synced at ${lastFetched}`}
          </p>
        </div>
          <div className="controls">
            <div className="day-selector">
              {[30, 60, 90, 120, 240, 360, 720].map(d => (
                <button
                  key={d}
                  className={`day-btn ${dayWindow === d ? 'active' : ''}`}
                  onClick={() => setDayWindow(d)}
                >
                  {d}D
                </button>
              ))}
            </div>
            <input
              type="text"
              className="search-input"
              placeholder="Search symbol or client…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="ALL">All Transactions</option>
              <option value="BUY">Buys Only</option>
              <option value="SELL">Sells Only</option>
            </select>
            
            <label className="primary-btn upload-btn" style={{cursor: 'pointer', opacity: (loading || refreshing) ? 0.5 : 1, background: 'var(--bg-card)', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.1)'}}>
              <input type="file" accept=".csv" style={{display: 'none'}} onChange={e => uploadCsv(e, "bulk")} disabled={loading || refreshing} />
              📁 Bulk CSV
            </label>
            <label className="primary-btn upload-btn" style={{cursor: 'pointer', opacity: (loading || refreshing) ? 0.5 : 1, background: 'var(--bg-card)', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.1)'}}>
              <input type="file" accept=".csv" style={{display: 'none'}} onChange={e => uploadCsv(e, "block")} disabled={loading || refreshing} />
              📁 Block CSV
            </label>

            <button
              className="primary-btn"
              onClick={triggerRefresh}
              disabled={loading || refreshing}
              title={refreshing ? "Fetching new data from NSE…" : "Fetch latest deals from NSE"}
            >
              {refreshing ? "⏳ Fetching…" : "⟳ Refresh"}
            </button>
          </div>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {loading && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading deal data…</p>
        </div>
      )}

      {/* ── Refresh progress log ─────────────────────────────────────────── */}
      {refreshing && fetchLog.length > 0 && (
        <div className="fetch-log-panel">
          <div className="fetch-log-header">
            <div className="spinner-small"></div>
            <span>Fetching new data from NSE India…</span>
          </div>
          <div className="fetch-log-body">
            {fetchLog.slice(-12).map((line, i) => (
              <div key={i} className="fetch-log-line">{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="alert-item" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', marginBottom: '1.5rem' }}>
          <h3 style={{ color: '#ef4444' }}>⚠️ Failed to load data</h3>
          <p style={{ color: '#f8fafc', fontSize: '0.9rem' }}>{error}</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.4rem' }}>
            Make sure the Express server is running (<code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>npm run dev</code>)
            and then click <strong>⟳ Refresh</strong> to fetch data from NSE.
          </p>
        </div>
      )}

      {!loading && rawDeals.length > 0 && (
        <>
          {/* ── Summary Cards ──────────────────────────────────────────────────── */}
          <div className="summary-grid">
            <div className="card bulk">
              <div className="card-label">Bulk Deals</div>
              <div className="card-value">{bulkDeals.length}</div>
              <div className="card-sub">last {dayWindow} days</div>
            </div>
            <div className="card block">
              <div className="card-label">Block Deals</div>
              <div className="card-value">{blockDeals.length}</div>
              <div className="card-sub">last {dayWindow} days</div>
            </div>
            <div className="card value">
              <div className="card-label">Total Buy Value</div>
              <div className="card-value">{formatCr(totalBuyValue)}</div>
              <div className="card-sub">last {dayWindow} days</div>
            </div>
            <div className="card value2">
              <div className="card-label">Total Sell Value</div>
              <div className="card-value">{formatCr(totalSellValue)}</div>
              <div className="card-sub">last {dayWindow} days</div>
            </div>
            <div className="card alert">
              <div className="card-label">Reversal Alerts</div>
              <div className="card-value" style={{ color: 'var(--color-alert)' }}>{reversalAlerts.length}</div>
              <div className="card-sub">buy→sell patterns</div>
            </div>
          </div>



          {/* ── Tabs ───────────────────────────────────────────────────────── */}
          <div className="tabs">
            {[
              { key: "all",   label: `All Deals (${rawDeals.length})` },
              { key: "bulk",  label: `Bulk (${bulkDeals.length})` },
              { key: "block", label: `Block (${blockDeals.length})` },
              { key: "leaderboard", label: `Leaderboard` },
              { key: "top10", label: `Top 10 (${dayWindow}D)` },
              { key: "alerts", label: `Alerts (${reversalAlerts.length})` },
            ].map(t => (
              <button
                key={t.key}
                className={`tab ${activeTab === t.key ? "active" : ""}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Reversal Alerts ────────────────────────────────────────────── */}

          {activeTab === "alerts" && reversalAlerts.length > 0 && (
            <div className="alerts-section fade-in">
              <h2 className="section-title">
                <span>⚠️</span> Reversal Alerts
                <span className="badge-count">{reversalAlerts.length}</span>
              </h2>
              <div className="alerts-grid">
                {reversalAlerts.map((a, i) => (
                  <div key={i} className={`alert-item ${a.pnlCr >= 0 ? 'alert-profit' : 'alert-loss'}`}>
                    <div className="alert-header">
                      <span className="badge symbol">{a.symbol}</span>
                      <span className="badge sell">SOLD after {a.diffDays}d</span>
                      <span className={`badge pnl-badge ${a.pnlCr >= 0 ? 'pnl-profit' : 'pnl-loss'}`}>
                        {a.pnlCr >= 0 ? '▲' : '▼'} {a.pnlCr >= 0 ? '+' : ''}₹{Math.abs(a.pnlCr).toFixed(2)} Cr ({a.pnlPct >= 0 ? '+' : ''}{a.pnlPct.toFixed(2)}%)
                      </span>
                    </div>
                    <div className="alert-client">{a.client}</div>
                    <div className="alert-timeline">
                      <div className="timeline-entry buy">
                        <span className="tl-label">BUY</span>
                        <span className="tl-date">{a.prevDate}</span>
                        <span className="tl-qty">{formatNum(a.prevQty)} @ {formatPrice(a.prevPrice)}</span>
                      </div>
                      <div className="timeline-arrow">↓ {a.diffDays} days</div>
                      <div className="timeline-entry sell">
                        <span className="tl-label">SELL</span>
                        <span className="tl-date">{a.currentDate}</span>
                        <span className="tl-qty">{formatNum(a.currentQty)} @ {formatPrice(a.currentPrice)}</span>
                      </div>
                    </div>
                    <p className="alert-msg">{a.alert_msg}</p>
                  </div>
                ))}
              </div>
            </div>
          )}


          {activeTab === "leaderboard" && clientLeaderboard.length > 0 && (
            <div className="leaderboard-section fade-in">
              <h2 className="section-title">🏆 Smart Money Leaderboard
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 400 }}>&nbsp;— ranked by realised P&amp;L ({dayWindow} Days)</span>
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', justifyContent: 'flex-end' }}>
                {["all", "bulk", "block"].map(t => (
                  <button key={t} onClick={() => setLeaderboardType(t)} className={`badge ${leaderboardType === t ? 'buy' : ''}`} style={{cursor: 'pointer', border: leaderboardType !== t ? '1px solid var(--border-color)' : '1px solid transparent', background: leaderboardType !== t ? 'transparent' : 'var(--color-buy)', color: leaderboardType !== t ? 'var(--text-secondary)' : '#fff'}}>
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="leaderboard-table-wrap">
                <table className="leaderboard-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Client</th>
                      <th>Holding Period</th>
                      <th>Trades</th>
                      <th>Wins</th>
                      <th>Win Rate</th>
                      <th style={{ textAlign: 'right' }}>Total P&amp;L</th>
                      <th>Stocks Traded</th>
                    </tr>
                    <tr className="filter-row" style={{ background: 'var(--bg-card)' }}>
                      <th style={{ padding: '4px' }}></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={leaderboardFilters.client} onChange={e => setLeaderboardFilters({...leaderboardFilters, client: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={leaderboardFilters.holding} onChange={e => setLeaderboardFilters({...leaderboardFilters, holding: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                      <th colSpan="2" style={{ padding: '4px' }}><input type="text" placeholder="Filter trades..." value={leaderboardFilters.trades} onChange={e => setLeaderboardFilters({...leaderboardFilters, trades: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={leaderboardFilters.winRate} onChange={e => setLeaderboardFilters({...leaderboardFilters, winRate: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={leaderboardFilters.pnl} onChange={e => setLeaderboardFilters({...leaderboardFilters, pnl: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', textAlign: 'right' }} /></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter symbol..." value={leaderboardFilters.symbol} onChange={e => setLeaderboardFilters({...leaderboardFilters, symbol: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                    </tr>
                  </thead>
                    {filteredClientLeaderboard.map((c, i) => {
                      const isExp = expandedTop10Client === c.client;
                      return (
                      <tbody key={c.client}>
                        <tr 
                          className={c.totalPnlCr >= 0 ? 'row-buy' : 'row-sell'}
                          style={{ cursor: 'pointer', transition: 'background 0.2s', background: isExp ? 'rgba(255,255,255,0.05)' : '' }}
                          onClick={() => setExpandedTop10Client(isExp ? null : c.client)}
                        >
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>{isExp ? '▼' : '▶'}</span>
                              <span className={`rank-badge ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}`}>
                                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                              </span>
                            </div>
                          </td>
                          <td style={{ fontWeight: 600, color: '#f8fafc' }}>{c.client}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{c.holdingInterval}</td>
                          <td>{c.trades}</td>
                          <td>{c.wins} / {c.losses}</td>
                          <td>
                            <div className="win-rate-bar-wrap">
                              <div className="win-rate-bar" style={{ width: `${c.winRate}%`, background: c.winRate >= 60 ? 'var(--color-buy)' : c.winRate >= 40 ? '#f59e0b' : 'var(--color-sell)' }} />
                              <span className="win-rate-label">{c.winRate.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: c.totalPnlCr >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                            {c.totalPnlCr >= 0 ? '+' : ''}₹{c.totalPnlCr.toFixed(2)} Cr
                          </td>
                          <td>
                            <div className="symbol-chips">
                              {c.sortedSymbols.slice(0, 4).map(s => <span key={s.symbol} className="badge symbol" style={{borderLeft: s.pnlCr >= 0 ? '2px solid var(--color-buy)' : '2px solid var(--color-sell)'}}>{s.symbol} <span style={{opacity: 0.7, fontSize: '0.9em'}}>{s.pnlCr >= 0 ? '+' : ''}{s.pnlCr.toFixed(2)}Cr</span></span>)}
                              {c.sortedSymbols.length > 4 && <span className="badge symbol">+{c.sortedSymbols.length - 4}</span>}
                            </div>
                          </td>
                        </tr>
                        {isExp && c.alerts && c.alerts.length > 0 && (
                          <tr className="expanded-row">
                            <td colSpan="8" style={{ padding: 0, background: 'rgba(0,0,0,0.2)' }}>
                              <div style={{ padding: '1rem', borderLeft: '4px solid rgba(255,255,255,0.1)' }}>
                                <h4 style={{ margin: '0 0 0.8rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Constituent Trades</h4>
                                <table className="leaderboard-table" style={{ background: 'var(--bg-card)' }}>
                                  <thead>
                                    <tr>
                                      <th>Symbol</th>
                                      <th>Buy Date</th>
                                      <th>Sell Date</th>
                                      <th>Hold</th>
                                      <th style={{ textAlign: 'right' }}>Buy Price</th>
                                      <th style={{ textAlign: 'right' }}>Sell Price</th>
                                      <th style={{ textAlign: 'right' }}>Trade Qty</th>
                                      <th style={{ textAlign: 'right' }}>Net P&amp;L</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.alerts.map((a, idx) => (
                                      <tr key={idx} style={{ borderLeft: a.pnlCr >= 0 ? '3px solid var(--color-buy)' : '3px solid var(--color-sell)' }}>
                                        <td style={{ fontWeight: 600 }}>{a.symbol}</td>
                                        <td>{a.prevDate}</td>
                                        <td>{a.currentDate}</td>
                                        <td>{a.diffDays}d</td>
                                        <td style={{ textAlign: 'right' }}>{formatPrice(a.prevPrice)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatPrice(a.currentPrice)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNum(a.tradedQty || Math.min(a.prevQty, a.currentQty))}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: a.pnlCr >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                                          {a.pnlCr >= 0 ? '+' : ''}₹{a.pnlCr.toFixed(2)} Cr <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>({a.pnlPct >= 0 ? '+' : ''}{a.pnlPct.toFixed(2)}%)</span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                      );
                    })}
                </table>
              </div>
            </div>
          )}

          {activeTab === "top10" && clientLeaderboard.length > 0 && (
            <div className="leaderboard-section fade-in">
              <h2 className="section-title">{leaderboardSortDesc ? '🏆 Top 10 Profitable Clients' : '💀 Top 10 Worst Performing Clients'}
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 400 }}>&nbsp;— within selected {dayWindow}-day interval</span>
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', justifyContent: 'flex-end' }}>
                {["all", "bulk", "block"].map(t => (
                  <button key={t} onClick={() => setLeaderboardType(t)} className={`badge ${leaderboardType === t ? 'buy' : ''}`} style={{cursor: 'pointer', border: leaderboardType !== t ? '1px solid var(--border-color)' : '1px solid transparent', background: leaderboardType !== t ? 'transparent' : 'var(--color-buy)', color: leaderboardType !== t ? 'var(--text-secondary)' : '#fff'}}>
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="leaderboard-table-wrap">
                <table className="leaderboard-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Client</th>
                      <th>Holding Period</th>
                      <th>Trades</th>
                      <th>Wins</th>
                      <th>Win Rate</th>
                      <th 
                        style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => setLeaderboardSortDesc(!leaderboardSortDesc)}
                        title="Click to flip Performance sorting order"
                      >
                        Total P&amp;L {leaderboardSortDesc ? '↓' : '↑'}
                      </th>
                      <th>Stocks Traded</th>
                    </tr>
                    <tr className="filter-row" style={{ background: 'var(--bg-card)' }}>
                      <th style={{ padding: '4px' }}></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={leaderboardFilters.client} onChange={e => setLeaderboardFilters({...leaderboardFilters, client: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={leaderboardFilters.holding} onChange={e => setLeaderboardFilters({...leaderboardFilters, holding: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                      <th colSpan="2" style={{ padding: '4px' }}><input type="text" placeholder="Filter trades..." value={leaderboardFilters.trades} onChange={e => setLeaderboardFilters({...leaderboardFilters, trades: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={leaderboardFilters.winRate} onChange={e => setLeaderboardFilters({...leaderboardFilters, winRate: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={leaderboardFilters.pnl} onChange={e => setLeaderboardFilters({...leaderboardFilters, pnl: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', textAlign: 'right' }} /></th>
                      <th style={{ padding: '4px' }}><input type="text" placeholder="Filter symbol..." value={leaderboardFilters.symbol} onChange={e => setLeaderboardFilters({...leaderboardFilters, symbol: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                    </tr>
                  </thead>
                    {filteredClientLeaderboard.slice(0, 10).map((c, i) => {
                      const isExp = expandedTop10Client === c.client;
                      return (
                      <tbody key={c.client}>
                        <tr 
                          className={c.totalPnlCr >= 0 ? 'row-buy' : 'row-sell'}
                          style={{ cursor: 'pointer', transition: 'background 0.2s', background: isExp ? 'rgba(255,255,255,0.05)' : '' }}
                          onClick={() => setExpandedTop10Client(isExp ? null : c.client)}
                        >
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>{isExp ? '▼' : '▶'}</span>
                              <span className={`rank-badge ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}`}>
                                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                              </span>
                            </div>
                          </td>
                          <td style={{ fontWeight: 600, color: '#f8fafc' }}>{c.client}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{c.holdingInterval}</td>
                          <td>{c.trades}</td>
                          <td>{c.wins} / {c.losses}</td>
                          <td>
                            <div className="win-rate-bar-wrap">
                              <div className="win-rate-bar" style={{ width: `${c.winRate}%`, background: c.winRate >= 60 ? 'var(--color-buy)' : c.winRate >= 40 ? '#f59e0b' : 'var(--color-sell)' }} />
                              <span className="win-rate-label">{c.winRate.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: c.totalPnlCr >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                            {c.totalPnlCr >= 0 ? '+' : ''}₹{c.totalPnlCr.toFixed(2)} Cr
                          </td>
                          <td>
                            <div className="symbol-chips">
                              {c.sortedSymbols.slice(0, 4).map(s => <span key={s.symbol} className="badge symbol" style={{borderLeft: s.pnlCr >= 0 ? '2px solid var(--color-buy)' : '2px solid var(--color-sell)'}}>{s.symbol} <span style={{opacity: 0.7, fontSize: '0.9em'}}>{s.pnlCr >= 0 ? '+' : ''}{s.pnlCr.toFixed(2)}Cr</span></span>)}
                              {c.sortedSymbols.length > 4 && <span className="badge symbol">+{c.sortedSymbols.length - 4}</span>}
                            </div>
                          </td>
                        </tr>
                        {isExp && c.alerts && c.alerts.length > 0 && (
                          <tr className="expanded-row">
                            <td colSpan="8" style={{ padding: 0, background: 'rgba(0,0,0,0.2)' }}>
                              <div style={{ padding: '1rem', borderLeft: '4px solid rgba(255,255,255,0.1)' }}>
                                <h4 style={{ margin: '0 0 0.8rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Constituent Trades</h4>
                                <table className="leaderboard-table" style={{ background: 'var(--bg-card)' }}>
                                  <thead>
                                    <tr>
                                      <th>Symbol</th>
                                      <th>Buy Date</th>
                                      <th>Sell Date</th>
                                      <th>Hold</th>
                                      <th style={{ textAlign: 'right' }}>Buy Price</th>
                                      <th style={{ textAlign: 'right' }}>Sell Price</th>
                                      <th style={{ textAlign: 'right' }}>Trade Qty</th>
                                      <th style={{ textAlign: 'right' }}>Net P&amp;L</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.alerts.map((a, idx) => (
                                      <tr key={idx} style={{ borderLeft: a.pnlCr >= 0 ? '3px solid var(--color-buy)' : '3px solid var(--color-sell)' }}>
                                        <td style={{ fontWeight: 600 }}>{a.symbol}</td>
                                        <td>{a.prevDate}</td>
                                        <td>{a.currentDate}</td>
                                        <td>{a.diffDays}d</td>
                                        <td style={{ textAlign: 'right' }}>{formatPrice(a.prevPrice)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatPrice(a.currentPrice)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNum(a.tradedQty || Math.min(a.prevQty, a.currentQty))}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: a.pnlCr >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                                          {a.pnlCr >= 0 ? '+' : ''}₹{a.pnlCr.toFixed(2)} Cr <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>({a.pnlPct >= 0 ? '+' : ''}{a.pnlPct.toFixed(2)}%)</span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                      );
                    })}
                </table>
              </div>
            </div>
          )}

          {activeTab !== "leaderboard" && activeTab !== "top10" && activeTab !== "alerts" && (
            <div className="data-table-container fade-in">
            {filteredDeals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                No deals match current filters.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Symbol</th>
                    <th>Client / Entity</th>
                    <th>Action</th>
                    <th style={{ textAlign: 'right' }}>Quantity</th>
                    <th style={{ textAlign: 'right' }}>Price</th>
                    <th style={{ textAlign: 'right' }}>Value</th>
                  </tr>
                  <tr className="filter-row" style={{ background: 'var(--bg-card)' }}>
                    <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={colFilters.date} onChange={e => setColFilters({...colFilters, date: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                    <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={colFilters.type} onChange={e => setColFilters({...colFilters, type: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                    <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={colFilters.symbol} onChange={e => setColFilters({...colFilters, symbol: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                    <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={colFilters.client} onChange={e => setColFilters({...colFilters, client: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                    <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={colFilters.buy_sell} onChange={e => setColFilters({...colFilters, buy_sell: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }} /></th>
                    <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={colFilters.quantity} onChange={e => setColFilters({...colFilters, quantity: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', textAlign: 'right' }} /></th>
                    <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={colFilters.price} onChange={e => setColFilters({...colFilters, price: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', textAlign: 'right' }} /></th>
                    <th style={{ padding: '4px' }}><input type="text" placeholder="Filter..." value={colFilters.value} onChange={e => setColFilters({...colFilters, value: e.target.value})} style={{ width: '100%', padding: '2px 4px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', textAlign: 'right' }} /></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((d, i) => (
                    <tr key={d.id || i} className={d.buy_sell === "SELL" ? "row-sell" : "row-buy"}>
                      <td className="col-date">{d.date}</td>
                      <td>
                        <span
                          className="badge symbol"
                          style={{
                            background: d.type === "block" ? 'rgba(59,130,246,0.25)' : 'rgba(139,92,246,0.25)',
                            color: d.type === "block" ? '#60a5fa' : '#c084fc',
                            borderColor: d.type === "block" ? 'rgba(59,130,246,0.4)' : 'rgba(139,92,246,0.4)'
                          }}
                        >
                          {d.type?.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700, color: '#f8fafc' }}>{d.symbol}</td>
                      <td className="col-client">{d.client}</td>
                      <td>
                        <span className={`badge ${d.buy_sell === "BUY" ? "buy" : "sell"}`}>
                          {d.buy_sell}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatNum(d.quantity)}</td>
                      <td style={{ textAlign: 'right' }}>{formatPrice(d.price)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCr(d.value_cr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            </div>
          )}

          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '1.5rem' }}>
            Showing {filteredDeals.length} of {rawDeals.length} deals across {allDates.length} trading days
          </p>
        </>
      )}

      {!loading && rawDeals.length === 0 && !error && !refreshing && (
        <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📭</div>
          <h3>No data yet</h3>
          <p>Click <strong>⟳ Refresh</strong> to fetch the last 120 days of NSE bulk &amp; block deals.</p>
          <p style={{ fontSize: '0.82rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
            Initial fetch takes ~5–10 minutes due to NSE rate limits.
            Subsequent refreshes are incremental and much faster.
          </p>
        </div>
      )}
    </div>
  );
}
