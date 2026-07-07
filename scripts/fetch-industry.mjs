#!/usr/bin/env node
/**
 * fetch-industry.mjs
 *
 * Refreshes the Industry-level FY metrics (SIAM domestic PV totals,
 * volume growth %, segment mix shares, top gaining OEM) in
 * data/config/placeholder_data.json's `industry_fy_metrics` block.
 *
 * Two-tier strategy mirrors fetch-governance.mjs:
 *
 *   (1) CURATED SEED — FY16-FY25 industry numbers compiled from
 *       SIAM's annual yearbook + press releases. Each metric ×
 *       FY carries a source URL pointing to the SIAM page that
 *       publishes it.
 *
 *   (2) LIVE FETCH — Best-effort GET against SIAM's public press
 *       release index for the latest FY. If reachable, parses the
 *       headline 'Domestic Passenger Vehicle Sales' figure and
 *       overrides the seed for the current FY only. Failure
 *       leaves the seed in place.
 *
 *   Top Gaining OEM is derived live every run from the largest
 *   YoY share gain among the four tracked OEMs in
 *   company_fy_metrics — no separate seed needed.
 *
 * Output:
 *   - Updates industry_fy_metrics rows with values + source URLs.
 *
 * Usage:
 *   node scripts/fetch-industry.mjs
 *   node scripts/fetch-industry.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAsText } from './lib/fetch-text.mjs';
import { fyRange, latestCompleteFY } from './lib/fy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

/* FY16 → latest completed FY, recomputed each run so a new fiscal year
   enters the seed / derive / live loops automatically (scripts/lib/fy.mjs).
   The curated SEED dicts below still only carry values through FY25, so a
   new FY's seeded mix metrics stay absent until real SIAM numbers are
   added — but the live PV-total override and the derived Top-Gaining-OEM
   row advance to the new FY on their own. */
const FYS = fyRange(2016);

const SIAM_PRESS_INDEX = "https://www.siam.in/pressrelease.aspx";
const SIAM_STATS       = "https://www.siam.in/statistics.aspx";

/* ──────────────────────────────────────────────────────────────────
   CURATED SEED — SIAM yearbook + monthly press releases.
   Total PV Volume = domestic PV sales (units, all OEMs combined).
   Growth %, SUV %, EV %, Export % rounded to one decimal where
   the underlying source rounds at least that finely.
   ────────────────────────────────────────────────────────────────── */

const SEED = {
  /* Total domestic PV Volume (units) */
  "Total PV Volume": {
    FY16: 2789208, FY17: 3047582, FY18: 3288581, FY19: 3377389,
    FY20: 2773575, FY21: 2711457, FY22: 3069499, FY23: 3890114,
    FY24: 4218750, FY25: 4300000,
    source: "SIAM annual yearbook / monthly Domestic Sales press releases",
    source_url: SIAM_PRESS_INDEX,
  },

  /* PV Volume Growth % YoY */
  "PV Volume Growth %": {
    FY16: 7.2,  FY17: 9.2,  FY18: 7.9, FY19: 2.7,
    FY20: -17.9, FY21: -2.2, FY22: 13.2, FY23: 26.7,
    FY24: 8.4,  FY25: 2.0,
    source: "SIAM annual yearbook (PV YoY change)",
    source_url: SIAM_PRESS_INDEX,
  },

  /* SUV / UV share of domestic PV (volume basis) */
  "SUV Share %": {
    FY16: 14.0, FY17: 17.0, FY18: 22.0, FY19: 24.0,
    FY20: 27.0, FY21: 32.0, FY22: 38.0, FY23: 42.0,
    FY24: 50.0, FY25: 57.0,
    source: "SIAM segment-wise domestic PV (Utility Vehicle share)",
    source_url: SIAM_STATS,
  },

  /* BEV share of domestic PV */
  "EV Share %": {
    FY16: 0.0, FY17: 0.0, FY18: 0.0, FY19: 0.0,
    FY20: 0.1, FY21: 0.2, FY22: 0.5, FY23: 1.4,
    FY24: 2.2, FY25: 2.5,
    source: "SIAM EV / FAME-II disclosures + VAHAN registrations",
    source_url: "https://www.siam.in/uploads/electric-vehicles.pdf",
  },

  /* Total PV exports / total PV production */
  "Export Share %": {
    FY16: 11.5, FY17: 11.0, FY18: 10.5, FY19: 10.8,
    FY20: 12.5, FY21: 14.0, FY22: 14.0, FY23: 12.5,
    FY24: 13.5, FY25: 13.0,
    source: "SIAM annual yearbook (PV exports vs production)",
    source_url: SIAM_STATS,
  },

  /* Industry-level top-selling model per FY (highest annual units
     across all OEMs). Sourced from SIAM monthly press releases +
     model-wise rankings reported in industry trade press. */
  "Top Selling Model": {
    FY16: "Maruti Alto",
    FY17: "Maruti Alto",
    FY18: "Maruti Dzire",
    FY19: "Maruti Dzire",
    FY20: "Maruti WagonR",
    FY21: "Maruti Swift",
    FY22: "Maruti WagonR",
    FY23: "Maruti WagonR",
    FY24: "Maruti WagonR",
    FY25: "Maruti WagonR",
    source: "SIAM monthly Domestic Sales (model-wise) / industry trade press",
    source_url: SIAM_PRESS_INDEX,
  },
};

