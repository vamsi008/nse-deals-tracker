/**
 * Simple Express backend for NSE Deals Tracker
 *
 * GET  /api/deals    → return contents of public/deals.json
 * POST /api/refresh  → run fetch_nse_real.py (incremental) and return updated data
 * GET  /api/status   → check if a fetch is currently running
 */

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadDeals() {
  if (!existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/deals — serve current deals.json */
app.get("/api/deals", (_req, res) => {
  const deals = loadDeals();
  res.json(deals);
});

/** GET /api/status — whether a background fetch is running */
app.get("/api/status", (_req, res) => {
  res.json({ running: fetchRunning, log: fetchLog.slice(-50) });
});

/** POST /api/refresh — trigger incremental Python fetch */
app.post("/api/refresh", (_req, res) => {
  if (fetchRunning) {
    return res.status(409).json({ error: "Fetch already in progress", running: true });
  }

  fetchRunning = true;
  fetchLog     = [];

  // Determine python executable (venv or system)
  const pythonExe = existsSync(join(__dirname, "venv", "Scripts", "python.exe"))
    ? join(__dirname, "venv", "Scripts", "python.exe")
    : "python";

  const script = join(__dirname, "fetch_nse_real.py");

  const child = spawn(pythonExe, [script], {
    cwd: __dirname,
    env: { ...process.env },
  });

  child.stdout.on("data", (d) => {
    const line = d.toString().trim();
    fetchLog.push(line);
    console.log("[fetch]", line);
  });
  child.stderr.on("data", (d) => {
    const line = d.toString().trim();
    fetchLog.push("ERR: " + line);
    console.error("[fetch]", line);
  });

  child.on("close", (code) => {
    fetchRunning = false;
    console.log(`[fetch] done (exit ${code})`);
  });

  // Respond immediately — client can poll /api/status or /api/deals
  res.json({ started: true, message: "Incremental fetch started. Poll /api/status for progress." });
});

/** POST /api/upload-csv — accept CSV and trigger merge */
app.post("/api/upload-csv", (req, res) => {
  const type = req.query.type || "bulk";
  if (!req.body || typeof req.body !== 'string') {
    return res.status(400).json({ error: "Missing CSV body" });
  }
  const tmpPath = join(__dirname, `tmp_${Date.now()}.csv`);
  try {
    writeFileSync(tmpPath, req.body);
    const pythonExe = existsSync(join(__dirname, "venv", "Scripts", "python.exe"))
      ? join(__dirname, "venv", "Scripts", "python.exe")
      : "python";
    const script = join(__dirname, "merge_uploaded_csv.py");
    const child = spawn(pythonExe, [script, tmpPath, type], { cwd: __dirname });
    
    child.stdout.on("data", d => console.log("[upload]", d.toString().trim()));
    child.stderr.on("data", d => console.error("[upload ERR]", d.toString().trim()));
    
    child.on("close", (code) => {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
      res.json({ success: code === 0 });
    });
  } catch (err) {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 NSE backend running on http://localhost:${PORT}`);
  console.log(`   GET  /api/deals   → serve deals.json`);
  console.log(`   POST /api/refresh → trigger incremental fetch`);
  console.log(`   GET  /api/status  → fetch progress\n`);
});
