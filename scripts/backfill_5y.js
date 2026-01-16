#!/usr/bin/env node
/**
 * Optional one-time backfill to populate up to 5 years of daily data using MetalpriceAPI timeframe.
 * MetalpriceAPI allows up to ~365 days per timeframe request, so we fetch in chunks.
 *
 * Usage (locally):
 *   METALPRICE_API_KEY=... node scripts/backfill_5y.js
 *
 * Notes:
 * - This is optional. You can also just let daily updates accumulate.
 */

import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.METALPRICE_API_KEY;
const BASE = (process.env.METALPRICE_BASE || "USD").toUpperCase();
const METALS = (process.env.METALPRICE_METALS || "XCU,XAU,XAG,ALU,XPD,XPT")
  .split(",")
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

if (!API_KEY) {
  console.error("Missing METALPRICE_API_KEY env var");
  process.exit(1);
}

const SERIES_PATH = path.join("data", "series.json");
const META_PATH = path.join("data", "meta.json");

function fmt(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d, days) {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function todayUTC() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function chunkRanges(startUTC, endUTC, chunkDays = 365) {
  const ranges = [];
  let cur = startUTC;
  while (cur <= endUTC) {
    const chunkEnd = addDays(cur, chunkDays - 1);
    const realEnd = chunkEnd <= endUTC ? chunkEnd : endUTC;
    ranges.push([cur, realEnd]);
    cur = addDays(realEnd, 1);
  }
  return ranges;
}

async function fetchTimeframe(startStr, endStr) {
  const url = new URL("https://api.metalpriceapi.com/v1/timeframe");
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("base", BASE);
  url.searchParams.set("currencies", METALS.join(","));
  url.searchParams.set("start_date", startStr);
  url.searchParams.set("end_date", endStr);

  const res = await fetch(url, {
    headers: { "User-Agent": "metals-dashboard/1.0 (+GitHub Actions)" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for timeframe ${startStr}..${endStr}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function loadSeries() {
  const raw = fs.readFileSync(SERIES_PATH, "utf8");
  const obj = JSON.parse(raw);
  obj.base = obj.base || BASE;
  obj.metals = obj.metals || METALS;
  obj.rows = obj.rows || [];
  return obj;
}

function saveSeries(series) {
  fs.writeFileSync(SERIES_PATH, JSON.stringify(series, null, 2) + "\n", "utf8");
}

function saveMeta(meta) {
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

function mergeRows(existingRows, newRows) {
  const byDate = new Map(existingRows.map(r => [r.date, r]));
  for (const r of newRows) byDate.set(r.date, r);
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
  const end = todayUTC();
  const start = addDays(end, -365 * 5);

  console.log(`Backfilling ${fmt(start)} to ${fmt(end)} (${METALS.join(",")}, base=${BASE})`);

  const ranges = chunkRanges(start, end, 365);
  const allRows = [];

  for (const [a, b] of ranges) {
    const startStr = fmt(a);
    const endStr = fmt(b);
    console.log(`Fetching ${startStr}..${endStr}`);

    const data = await fetchTimeframe(startStr, endStr);

    // Expected shapes seen in common market APIs:
    // { success: true, timeframe: true, start_date, end_date, base, rates: { '2026-01-01': {XAU:..., ...}, ... } }
    // If your provider uses a different key, adjust here.
    const ratesByDate = data.rates || data.data || null;
    if (!ratesByDate || typeof ratesByDate !== "object") {
      throw new Error(`Unexpected response shape for ${startStr}..${endStr}. Missing 'rates' object.`);
    }

    for (const [date, rates] of Object.entries(ratesByDate)) {
      if (!rates || typeof rates !== "object") continue;
      const clean = {};
      for (const m of METALS) {
        const v = rates[m];
        if (typeof v === "number" && Number.isFinite(v)) clean[m] = v;
      }
      if (Object.keys(clean).length) allRows.push({ date, rates: clean });
    }
  }

  const series = loadSeries();
  series.base = BASE;
  series.metals = METALS;
  series.rows = mergeRows(series.rows, allRows);
  saveSeries(series);

  const meta = {
    last_updated_utc: new Date().toISOString(),
    source: "MetalpriceAPI",
    base: BASE,
    metals: METALS,
    notes: "Backfill completed; daily workflow will keep appending."
  };
  saveMeta(meta);

  console.log(`Wrote ${series.rows.length} total rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
