#!/usr/bin/env node
/**
 * Daily updater for GitHub Actions.
 * - Fetches MetalpriceAPI /latest
 * - Appends a single row for today's UTC date into data/series.json
 * - Updates data/meta.json
 *
 * Requires:
 *   METALPRICE_API_KEY (GitHub Actions secret)
 * Optional:
 *   METALPRICE_BASE (default USD)
 *   METALPRICE_METALS (comma list, default XCU,XAU,XAG,ALU,XPD,XPT)
 */

import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.METALPRICE_API_KEY;
if (!API_KEY) {
  console.error("Missing METALPRICE_API_KEY env var (set it as a GitHub Actions secret).");
  process.exit(1);
}

const BASE = (process.env.METALPRICE_BASE || "USD").toUpperCase();
const METALS = (process.env.METALPRICE_METALS || "XCU,XAU,XAG,ALU,XPD,XPT")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const SERIES_PATH = path.join("data", "series.json");
const META_PATH = path.join("data", "meta.json");

function todayUtcDateString() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nowUtcTimestamp() {
  return new Date().toISOString().replace("T", " ").replace("Z", "Z");
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function validateRates(rates) {
  for (const k of METALS) {
    const v = rates?.[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new Error(`Bad rate for ${k}: ${v}`);
    }
  }
}

async function fetchLatest() {
  const url = new URL("https://api.metalpriceapi.com/v1/latest");
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("base", BASE);
  url.searchParams.set("currencies", METALS.join(","));

  const res = await fetch(url, {
    headers: {
      "User-Agent": "metals-dashboard (github actions)"
    }
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from MetalpriceAPI: ${t.slice(0, 400)}`);
  }

  const json = await res.json();
  // Expected: { success, base, rates: { XAU: number, ... }, timestamp? }
  const rates = json?.rates;
  validateRates(rates);

  return { base: (json?.base || BASE).toUpperCase(), rates, raw: json };
}

function appendOrReplaceRow(series, date, rates) {
  const rows = Array.isArray(series.rows) ? series.rows : [];
  const idx = rows.findIndex((r) => r.date === date);

  const row = { date, rates };
  if (idx >= 0) rows[idx] = row;
  else rows.push(row);

  rows.sort((a, b) => a.date.localeCompare(b.date));
  series.rows = rows;
}

async function main() {
  const date = todayUtcDateString();

  const series = fs.existsSync(SERIES_PATH)
    ? readJson(SERIES_PATH)
    : { base: BASE, metals: METALS, rows: [] };

  const meta = fs.existsSync(META_PATH)
    ? readJson(META_PATH)
    : { last_updated_utc: null, source: "MetalpriceAPI" };

  const latest = await fetchLatest();

  series.base = latest.base;
  series.metals = METALS;
  appendOrReplaceRow(series, date, latest.rates);

  meta.last_updated_utc = nowUtcTimestamp();
  meta.base = latest.base;
  meta.metals = METALS;

  writeJson(SERIES_PATH, series);
  writeJson(META_PATH, meta);

  console.log(`Updated ${SERIES_PATH} for ${date} (${METALS.join(", ")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
