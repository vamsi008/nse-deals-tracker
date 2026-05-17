# Institutional Conviction Dashboard: Technical Specification

---

## 1. Overview

The **Conviction Dashboard** is a high-alpha analysis layer sitting on top of the raw transaction data. Its primary purpose is to distinguish between:

- **Strategic Accumulation** — Mutual Funds / FIIs
- **Market Liquidity** — HFT / Algorithmic Churn

---

## 2. Data Processing Layer — The "Conviction Engine"

Since your data is currently in JSON format, the frontend or a middleware service must perform the following transformations on the `transactions` array.

---

### A. Client Categorization Logic

Map clients into **"Archetypes"** to apply different weights:

| Archetype | Condition | Examples |
|---|---|---|
| **Strategic** | `Trade Count < 100` && `Open Value > ₹500Cr` | SBI Mutual Fund, HDFC MF |
| **High-Frequency (HFT)** | `Trade Count > 500` && `Net Qty / Total Qty < 10%` | Graviton, HRTI |
| **Whale / HNI** | Individual names with high single-day value | — |

---

### B. Core Metrics Calculation

For every unique `SYMBOL` in the JSON, calculate the following:

#### 🔷 Institutional Floor (Strong Hand VWAP)

```
Formula:   Sum(Block Deal Value) / Sum(Block Deal Quantity)
Constraint: Only include transactions where TYPE === 'BLOCK'
```

#### 🔷 Net Inventory Residue (For HFTs)

```
Formula: Sum(Buy Qty) - Sum(Sell Qty)
Signal:  If Residue > 0 for 3 consecutive days → mark as "Algorithmic Accumulation"
```

#### 🔷 Conviction Score (Scale: 1–10)

| Event | Score Impact |
|---|---|
| Every unique **"Strategic"** client buying | `+2 points` |
| **"Dual-Window Entry"** — Bulk + Block by same client | `+3 points` |
| **"Reversal Alert"** — Net Buy → Net Sell in last 7 days | `-5 points` |

---

## 3. UI / Tab Structure — `ConvictionDashboard.jsx`

### Tab Layout Components

---

### I. Conviction "Power Ranking" Table

> Primary view — replaces raw trade list with summarized intelligence.

| Column | Logic | Visual Indicator |
|---|---|---|
| **Symbol** | Ticker Name | 🟢 Green dot if `CMP < Institutional Floor` |
| **Conviction Score** | 1–10 scale | Progress bar (Red → Green) |
| **Strategic Buyers** | Count of unique MFs / FIIs | Tooltip listing names (SBI, ICICI, etc.) |
| **Strong Hand Floor** | Block Deal VWAP | Bold currency format |
| **% from Floor** | `(CMP - Floor) / Floor * 100` | Highlight if `< 2%` |

---

### II. "The SBI Mirror" Widget (Sidebar)

A specialized list tracking the fund house with the highest success rate in your tracker.

```
Logic:  Filter JSON for CLIENT === 'SBI MUTUAL FUND'
Action: Only show SYMBOLS where SBI is "Net Buy" in the last 30 days
        AND has NOT triggered a "Reversal Alert"
```

---

### III. Institutional Handover Alert

A notification feed for specific high-value events.

```
Pattern: Action: SELL by a Promoter
         + Action: BUY by 2+ Strategic clients in the same price range
```

---

## 4. Implementation Prompt for Code Generation

> Use this prompt in an AI-assisted IDE (Cursor, GitHub Copilot, etc.)

---

```
Act as a React and Data Science expert.

Create a new Tab component: ConvictionDashboard.jsx

DATA:
  The component should accept the `transactions` JSON as a prop.

LOGIC:
  Implement a helper function analyzeConviction(data) that calculates the
  Volume Weighted Average Price (VWAP) for only 'BLOCK' deals per symbol.
  This is the 'Institutional Floor'.

FILTERING:
  Exclude HFT firms (Graviton / HRTI) from the Conviction Score
  if their buy/sell ratio is nearly 1:1.

TABLE:
  Render a table showing:
    - Symbols
    - Conviction Scores (calculated based on number of distinct Mutual Funds buying)
    - Distance between current price and the Institutional Floor

STYLING:
  Use Tailwind CSS.
  Highlight tickers in green if they are currently trading at a discount
  to the Strong Hand average price.
```