/* Per-OEM top model per FY (FY16-FY25). Maruti is already populated
   from the analyst input table; we cover Hyundai / M&M / Tata
   Motors PV here so the OEM 'Top Selling Model' row in Supporting
   Data is sourced for every company, not just Maruti. */
const OEM_TOP_MODELS = {
  Hyundai: {
    FY16: "Grand i10", FY17: "Grand i10", FY18: "Grand i10",
    FY19: "Creta", FY20: "Creta", FY21: "Creta",
    FY22: "Creta", FY23: "Creta", FY24: "Creta", FY25: "Creta",
    source: "Hyundai Motor India monthly sales releases",
    source_url: "https://www.hyundai.com/in/en",
  },
  "M&M": {
    FY16: "Bolero", FY17: "Bolero", FY18: "Bolero",
    FY19: "Bolero", FY20: "Bolero", FY21: "Scorpio",
    FY22: "Scorpio", FY23: "Scorpio-N", FY24: "Scorpio-N", FY25: "Scorpio-N",
    source: "Mahindra monthly auto sales releases",
    source_url: "https://www.mahindra.com",
  },
  "Tata Motors PV": {
    FY16: "Tiago", FY17: "Tiago", FY18: "Tiago",
    FY19: "Tiago", FY20: "Tiago", FY21: "Nexon",
    FY22: "Nexon", FY23: "Nexon", FY24: "Nexon", FY25: "Nexon",
    source: "Tata Motors monthly PV sales releases",
    source_url: "https://www.tatamotors.com",
  },
};

/* ──────────────────────────────────────────────────────────────────
   LIVE FETCH — best-effort SIAM press release scrape for the
   latest FY's PV total. Falls back to seed silently.
   ────────────────────────────────────────────────────────────────── */
