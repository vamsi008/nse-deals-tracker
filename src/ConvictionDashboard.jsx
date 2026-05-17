import React, { useMemo, useState } from 'react';

/**
 * ConvictionDashboard Component
 * Renders summarized institutional intelligence based on transaction data.
 */
export default function ConvictionDashboard({ transactions, preCalculatedAnalysis }) {
  const [expandedSymbol, setExpandedSymbol] = useState(null);

  const analysis = useMemo(() => {
    if (preCalculatedAnalysis) return preCalculatedAnalysis;
    if (!transactions || transactions.length === 0) return [];

    const STRATEGIC_CLIENTS = [
      "SBI MUTUAL FUND", "HDFC MF", "ICICI PRUDENTIAL", "AXIS MF",
      "KOTAK MUTUAL FUND", "NIPPON INDIA", "UTI MF", "ADITYA BIRLA SUN LIFE",
      "SOCIETE GENERALE", "GOLDMAN SACHS", "MORGAN STANLEY", "BNP PARIBAS"
    ];
    const HFT_CLIENTS = ["GRAVITON", "HRTI", "NK SECURITIES", "QE SECURITIES", "MICROCURVES", "TOWER RESEARCH"];

    const symbolMap = {};

    for (const tx of transactions) {
      const sym = tx.symbol;
      if (!symbolMap[sym]) {
        symbolMap[sym] = {
          symbol: sym,
          blockValueSum: 0,
          blockQtySum: 0,
          convictionScore: 0,
          strategicBuyers: new Set(),
          hftBuyQty: 0,
          hftSellQty: 0,
          totalBuyQty: 0,
          totalSellQty: 0,
          lastPrice: tx.price, // Approximate CMP
          dualWindowTrack: {}, // client -> set(types)
          scriptTransactions: [], // transactions for this script
          dualWindowClients: new Set()
        };
      }

      const entry = symbolMap[sym];
      const val = Number(tx.value_cr || 0);
      const qty = Number(tx.quantity || 0);
      const client = (tx.client || "").toUpperCase();

      entry.scriptTransactions.push(tx);
      if (tx.buy_sell === "BUY") entry.totalBuyQty += qty;
      else entry.totalSellQty += qty;

      // 1. Institutional Floor (Block VWAP)
      if (tx.type === "block") {
        entry.blockValueSum += val;
        entry.blockQtySum += qty;
      }

      // 2. Track for Conviction Score
      const isHFT = HFT_CLIENTS.some(h => client.includes(h));
      const isStrategic = STRATEGIC_CLIENTS.some(s => client.includes(s));

      if (isHFT) {
        if (tx.buy_sell === "BUY") entry.hftBuyQty += qty;
        else entry.hftSellQty += qty;
      }

      if (isStrategic && tx.buy_sell === "BUY") {
        if (!entry.strategicBuyers.has(tx.client)) {
          entry.strategicBuyers.add(tx.client);
          entry.convictionScore += 2;
        }
      }

      // Dual Window Tracking (Bulk + Block by same client)
      if (!entry.dualWindowTrack[tx.client]) entry.dualWindowTrack[tx.client] = new Set();
      entry.dualWindowTrack[tx.client].add(tx.type);
    }

    return Object.values(symbolMap).map(m => {
      // Add points for dual-window entries
      let dualPoints = 0;
      Object.entries(m.dualWindowTrack).forEach(([client, types]) => {
        if (types.has('bulk') && types.has('block')) {
          dualPoints += 3;
          m.dualWindowClients.add(client);
        }
      });

      const finalScore = Math.min(10, m.convictionScore + dualPoints);
      const floor = m.blockQtySum > 0 ? (m.blockValueSum * 10000000) / m.blockQtySum : null;
      const pctFromFloor = floor ? ((m.lastPrice - floor) / floor) * 100 : null;

      // Reasoning Summary
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

      const reasoning = reasons.join(" ");

      // Sort script transactions by date desc
      const sortedTxns = [...m.scriptTransactions].sort((a, b) => {
        const dateA = a.date.split('-').reverse().join('-');
        const dateB = b.date.split('-').reverse().join('-');
        return dateB.localeCompare(dateA);
      });

      return {
        symbol: m.symbol,
        score: finalScore,
        floor: floor,
        pctFromFloor: pctFromFloor,
        strategicBuyers: Array.from(m.strategicBuyers),
        lastPrice: m.lastPrice,
        txns: sortedTxns,
        reasoning: reasoning
      };
    }).sort((a, b) => b.score - a.score);
  }, [transactions]);

  const getScoreColor = (score) => {
    if (score >= 8) return '#10b981'; // Green
    if (score >= 5) return '#f59e0b'; // Orange
    if (score >= 1) return '#f97316'; // Dark Orange
    return '#ef4444'; // Red
  };

  const getScoreLabel = (score) => {
    if (score >= 8) return { text: 'STRONG BUY', icon: '🟢' };
    if (score >= 5) return { text: 'ACCUMULATE', icon: '🟡' };
    if (score >= 1) return { text: 'WATCH', icon: '🟠' };
    return { text: 'AVOID', icon: '🔴' };
  };

  const formatCr = (val) => `₹${Number(val).toFixed(2)} Cr`;
  const formatNum = (val) => {
    if (val >= 10000000) return `${(val / 10000000).toFixed(2)} Cr`;
    if (val >= 100000) return `${(val / 100000).toFixed(2)} L`;
    return val.toLocaleString("en-IN");
  };

  if (analysis.length === 0) {
    return (
      <div className="portfolio-empty-state">
        <p>No conviction data available for current selection.</p>
      </div>
    );
  }

  return (
    <div className="conviction-container fade-in">
      <div className="leaderboard-section">
        <h2 className="section-title">
          <span>🔥</span> Institutional Conviction Power Ranking
          <span className="badge-count" style={{ marginLeft: 'auto' }}>Top {analysis.length} Symbols</span>
        </h2>

        <div className="leaderboard-table-wrap">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Conviction Score</th>
                <th>Strategic Buyers</th>
                <th style={{ textAlign: 'right' }}>Inst. Floor (VWAP)</th>
                <th style={{ textAlign: 'right' }}>% from Floor</th>
                <th>Status</th>
              </tr>
            </thead>
            {analysis.map((item, idx) => {
              const label = getScoreLabel(item.score);
              const isAtFloor = item.pctFromFloor !== null && item.pctFromFloor < 2;
              const isBelowFloor = item.pctFromFloor !== null && item.pctFromFloor < 0;
              const isExpanded = expandedSymbol === item.symbol;

              return (
                <tbody key={item.symbol} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <tr
                    style={{ borderLeft: `3px solid ${getScoreColor(item.score)}`, cursor: 'pointer' }}
                    onClick={() => setExpandedSymbol(isExpanded ? null : item.symbol)}
                    className={isExpanded ? 'expanded-active-row' : ''}
                  >
                    <td style={{ fontWeight: 700, color: '#f8fafc' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.7rem', opacity: 0.6, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
                        {isBelowFloor && <span style={{ color: '#10b981', fontSize: '0.8rem' }}>●</span>}
                        {item.symbol}
                      </div>
                    </td>
                    <td>
                      <div className="win-rate-bar-wrap" style={{ minWidth: '140px' }}>
                        <div className="win-rate-bar" style={{
                          width: `${item.score * 10}%`,
                          background: getScoreColor(item.score),
                          boxShadow: `0 0 8px ${getScoreColor(item.score)}44`
                        }} />
                        <span className="win-rate-label" style={{ color: getScoreColor(item.score) }}>{item.score}/10</span>
                      </div>
                    </td>
                    <td>
                      <div className="symbol-chips">
                        {item.strategicBuyers.slice(0, 3).map(buyer => (
                          <span key={buyer} className="badge symbol" title={buyer}>
                            {buyer.split(' ')[0]}
                          </span>
                        ))}
                        {item.strategicBuyers.length > 3 && (
                          <span className="badge symbol" title={item.strategicBuyers.slice(3).join(', ')}>
                            +{item.strategicBuyers.length - 3}
                          </span>
                        )}
                        {item.strategicBuyers.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>None</span>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {item.floor ? `₹${item.floor.toFixed(2)}` : '—'}
                    </td>
                    <td style={{
                      textAlign: 'right',
                      fontWeight: 700,
                      color: isBelowFloor ? '#10b981' : (isAtFloor ? '#f59e0b' : 'var(--text-secondary)')
                    }}>
                      {item.pctFromFloor !== null ? (
                        <>
                          {item.pctFromFloor > 0 ? '+' : ''}{item.pctFromFloor.toFixed(2)}%
                          {isAtFloor && <span style={{ fontSize: '0.7rem', marginLeft: '0.3rem' }}>🎯</span>}
                        </>
                      ) : '—'}
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: `${getScoreColor(item.score)}15`,
                        color: getScoreColor(item.score),
                        borderColor: `${getScoreColor(item.score)}33`
                      }}>
                        {label.icon} {label.text}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="expanded-row-detail">
                      <td colSpan="6" style={{ padding: '0.75rem 1rem 1rem 2.5rem', background: 'rgba(0,0,0,0.15)' }}>
                        <div className="reasoning-summary fade-in" style={{
                          background: 'rgba(59, 130, 246, 0.08)',
                          border: '1px solid rgba(59, 130, 246, 0.2)',
                          borderRadius: '8px',
                          padding: '0.75rem 1rem',
                          marginBottom: '0.75rem',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.75rem'
                        }}>
                          <span style={{ fontSize: '1.2rem' }}>🧐</span>
                          <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.5' }}>
                            <strong style={{ color: '#fff', display: 'block', marginBottom: '0.2rem' }}>Conclusion Summary:</strong>
                            {item.reasoning}
                          </div>
                        </div>

                        <div className="detail-table-wrap fade-in" style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                          <table className="leaderboard-table" style={{ margin: 0, background: 'rgba(30,41,59,0.5)' }}>
                            <thead>
                              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                <th style={{ fontSize: '0.75rem', padding: '0.5rem' }}>Date</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.5rem' }}>Client Name</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.5rem' }}>Type</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.5rem' }}>Action</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.5rem', textAlign: 'right' }}>Shares</th>
                                <th style={{ fontSize: '0.75rem', padding: '0.5rem', textAlign: 'right' }}>Invested</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.txns.map((tx, tIdx) => (
                                <tr key={tIdx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                  <td style={{ fontSize: '0.8rem', opacity: 0.8 }}>{tx.date}</td>
                                  <td style={{ fontSize: '0.85rem', fontWeight: 500, color: '#e2e8f0' }}>{tx.client}</td>
                                  <td>
                                    <span className="badge symbol" style={{ fontSize: '0.7rem', background: tx.type === 'block' ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)', color: tx.type === 'block' ? '#60a5fa' : '#c084fc' }}>
                                      {tx.type?.toUpperCase()}
                                    </span>
                                  </td>
                                  <td>
                                    <span className={`badge ${tx.buy_sell === 'BUY' ? 'buy' : 'sell'}`} style={{ fontSize: '0.7rem' }}>{tx.buy_sell}</span>
                                  </td>
                                  <td style={{ fontSize: '0.8rem', textAlign: 'right', fontWeight: 600 }}>{formatNum(tx.quantity)}</td>
                                  <td style={{ fontSize: '0.8rem', textAlign: 'right', fontWeight: 600, color: tx.buy_sell === 'BUY' ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                                    {formatCr(tx.value_cr)}
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

      <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1.5rem' }}>
        <div className="card" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.05), var(--bg-card))' }}>
          <div className="card-label">Institutional Analysis</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.6' }}>
            The <strong>Institutional Floor</strong> represents the Volume Weighted Average Price (VWAP) of all Block deals.
            Tickers trading near or below this floor (indicated with <span style={{ color: '#10b981' }}>●</span>) often signify strong price support
            where big institutions entered. Conviction Score is boosted by Strategic Buyers (Mutual Funds) and Dual-Window entries.
          </p>
        </div>

        <div className="card alert" style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}>
          <div className="card-label">Strategy Tip</div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.2rem' }}>💡</span>
            <p style={{ color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 500 }}>
              Focus on symbols with Score &gt; 7 and current price within 2% of the Institutional Floor.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
