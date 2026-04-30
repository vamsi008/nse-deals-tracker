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
          <div style={{opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s'}}>
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
            {activeTab !== "leaderboard" && activeTab !== "top10" && activeTab !== "alerts" && (
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
          </div>
        </>
      )}
    </div>
  );
}