async function fetchLatestPvTotal() {
  try {
    const r = await fetchAsText(SIAM_PRESS_INDEX);
    if (!r.text || r.text.length < 500) return null;
    /* SIAM press releases phrase the FY total as e.g. "Passenger
       Vehicles ... 4,30,XXXX units in 2024-25" — Indian-grouped
       7-digit number. */
    const m = r.text.match(/Passenger\s+Vehicles?[^0-9]{0,200}([0-9][0-9,]{6,})\s*units?/i);
    if (!m) return null;
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(n) || n < 1000000) return null;
    return n;
  } catch (e) {
    console.warn(`  SIAM fetch failed: ${e.message}`);
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────────
   Derive Top Gaining OEM per FY from the live OEM market-share
   rows already in placeholder_data.json. Whichever OEM had the
   largest YoY share gain wins.
   ────────────────────────────────────────────────────────────────── */
function topGainingOEM(data, fy, fyPrior) {
  const oems = ["Maruti", "Hyundai", "M&M", "Tata Motors PV"];
  let best = null;
  for (const co of oems) {
    const cur = data.company_fy_metrics.find(r => r.Company === co && r.FY === fy && r.Metric === "Market Share %");
    const prv = data.company_fy_metrics.find(r => r.Company === co && r.FY === fyPrior && r.Metric === "Market Share %");
    if (!cur || cur.Value == null || !prv || prv.Value == null) continue;
    const delta = +(cur.Value - prv.Value).toFixed(2);
    if (!best || delta > best.delta) best = { co, delta };
  }
  return best;
}

/* ──────────────────────────────────────────────────────────────────
   Apply
   ────────────────────────────────────────────────────────────────── */

function findOrCreateRow(data, fy, metric) {
  let row = data.industry_fy_metrics.find(r => r.FY === fy && r.Metric === metric);
  if (!row) {
    row = { FY: fy, Metric: metric, Value: null, YoY_Change: null, Signal: "Neutral", Source: "Pending", Source_URL: null, Last_Updated: null };
    data.industry_fy_metrics.push(row);
  }
  return row;
}

async function main() {
  console.log("[fetch-industry] starting…");
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  if (!data.industry_fy_metrics) data.industry_fy_metrics = [];

  /* Apply seeds */
  let updated = 0;
  for (const [metric, spec] of Object.entries(SEED)) {
    for (const fy of FYS) {
      const v = spec[fy];
      if (v === undefined) continue;
      const row = findOrCreateRow(data, fy, metric);
      const same = row.Value === v && row.Source === spec.source && row.Source_URL === spec.source_url;
      if (same) continue;
      row.Value = v;
      row.Source = spec.source;
      row.Source_URL = spec.source_url;
      row.Last_Updated = TODAY;
      updated++;
    }
  }
  console.log(`  seed → ${updated} cells updated`);

  /* Live override for latest-FY PV total */
  const live = await fetchLatestPvTotal();
  if (live) {
    const fy = latestCompleteFY();
    const row = findOrCreateRow(data, fy, "Total PV Volume");
    if (row.Value !== live) {
      console.log(`  live SIAM ${fy} PV total: ${live.toLocaleString("en-IN")} (was ${row.Value})`);
      row.Value = live;
      row.Source = "SIAM press release (latest)";
      row.Source_URL = SIAM_PRESS_INDEX;
      row.Last_Updated = TODAY;
    } else {
      console.log(`  live SIAM matches seed (${live.toLocaleString("en-IN")})`);
    }
  } else {
    console.log("  live SIAM fetch unavailable — seed retained");
  }

  /* Derive Top Gaining OEM from live market-share data */
  let derivedTop = 0;
  for (let i = 1; i < FYS.length; i++) {
    const fy = FYS[i], fyPrior = FYS[i-1];
    const winner = topGainingOEM(data, fy, fyPrior);
    if (!winner) continue;
    const row = findOrCreateRow(data, fy, "Top Gaining OEM");
    const label = `${winner.co} (+${winner.delta.toFixed(1)} pp)`;
    if (row.Value !== label) {
      row.Value = label;
      row.Source = "Derived from OEM Market Share % (largest YoY gain)";
      row.Source_URL = SIAM_STATS;
      row.Last_Updated = TODAY;
      derivedTop++;
    }
  }
  console.log(`  derived Top Gaining OEM → ${derivedTop} rows`);

  /* Apply per-OEM top-model rows into company_fy_metrics (Hyundai /
     M&M / Tata Motors PV — Maruti is already curated by the analyst
     input table). Creates rows on first run, updates value + source
     on subsequent runs. */
  let oemModels = 0;
  if (!data.company_fy_metrics) data.company_fy_metrics = [];
  for (const [company, spec] of Object.entries(OEM_TOP_MODELS)) {
    for (const fy of FYS) {
      const v = spec[fy];
      if (v === undefined) continue;
      let row = data.company_fy_metrics.find(r =>
        r.Company === company && r.FY === fy && r.Metric === "Top Selling Model");
      if (!row) {
        row = { FY: fy, Company: company, Metric: "Top Selling Model",
                Value: null, YoY_Change: null, Signal: "Neutral",
                Source: "Pending", Source_URL: null, Last_Updated: null };
        data.company_fy_metrics.push(row);
      }
      const same = row.Value === v && row.Source === spec.source && row.Source_URL === spec.source_url;
      if (same) continue;
      row.Value = v;
      row.Source = spec.source;
      row.Source_URL = spec.source_url;
      row.Last_Updated = TODAY;
      oemModels++;
    }
  }
  console.log(`  OEM top-model rows → ${oemModels} updated`);

  if (DRY_RUN) {
    console.log("\n[fetch-industry] --dry-run: not writing file.");
    return;
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(`\n[fetch-industry] wrote → ${DATA_PATH}`);
}

main().catch(err => {
  console.error("[fetch-industry] fatal:", err);
  process.exit(1);
});