---

## 5. JSON Field Mapping

Ensure your logic maps your current JSON fields as follows:

| JSON Field | Role in Engine |
|---|---|
| `SYMBOL` | Grouping key |
| `TYPE` | Filter for `BLOCK` vs `BULK` |
| `CLIENT` | Cross-reference with "Strategic" client list |
| `VALUE` | Weight for Conviction Score calculation |

---

## 6. Helper Function Skeleton (JavaScript / TypeScript)

```typescript
/**
 * analyzeConviction
 * Parses raw transactions JSON and returns per-symbol conviction metrics.
 */
function analyzeConviction(transactions: Transaction[]) {
  const symbolMap: Record<string, SymbolMetrics> = {};

  const STRATEGIC_CLIENTS = ["SBI MUTUAL FUND", "HDFC MF", "ICICI PRUDENTIAL", "AXIS MF"];
  const HFT_CLIENTS       = ["GRAVITON", "HRTI"];

  for (const tx of transactions) {
    const { SYMBOL, TYPE, CLIENT, VALUE, BUY_QTY, SELL_QTY, QUANTITY } = tx;

    if (!symbolMap[SYMBOL]) {
      symbolMap[SYMBOL] = {
        blockValueSum:    0,
        blockQtySum:      0,
        convictionScore:  0,
        strategicBuyers:  new Set(),
        dualWindowClients: new Set(),
        reversalAlert:    false,
      };
    }

    const entry = symbolMap[SYMBOL];

    // ── Institutional Floor (Block VWAP) ──────────────────────────────────
    if (TYPE === "BLOCK") {
      entry.blockValueSum += VALUE;
      entry.blockQtySum   += QUANTITY;
    }

    // ── Exclude HFTs from Conviction Score ───────────────────────────────
    const isHFT = HFT_CLIENTS.some(h => CLIENT.toUpperCase().includes(h));
    const netRatio = Math.abs(BUY_QTY - SELL_QTY) / (BUY_QTY + SELL_QTY);
    if (isHFT && netRatio < 0.10) continue;

    // ── Strategic Buyer Score (+2 per unique Strategic client) ───────────
    const isStrategic = STRATEGIC_CLIENTS.some(s => CLIENT.toUpperCase().includes(s));
    if (isStrategic && BUY_QTY > SELL_QTY) {
      if (!entry.strategicBuyers.has(CLIENT)) {
        entry.strategicBuyers.add(CLIENT);
        entry.convictionScore += 2;
      }
    }
  }

  // ── Institutional Floor & Final Output ───────────────────────────────────
  return Object.entries(symbolMap).map(([symbol, m]) => ({
    symbol,
    institutionalFloor: m.blockQtySum > 0 ? m.blockValueSum / m.blockQtySum : null,
    convictionScore:    Math.min(10, Math.max(0, m.convictionScore)),
    strategicBuyers:   [...m.strategicBuyers],
  }));
}
```

---

## 7. Conviction Score Reference Card

```
┌─────────────────────────────────────────────────────────┐
│              CONVICTION SCORE QUICK REFERENCE            │
├──────────────────────────────────┬──────────────────────┤
│  Event                           │  Score Delta         │
├──────────────────────────────────┼──────────────────────┤
│  Unique Strategic MF/FII buying  │  +2 per client       │
│  Dual-Window Entry (Bulk+Block)  │  +3                  │
│  Reversal Alert (last 7 days)    │  -5                  │
├──────────────────────────────────┼──────────────────────┤
│  Score 8–10  →  STRONG BUY       │  🟢                  │
│  Score 5–7   →  ACCUMULATE       │  🟡                  │
│  Score 1–4   →  WATCH            │  🟠                  │
│  Score < 0   →  AVOID            │  🔴                  │
└──────────────────────────────────┴──────────────────────┘
```

---

*Last updated: May 2026 | Version 1.0*
