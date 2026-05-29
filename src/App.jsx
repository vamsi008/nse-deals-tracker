import { useState, useEffect, useCallback } from "react";
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

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchLog, setFetchLog] = useState([]);
  const [error, setError] = useState(null);

  // ── Filters & State ──
  const [activeTab, setActiveTab] = useState("all");
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [dayWindow, setDayWindow] = useState(30);
  const [page, setPage] = useState(1);
  const [leaderboardType, setLeaderboardType] = useState("all");
  const [leaderboardSortDesc, setLeaderboardSortDesc] = useState(true);
  const [expandedTop10Client, setExpandedTop10Client] = useState(null);

  // ── Client Portfolio State ──
  const [portfolioClient, setPortfolioClient] = useState("");
  const [portfolioSearch, setPortfolioSearch] = useState("");
  const [portfolioSuggestions, setPortfolioSuggestions] = useState([]);
  const [portfolioData, setPortfolioData] = useState(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState(null);
  const [portfolioSelectedSymbol, setPortfolioSelectedSymbol] = useState(null);
  const [level1SortConfig, setLevel1SortConfig] = useState({ key: 'valueAtCost', direction: 'desc' });
  const [level1Search, setLevel1Search] = useState("");

  // ── Clients List (for portfolio panel) ──
  const [clientsList, setClientsList] = useState([]);
  const [clientsListSearch, setClientsListSearch] = useState("");
  const [clientsListLoading, setClientsListLoading] = useState(false);

  // ── Script Search State ──
  const [scriptSearch, setScriptSearch] = useState("");
  const [scriptSuggestions, setScriptSuggestions] = useState([]);
  const [scriptSelectedSymbol, setScriptSelectedSymbol] = useState(null);
  const [scriptData, setScriptData] = useState(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState(null);
  const [scriptExpandedClient, setScriptExpandedClient] = useState(null);
  const [scriptSortConfig, setScriptSortConfig] = useState({ key: 'valueAtCost', direction: 'desc' });

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [activeTab, filter, search, dayWindow]);

  // ── Load Dashboard Data ──
  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        days: dayWindow,
        tab: activeTab,
        filter: filter,
        search: search,
        page: page,
        limit: 200,
        leaderboardType: leaderboardType
      }).toString();

      const response = await fetch(`/api/dashboard?${qs}&t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      const result = await response.json();
      if (result.error) throw new Error(result.error);
      
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [dayWindow, activeTab, filter, search, page, leaderboardType]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      loadDashboard();
    }, search ? 400 : 0); // debounce search
    return () => clearTimeout(delayDebounceFn);
  }, [loadDashboard, search]);

  // ── Portfolio: autocomplete ──
  useEffect(() => {
    if (portfolioSearch.length < 2) { setPortfolioSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/client-search?q=${encodeURIComponent(portfolioSearch)}`);
        setPortfolioSuggestions(await r.json());
      } catch { setPortfolioSuggestions([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [portfolioSearch]);

  // ── Load clients list when portfolio tab is activated ──
  useEffect(() => {
    if (activeTab !== "portfolio") return;
    setClientsListLoading(true);
    fetch("/api/clients")
      .then(r => r.json())
      .then(d => { setClientsList(d); setClientsListLoading(false); })
      .catch(() => setClientsListLoading(false));
  }, [activeTab]);

  const loadPortfolio = useCallback(async (clientName) => {
    if (!clientName) return;
    setPortfolioLoading(true);
    setPortfolioError(null);
    setPortfolioData(null);
    try {
      const r = await fetch(`/api/client-portfolio?client=${encodeURIComponent(clientName)}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setPortfolioData(d);
    } catch (e) {
      setPortfolioError(e.message);
    } finally {
      setPortfolioLoading(false);
    }
  }, []);

  const selectPortfolioClient = useCallback((name) => {
    setPortfolioClient(name);
    setPortfolioSearch(name);
    setPortfolioSuggestions([]);
    setPortfolioSelectedSymbol(null); // reset filter on client change
    setLevel1Search("");
    loadPortfolio(name);
  }, [loadPortfolio]);

  // ── Refresh / Poll Logic ──
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
          await loadDashboard();
        }
      } catch {
        clearInterval(interval);
        setRefreshing(false);
      }
    }, 3000);
  }, [loadDashboard]);

  const triggerRefresh = useCallback(async () => {
    if (refreshing) return;
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
  }, [refreshing, pollUntilDone]);

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
        await loadDashboard();
      } else {
         throw new Error("Merge script failed");
      }
    } catch (err) {
      setError(`CSV Upload error: ${err.message}`);
      setRefreshing(false);
      setFetchLog([]);
    }
    e.target.value = null;
  }, [loadDashboard]);

  const sortedLeaderboard = data?.leaderboard 
    ? [...data.leaderboard].sort((a, b) => leaderboardSortDesc ? b.totalPnlCr - a.totalPnlCr : a.totalPnlCr - b.totalPnlCr)
    : [];

  return (
    <div className="dashboard fade-in">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="header">
        <div className="title">
          <h1>🔍 NSE Deals Tracker</h1>
          <p>
            {dayWindow}-Day History • {data?.allDatesLength || 0} Trading Days
            {data?.summary?.latestDbDate && <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}> • Latest DB Date: <span style={{color: 'var(--color-buy)'}}>{new Date(data.summary.latestDbDate).toLocaleDateString("en-IN")}</span></span>}
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

            <button className="primary-btn" onClick={triggerRefresh} disabled={loading || refreshing}>
              {refreshing ? "⏳ Fetching…" : "⟳ Refresh"}
            </button>
          </div>
      </div>

      {/* ── Error & Log ─────────────────────────────────────────────────── */}
      {error && (
        <div className="alert-item" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', marginBottom: '1.5rem' }}>
          <h3 style={{ color: '#ef4444' }}>⚠️ Failed to load data</h3>
          <p style={{ color: '#f8fafc', fontSize: '0.9rem' }}>{error}</p>
        </div>
      )}

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

      {loading && !data && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Fetching API data…</p>
        </div>
      )}

      {data && (
        <>
          {/* ── Summary Cards ──────────────────────────────────────────────── */}
          <div className="summary-grid" style={{opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s'}}>
            <div className="card bulk">
              <div className="card-label">Bulk Deals</div>
              <div className="card-value">{data.summary.bulk}</div>
              <div className="card-sub">last {dayWindow} days</div>
            </div>
            <div className="card block">
              <div className="card-label">Block Deals</div>
              <div className="card-value">{data.summary.block}</div>
              <div className="card-sub">last {dayWindow} days</div>
            </div>
            <div className="card short">
              <div className="card-label">Short Sells</div>
              <div className="card-value">{data.summary.short}</div>
              <div className="card-sub">last {dayWindow} days</div>
            </div>
            <div className="card value">
              <div className="card-label">Total Buy Value</div>
              <div className="card-value">{formatCr(data.summary.totalBuyValue)}</div>
              <div className="card-sub">last {dayWindow} days</div>
            </div>
            <div className="card value2">
              <div className="card-label">Total Sell Value</div>
              <div className="card-value">{formatCr(data.summary.totalSellValue)}</div>
              <div className="card-sub">last {dayWindow} days</div>
            </div>
            <div className="card alert">
              <div className="card-label">Reversal Alerts</div>
              <div className="card-value" style={{ color: 'var(--color-alert)' }}>{data.summary.alertsCount}</div>
              <div className="card-sub">buy→sell patterns</div>
            </div>
          </div>

          {/* ── Tabs ───────────────────────────────────────────────────────── */}
          <div className="tabs">
            {[
              { key: "all",   label: `All Deals` },
              { key: "large", label: `Large Deals` },
              { key: "bulk",  label: `Bulk Deals` },
              { key: "block", label: `Block Deals` },
              { key: "short", label: `Short Sells` },
              { key: "leaderboard", label: `Leaderboard` },
              { key: "top10", label: `Top 10 (${dayWindow}D)` },
              { key: "alerts", label: `Alerts (${data.summary.alertsCount})` },
              { key: "portfolio", label: `📋 Client Portfolio` },
              { key: "scriptSearch", label: `🔎 Script Search` },
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

          {/* ── Content ────────────────────────────────────────────────────── */}
          <div style={{opacity: (loading && activeTab !== 'portfolio' && activeTab !== 'scriptSearch') ? 0.5 : 1, transition: 'opacity 0.2s'}}>
            {/* Alerts Tab */}
            {activeTab === "alerts" && (
              <div className="alerts-section fade-in">
                <h2 className="section-title">
                  <span>⚠️</span> Reversal Alerts
                  <span className="badge-count">{data.alerts.length}</span>
                </h2>
                {data.alerts.length === 0 ? <p style={{color: 'var(--text-secondary)'}}>No alerts found.</p> : (
                  <div className="alerts-grid">
                    {data.alerts.map((a, i) => (
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
                )}
              </div>
            )}

            {/* Leaderboard & Top 10 */}
            {(activeTab === "leaderboard" || activeTab === "top10") && (
              <div className="leaderboard-section fade-in">
                <h2 className="section-title">
                  {activeTab === "top10" ? (leaderboardSortDesc ? '🏆 Top 10 Profitable Clients' : '💀 Top 10 Worst Performing Clients') : '🏆 Smart Money Leaderboard'}
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
                        <th>Holding</th>
                        <th>Trades</th>
                        <th>Wins/Loss</th>
                        <th>Win Rate</th>
                        <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => setLeaderboardSortDesc(!leaderboardSortDesc)}>Total P&amp;L {leaderboardSortDesc ? '↓' : '↑'}</th>
                        <th>Stocks Traded</th>
                      </tr>
                    </thead>
                    {sortedLeaderboard.slice(0, activeTab === "top10" ? 10 : 9999).map((c, i) => {
                      const isExp = expandedTop10Client === c.client;
                      return (
                      <tbody key={c.client}>
                        <tr 
                          className={c.totalPnlCr >= 0 ? 'row-buy' : 'row-sell'}
                          style={{ cursor: 'pointer', background: isExp ? 'rgba(255,255,255,0.05)' : '' }}
                          onClick={() => setExpandedTop10Client(isExp ? null : c.client)}
                        >
                          <td>
                            <span className={`rank-badge ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}`}>
                              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                            </span>
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
                        {isExp && c.alerts && (
                          <tr className="expanded-row">
                            <td colSpan="8" style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)' }}>
                                <table className="leaderboard-table" style={{ background: 'var(--bg-card)' }}>
                                  <thead>
                                    <tr>
                                      <th>Symbol</th>
                                      <th>Buy Date</th>
                                      <th>Sell Date</th>
                                      <th>Hold</th>
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
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: a.pnlCr >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                                          {a.pnlCr >= 0 ? '+' : ''}₹{a.pnlCr.toFixed(2)} Cr
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
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

            {/* Main Table */}
            {activeTab !== "leaderboard" && activeTab !== "top10" && activeTab !== "alerts" && activeTab !== "portfolio" && activeTab !== "scriptSearch" && (
              <div className="data-table-container fade-in">
              {data.table.data.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  No deals match current filters.
                </div>
              ) : (
                <>
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
                  </thead>
                  <tbody>
                    {data.table.data.map((d, i) => (
                      <tr key={d.id || i} className={d.buy_sell === "SELL" ? "row-sell" : "row-buy"}>
                        <td className="col-date">{d.date}</td>
                        <td>
                          <span
                            className="badge symbol"
                            style={{
                              background: d.type === "block" ? 'rgba(59,130,246,0.25)' : (d.type === "short" ? 'rgba(236,72,153,0.25)' : 'rgba(139,92,246,0.25)'),
                              color: d.type === "block" ? '#60a5fa' : (d.type === "short" ? '#f472b6' : '#c084fc'),
                              borderColor: d.type === "block" ? 'rgba(59,130,246,0.4)' : (d.type === "short" ? 'rgba(236,72,153,0.4)' : 'rgba(139,92,246,0.4)')
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
                {Math.ceil(data.table.totalItems / data.table.limit) > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      Showing {((page - 1) * data.table.limit) + 1} to {Math.min(page * data.table.limit, data.table.totalItems)} of {data.table.totalItems} deals
                    </span>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <button 
                        disabled={page === 1} 
                        onClick={() => setPage(p => p - 1)} 
                        className="primary-btn" 
                        style={{ padding: '0.4rem 0.8rem', opacity: page === 1 ? 0.3 : 1 }}
                      >
                        ← Prev
                      </button>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center' }}>
                        Page
                        <select 
                          value={page} 
                          onChange={(e) => setPage(Number(e.target.value))}
                          style={{ background: 'var(--bg-accent)', color: '#fff', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.2rem 0.5rem', margin: '0 0.5rem', cursor: 'pointer' }}
                        >
                          {Array.from({ length: Math.ceil(data.table.totalItems / data.table.limit) }, (_, i) => i + 1).map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                        of {Math.ceil(data.table.totalItems / data.table.limit)}
                      </span>
                      <button 
                        disabled={page === Math.ceil(data.table.totalItems / data.table.limit)} 
                        onClick={() => setPage(p => p + 1)} 
                        className="primary-btn" 
                        style={{ padding: '0.4rem 0.8rem', opacity: page === Math.ceil(data.table.totalItems / data.table.limit) ? 0.3 : 1 }}
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
                </>
              )}
              </div>
            )}

            {/* ── Client Portfolio Tab ──────────────────────────────────── */}
            {activeTab === "portfolio" && (
              <div className="portfolio-section fade-in">
                <div className="portfolio-two-panel">

                  {/* ── LEFT PANEL: Client List ── */}
                  <div className="portfolio-list-panel">
                    <div className="portfolio-list-header">
                      <h3>👥 All Clients</h3>
                      <span className="badge-count" style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', borderColor: 'rgba(59,130,246,0.3)' }}>
                        {clientsList.length}
                      </span>
                    </div>
                    <div className="portfolio-list-search-wrap">
                      <input
                        className="portfolio-list-search"
                        type="text"
                        placeholder="Filter clients…"
                        value={clientsListSearch}
                        onChange={e => setClientsListSearch(e.target.value)}
                      />
                    </div>
                    {clientsListLoading && (
                      <div style={{ padding: '2rem', textAlign: 'center' }}><div className="spinner"></div></div>
                    )}
                    <div className="portfolio-client-list">
                      {clientsList
                        .filter(c => !clientsListSearch || c.client.toLowerCase().includes(clientsListSearch.toLowerCase()))
                        .map(c => (
                          <div
                            key={c.client}
                            className={`portfolio-client-row ${portfolioClient === c.client ? 'active' : ''}`}
                            onClick={() => selectPortfolioClient(c.client)}
                          >
                            <div className="pcr-name">{c.client}</div>
                            <div className="pcr-meta">
                              <span className="pcr-txns">{c.totalTxns} trades</span>
                              {c.openPositionsCount > 0 && (
                                <span className="pcr-open-badge">
                                  🟢 {c.openPositionsCount} open
                                </span>
                              )}
                            </div>
                            <div className="pcr-value">{formatCr(c.totalBuyCr)}</div>
                          </div>
                        ))
                      }
                    </div>
                  </div>

                  {/* ── RIGHT PANEL: Client Detail ── */}
                  <div className="portfolio-detail-panel">
                    {portfolioLoading && (
                      <div className="loading-container"><div className="spinner"></div><p>Loading portfolio…</p></div>
                    )}
                    {portfolioError && (
                      <div className="alert-item" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
                        <p style={{ color: '#f87171' }}>⚠️ {portfolioError}</p>
                      </div>
                    )}

                    {portfolioData && !portfolioLoading && (
                      <>
                        {/* Client name bar */}
                        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#f8fafc' }}>
                            📋 {portfolioData.client}
                          </span>
                          {portfolioSelectedSymbol === null && (
                            <button
                              onClick={() => setPortfolioSelectedSymbol('__all__')}
                              style={{ padding: '0.35rem 0.85rem', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                            >
                              All Transactions →
                            </button>
                          )}
                          {portfolioSelectedSymbol !== null && (
                            <button
                              onClick={() => setPortfolioSelectedSymbol(null)}
                              style={{ padding: '0.35rem 0.85rem', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                            >
                              ← Open Positions
                            </button>
                          )}
                        </div>

                        {/* LEVEL 1: Simple open positions list */}
                        {portfolioSelectedSymbol === null && (
                          <div style={{ padding: '0.75rem 0' }}>
                            {(() => {
                              const rawPositions = portfolioData.openPositionsBySymbol?.filter(pos => pos.totalOpenQty >= 1) ?? [];
                              const filteredPositions = rawPositions.filter(p => p.symbol.toLowerCase().includes(level1Search.toLowerCase()));
                              const sortedPositions = [...filteredPositions].sort((a, b) => {
                                let aVal = a[level1SortConfig.key];
                                let bVal = b[level1SortConfig.key];
                                if (level1SortConfig.key === 'symbol') {
                                  return level1SortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                                }
                                return level1SortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
                              });

                              const handleSort = (key) => {
                                setLevel1SortConfig(prev => ({
                                  key,
                                  direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
                                }));
                              };

                              return (
                                <>
                                  <div style={{ padding: '0.5rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input 
                                      type="text" 
                                      placeholder="Filter scripts..." 
                                      value={level1Search} 
                                      onChange={(e) => setLevel1Search(e.target.value)}
                                      style={{ padding: '0.45rem 0.85rem', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: '#f8fafc', fontSize: '0.85rem', outline: 'none', minWidth: '200px' }}
                                    />
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                                      {sortedPositions.length} scripts
                                    </span>
                                  </div>

                                  {sortedPositions.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
                                      {rawPositions.length === 0 ? (
                                        <>
                                          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
                                          <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>No open positions</p>
                                          <p style={{ fontSize: '0.82rem', marginBottom: '1rem' }}>All shares have been fully sold.</p>
                                        </>
                                      ) : (
                                        <p style={{ fontWeight: 600 }}>No scripts match your filter.</p>
                                      )}
                                      {rawPositions.length === 0 && (
                                        <button
                                          onClick={() => setPortfolioSelectedSymbol('__all__')}
                                          style={{ padding: '0.4rem 1rem', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.82rem' }}
                                        >
                                          View all transactions
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="leaderboard-table-wrap" style={{ margin: '0 0.75rem' }}>
                                      <table className="leaderboard-table">
                                        <thead>
                                          <tr>
                                            <th onClick={() => handleSort('symbol')} style={{ cursor: 'pointer' }}>Script {level1SortConfig.key === 'symbol' ? (level1SortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                            <th onClick={() => handleSort('totalOpenQty')} style={{ textAlign: 'right', cursor: 'pointer' }}>Shares Held {level1SortConfig.key === 'totalOpenQty' ? (level1SortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                            <th onClick={() => handleSort('valueAtCost')} style={{ textAlign: 'right', cursor: 'pointer' }}>Amount (Cr) {level1SortConfig.key === 'valueAtCost' ? (level1SortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sortedPositions.map(pos => (
                                            <tr
                                              key={pos.symbol}
                                              onClick={() => setPortfolioSelectedSymbol(pos.symbol)}
                                              style={{ cursor: 'pointer', borderLeft: '3px solid #10b981' }}
                                              className="row-buy"
                                            >
                                              <td style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.95rem' }}>{pos.symbol}</td>
                                              <td style={{ textAlign: 'right', fontWeight: 700, color: '#10b981', fontSize: '0.95rem' }}>
                                                {formatNum(pos.totalOpenQty)}
                                              </td>
                                              <td style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.95rem' }}>
                                                {formatCr(pos.valueAtCost)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}

                        {/* LEVEL 2: All transactions for selected script */}
                        {portfolioSelectedSymbol !== null && (() => {
                          const isAllView = portfolioSelectedSymbol === '__all__';
                          const filteredTxns = isAllView
                            ? portfolioData.transactions
                            : portfolioData.transactions.filter(t => t.symbol === portfolioSelectedSymbol);

                          return (
                            <div style={{ padding: '0.75rem 0' }}>
                              <div style={{ padding: '0.5rem 1.5rem 0.75rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                                  {isAllView ? `All Transactions — ${filteredTxns.length} records` : `${portfolioSelectedSymbol} — ${filteredTxns.length} transactions`}
                                </span>
                              </div>

                              <div className="leaderboard-table-wrap" style={{ margin: '0 0.75rem' }}>
                                <table className="leaderboard-table">
                                  <thead>
                                    <tr>
                                      <th>Date</th>
                                      <th>Type</th>
                                      {isAllView && <th>Script</th>}
                                      <th>Action</th>
                                      <th style={{ textAlign: 'right' }}>Quantity</th>
                                      <th style={{ textAlign: 'right' }}>Price (₹)</th>
                                      <th style={{ textAlign: 'right' }}>Value</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {filteredTxns.map((tx, i) => (
                                      <tr
                                        key={i}
                                        style={{ borderLeft: tx.buy_sell === 'SELL' ? '3px solid var(--color-sell)' : '3px solid var(--color-buy)' }}
                                        className={tx.buy_sell === 'SELL' ? 'row-sell' : 'row-buy'}
                                      >
                                        <td className="col-date">{tx.date}</td>
                                        <td>
                                          <span className="badge symbol" style={{
                                            background: tx.type === 'block' ? 'rgba(59,130,246,0.2)' : (tx.type === 'short' ? 'rgba(236,72,153,0.2)' : 'rgba(139,92,246,0.2)'),
                                            color: tx.type === 'block' ? '#60a5fa' : (tx.type === 'short' ? '#f472b6' : '#c084fc'),
                                            fontSize: '0.7rem'
                                          }}>{tx.type?.toUpperCase()}</span>
                                        </td>
                                        {isAllView && <td style={{ fontWeight: 600, color: '#f8fafc' }}>{tx.symbol}</td>}
                                        <td><span className={`badge ${tx.buy_sell === 'BUY' ? 'buy' : 'sell'}`}>{tx.buy_sell}</span></td>
                                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatNum(tx.quantity)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatPrice(tx.price)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCr(tx.value_cr)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}

                    {!portfolioData && !portfolioLoading && !portfolioError && (
                      <div className="portfolio-empty-state">
                        <div className="portfolio-empty-icon">👈</div>
                        <p style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>Select a client from the list</p>
                        <p>Click any client on the left to view their transactions and open positions.</p>
                      </div>
                    )}
                  </div>

                </div>
              </div>
            )}

            {/* ── Script Search Tab ──────────────────────────────────── */}
            {activeTab === "scriptSearch" && (() => {
              // Autocomplete for symbol search
              const handleScriptSearchChange = (val) => {
                setScriptSearch(val);
                if (val.length < 1) { setScriptSuggestions([]); return; }
                fetch(`/api/symbol-search?q=${encodeURIComponent(val)}`)
                  .then(r => r.json())
                  .then(d => setScriptSuggestions(d || []))
                  .catch(() => setScriptSuggestions([]));
              };

              const selectScript = (sym) => {
                setScriptSelectedSymbol(sym);
                setScriptSearch(sym);
                setScriptSuggestions([]);
                setScriptExpandedClient(null);
                setScriptLoading(true);
                setScriptError(null);
                setScriptData(null);
                fetch(`/api/script-portfolio?symbol=${encodeURIComponent(sym)}`)
                  .then(r => r.json())
                  .then(d => {
                    if (d.error) throw new Error(d.error);
                    setScriptData(d);
                  })
                  .catch(e => setScriptError(e.message))
                  .finally(() => setScriptLoading(false));
              };

              const handleScriptSort = (key) => {
                setScriptSortConfig(prev => ({
                  key,
                  direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
                }));
              };

              const sortedClients = scriptData?.clients
                ? [...scriptData.clients].sort((a, b) => {
                    let aVal = a[scriptSortConfig.key];
                    let bVal = b[scriptSortConfig.key];
                    if (scriptSortConfig.key === 'client') {
                      return scriptSortConfig.direction === 'asc' ? (aVal || '').localeCompare(bVal || '') : (bVal || '').localeCompare(aVal || '');
                    }
                    return scriptSortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
                  })
                : [];

              const sortArrow = (key) => scriptSortConfig.key === key ? (scriptSortConfig.direction === 'asc' ? ' ↑' : ' ↓') : '';

              return (
                <div className="portfolio-section fade-in">
                  {/* Search Bar */}
                  <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
                    <h2 className="section-title" style={{ marginBottom: '1rem' }}>
                      <span>🔎</span> Script Search
                      <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.75rem' }}>
                        Find all clients holding open positions in a script
                      </span>
                    </h2>
                    <div style={{ position: 'relative', maxWidth: '450px' }}>
                      <input
                        type="text"
                        className="search-input"
                        placeholder="Type a symbol (e.g. RELIANCE, TCS, INFY)…"
                        value={scriptSearch}
                        onChange={e => handleScriptSearchChange(e.target.value)}
                        style={{ width: '100%', fontSize: '1rem', padding: '0.7rem 1rem' }}
                      />
                      {scriptSuggestions.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                          background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                          borderRadius: '0 0 10px 10px', maxHeight: '280px', overflowY: 'auto',
                          boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                        }}>
                          {scriptSuggestions.map(s => (
                            <div
                              key={s.symbol}
                              onClick={() => selectScript(s.symbol)}
                              style={{
                                padding: '0.65rem 1rem', cursor: 'pointer', display: 'flex',
                                justifyContent: 'space-between', alignItems: 'center',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <span style={{ fontWeight: 700, color: '#f8fafc', letterSpacing: '0.02em' }}>{s.symbol}</span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.txns} deals</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Loading / Error */}
                  {scriptLoading && (
                    <div className="loading-container"><div className="spinner"></div><p>Analyzing {scriptSelectedSymbol}…</p></div>
                  )}
                  {scriptError && (
                    <div className="alert-item" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', margin: '1.5rem' }}>
                      <p style={{ color: '#f87171' }}>⚠️ {scriptError}</p>
                    </div>
                  )}

                  {/* Results */}
                  {scriptData && !scriptLoading && (
                    <div style={{ padding: '1rem 1.5rem' }}>
                      {/* Summary Cards */}
                      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                        <div style={{ padding: '0.75rem 1.25rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '10px', minWidth: '140px' }}>
                          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6ee7b7', marginBottom: '0.25rem' }}>Symbol</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10b981' }}>{scriptData.symbol}</div>
                        </div>
                        <div style={{ padding: '0.75rem 1.25rem', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '10px', minWidth: '140px' }}>
                          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#93c5fd', marginBottom: '0.25rem' }}>Clients Holding</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#60a5fa' }}>{scriptData.summary.totalClients}</div>
                        </div>
                        <div style={{ padding: '0.75rem 1.25rem', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '10px', minWidth: '140px' }}>
                          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#c4b5fd', marginBottom: '0.25rem' }}>Total Open Qty</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#a78bfa' }}>{formatNum(scriptData.summary.totalOpenQty)}</div>
                        </div>
                        <div style={{ padding: '0.75rem 1.25rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '10px', minWidth: '140px' }}>
                          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fcd34d', marginBottom: '0.25rem' }}>Open Value</div>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f59e0b' }}>{formatCr(scriptData.summary.totalOpenValueCr)}</div>
                        </div>
                      </div>

                      {/* Clients Table */}
                      {sortedClients.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
                          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
                          <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>No open positions found</p>
                          <p style={{ fontSize: '0.82rem' }}>All clients have fully exited their positions in {scriptData.symbol}.</p>
                        </div>
                      ) : (
                        <div className="leaderboard-table-wrap">
                          <table className="leaderboard-table">
                            <thead>
                              <tr>
                                <th style={{ width: '30px' }}></th>
                                <th onClick={() => handleScriptSort('client')} style={{ cursor: 'pointer' }}>Client{sortArrow('client')}</th>
                                <th onClick={() => handleScriptSort('totalOpenQty')} style={{ textAlign: 'right', cursor: 'pointer' }}>Shares Held{sortArrow('totalOpenQty')}</th>
                                <th onClick={() => handleScriptSort('avgBuyPrice')} style={{ textAlign: 'right', cursor: 'pointer' }}>Avg Buy Price{sortArrow('avgBuyPrice')}</th>
                                <th onClick={() => handleScriptSort('valueAtCost')} style={{ textAlign: 'right', cursor: 'pointer' }}>Value (Cr){sortArrow('valueAtCost')}</th>
                                <th onClick={() => handleScriptSort('totalBought')} style={{ textAlign: 'right', cursor: 'pointer' }}>Total Bought{sortArrow('totalBought')}</th>
                                <th onClick={() => handleScriptSort('totalSold')} style={{ textAlign: 'right', cursor: 'pointer' }}>Total Sold{sortArrow('totalSold')}</th>
                                <th style={{ textAlign: 'center' }}>Held Since</th>
                              </tr>
                            </thead>
                            {sortedClients.map((c, i) => {
                              const isExpanded = scriptExpandedClient === c.client;
                              return (
                                <tbody key={c.client}>
                                  <tr
                                    onClick={() => setScriptExpandedClient(isExpanded ? null : c.client)}
                                    style={{
                                      cursor: 'pointer',
                                      borderLeft: '3px solid #10b981',
                                      background: isExpanded ? 'rgba(255,255,255,0.04)' : '',
                                      transition: 'background 0.15s',
                                    }}
                                    className="row-buy"
                                  >
                                    <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                      {isExpanded ? '▼' : '▶'}
                                    </td>
                                    <td style={{ fontWeight: 700, color: '#f8fafc', maxWidth: '300px' }}>{c.client}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#10b981', fontSize: '0.95rem' }}>
                                      {formatNum(c.totalOpenQty)}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>{formatPrice(c.avgBuyPrice)}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCr(c.valueAtCost)}</td>
                                    <td style={{ textAlign: 'right' }}>{formatNum(c.totalBought)}</td>
                                    <td style={{ textAlign: 'right', color: c.totalSold > 0 ? 'var(--color-sell)' : 'var(--text-muted)' }}>
                                      {c.totalSold > 0 ? formatNum(c.totalSold) : '–'}
                                    </td>
                                    <td style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{c.heldSince || '–'}</td>
                                  </tr>

                                  {/* Expanded: Transaction History */}
                                  {isExpanded && c.transactions && (
                                    <tr className="expanded-row">
                                      <td colSpan="8" style={{ padding: '0.75rem 1rem 1rem', background: 'rgba(0,0,0,0.2)' }}>
                                        <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', paddingLeft: '0.5rem' }}>
                                          Transaction History — {c.client} — {c.transactions.length} records
                                        </div>
                                        <table className="leaderboard-table" style={{ background: 'var(--bg-card)' }}>
                                          <thead>
                                            <tr>
                                              <th>Date</th>
                                              <th>Type</th>
                                              <th>Action</th>
                                              <th style={{ textAlign: 'right' }}>Quantity</th>
                                              <th style={{ textAlign: 'right' }}>Price (₹)</th>
                                              <th style={{ textAlign: 'right' }}>Value</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {c.transactions.map((tx, idx) => (
                                              <tr
                                                key={idx}
                                                style={{ borderLeft: tx.buy_sell === 'SELL' ? '3px solid var(--color-sell)' : '3px solid var(--color-buy)' }}
                                                className={tx.buy_sell === 'SELL' ? 'row-sell' : 'row-buy'}
                                              >
                                                <td className="col-date">{tx.date}</td>
                                                <td>
                                                  <span className="badge symbol" style={{
                                                    background: tx.type === 'block' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)',
                                                    color: tx.type === 'block' ? '#60a5fa' : '#c084fc',
                                                    fontSize: '0.7rem'
                                                  }}>{tx.type?.toUpperCase()}</span>
                                                </td>
                                                <td><span className={`badge ${tx.buy_sell === 'BUY' ? 'buy' : 'sell'}`}>{tx.buy_sell}</span></td>
                                                <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatNum(tx.quantity)}</td>
                                                <td style={{ textAlign: 'right' }}>{formatPrice(tx.price)}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCr(tx.value_cr)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              );
                            })}
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Empty state */}
                  {!scriptData && !scriptLoading && !scriptError && (
                    <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--text-secondary)' }}>
                      <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🔎</div>
                      <p style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Search for a script</p>
                      <p style={{ fontSize: '0.85rem' }}>Type a symbol above to find all clients with open positions.</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
