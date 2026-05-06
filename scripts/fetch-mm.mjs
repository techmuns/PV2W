#!/usr/bin/env node
/**
 * fetch-mm.mjs
 *
 * Mahindra & Mahindra (M&M) FY24 + FY25 — auto sales volumes and
 * financial results from official Mahindra press release pages.
 *
 * Sources (HTML, not PDF):
 *   - Monthly auto sales PR for March 2024 + March 2025
 *   - FY24 + FY25 quarterly + annual results PR
 *
 * Scope handling (per spec):
 *   - Auto-segment volumes / SUV volumes  → Scope: "Auto segment"
 *   - M&M consolidated revenue            → Scope: "Consolidated"
 *   - Auto-segment revenue (if available) → Scope: "Auto segment"
 * Don't conflate: Mahindra group revenue includes Farm Equipment +
 * Financial Services; the dashboard's M&M row should reflect Auto
 * (PV proxy), not group.
 *
 * Extracts (when present):
 *   - FY total auto volume
 *   - FY total SUV volume
 *   - Auto segment revenue (₹ Cr) — preferred for the M&M PV row
 *   - Consolidated revenue (₹ Cr) — fallback / for reference
 *   - PAT (₹ Cr)                  — segment if available
 *
 * Calculates and writes (only when inputs present):
 *   - Volume Growth % (auto)       — FY25 vs FY24
 *   - Revenue Growth %             — auto segment if both FYs available
 *   - EBITDA Margin %              — auto segment when explicit
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAsText, parseIndianInt } from './lib/fetch-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const TEXT_DIR  = path.join(__dirname, '..', 'data', 'config', 'press_text', 'mm');
const DRY_RUN   = process.argv.includes('--dry-run');

const COMPANY = 'M&M';
const SOURCES = {
  FY24: {
    sales:   'https://www.mahindra.com/news-room/press-release/mahindra-auto-sells-40631-suvs-a-13-growth-and-total-volumes-of-68413-in-march-2024',
    results: 'https://www.mahindra.com/news-room/press-release/mm-results-q4-fy24-and-fy24',
  },
  FY25: {
    sales:   'https://www.mahindra.com/news-room/press-release/en/mahindra-auto-sells-48048-SUVs-a-growth-of-18-percents-and-total-volumes-of-83894-a-growth-of-23-percents-in-march-2025',
    results: 'https://www.mahindra.com/news-room/press-release/en/mm-results-q4-fy25-and-fy25',
  },
};
const SALES_LABEL    = 'M&M monthly auto sales PR';
const RESULTS_LABEL  = 'M&M Q4 + FY results PR';

const today = () => new Date().toISOString().slice(0, 10);

/* ---------- sales-page parser ----------
   Mahindra's monthly press releases have prose like
   "Mahindra Auto sells 48,048 SUVs … total volumes of 83,894 … in March 2025".
   The page also has tables breaking out:
     Segment | March (cur) | March (prior) | YTD (cur) | YTD (prior)
   For the March release, YTD-current = full FY total. */
function parseSales(text) {
  const out = { total: null, suv: null, exports: null };
  const lines = text.split(/\r?\n/).map(l => l.trim());

  function tableRowNums(rx, lookahead = 6) {
    for (let i = 0; i < lines.length; i++) {
      if (!rx.test(lines[i])) continue;
      const buf = [];
      for (let j = i; j < Math.min(i + lookahead, lines.length); j++) {
        for (const m of lines[j].matchAll(/(\d{1,3}(?:,\d{2,3})+|\d{4,})/g)) {
          const n = parseIndianInt(m[0]);
          if (n != null && n >= 100) buf.push(n);
        }
      }
      if (buf.length >= 3) return buf;
    }
    return null;
  }

  /* Total auto = "Total Auto / Total Vehicles" rows in the table */
  const total = tableRowNums(/^(?:Total\s+(?:Auto|Vehicles|Domestic\s*\+\s*Exports))/i);
  if (total) out.total = total[2] ?? total[1] ?? null;   // YTD-current column

  /* SUV / "Utility Vehicles" or "Passenger Vehicles" row */
  const suv = tableRowNums(/^(?:Passenger\s+Vehicles|Utility\s+Vehicles|UV[s]?|SUV[s]?)\b/i);
  if (suv) out.suv = suv[2] ?? suv[1] ?? null;

  const exp = tableRowNums(/^Exports?\b/i);
  if (exp) out.exports = exp[2] ?? exp[1] ?? null;

  return out;
}

/* ---------- results-page parser ----------
   M&M's FY results press release reports both consolidated and
   auto-segment numbers. We extract both and surface them with
   distinct scopes. */
function parseResults(text) {
  const out = {
    consol_revenue: null,
    consol_pat:     null,
    auto_revenue:   null,
    auto_pat:       null,
    auto_ebitda_margin: null,
    fy_total_volume: null,
  };

  function pull(rxs) {
    for (const rx of rxs) {
      const m = text.match(rx);
      if (m) {
        const v = parseIndianInt(m[1]);
        if (v != null && v > 100) return v;
      }
    }
    return null;
  }

  out.consol_revenue = pull([
    /Consolidated\s+(?:Revenue|Total\s+Revenue|Revenue\s+from\s+Operations)\D{0,40}([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i,
  ]);
  out.consol_pat = pull([
    /Consolidated\s+(?:PAT|Profit\s+After\s+Tax|Net\s+Profit)\D{0,40}([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i,
  ]);
  out.auto_revenue = pull([
    /Auto(?:motive)?\s+(?:Segment|Sector|Business)?\s*Revenue\D{0,40}([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i,
  ]);
  out.auto_ebitda_margin = (() => {
    const m = text.match(/Auto(?:motive)?\s+(?:Segment|Sector|Business)?\s*(?:EBITDA|Operating)\s*Margin\D{0,30}(\d+(?:\.\d+)?)\s*%/i);
    return m ? parseFloat(m[1]) : null;
  })();
  return out;
}

function writeRow(data, fy, metric, value, sourceLabel, sourceUrl) {
  if (value == null) return null;
  const row = data.company_fy_metrics.find(r =>
    r.Company === COMPANY && r.FY === fy && r.Metric === metric
  );
  if (!row) return null;
  if (row.Value === value && row.Source === sourceLabel && row.Source_URL === sourceUrl) return null;
  const before = row.Value;
  row.Value = value;
  row.Source = sourceLabel;
  row.Source_URL = sourceUrl;
  row.Last_Updated = today();
  return { before, after: value };
}

function pack(value, unit, scope, label, url) {
  if (value == null) return null;
  return { value, unit, scope, source: label, source_url: url, last_updated: today() };
}

async function main() {
  console.log('[fetch-mm] starting…');
  fs.mkdirSync(TEXT_DIR, { recursive: true });

  const extracted = {};

  for (const fy of ['FY24', 'FY25']) {
    console.log(`\n=== ${fy} ===`);
    extracted[fy] = { sales: { total:null, suv:null, exports:null },
                      results: { consol_revenue:null, consol_pat:null,
                                 auto_revenue:null, auto_pat:null,
                                 auto_ebitda_margin:null } };
    try {
      const sales = await fetchAsText(SOURCES[fy].sales);
      fs.writeFileSync(path.join(TEXT_DIR, `sales_${fy}.txt`), sales.text);
      console.log(`  sales ${sales.kind} ${sales.bytes}b`);
      extracted[fy].sales = parseSales(sales.text);
      console.log(`  sales parsed:`, extracted[fy].sales);
    } catch (e) {
      console.warn(`  sales failed: ${e.message}`);
    }
    try {
      const res = await fetchAsText(SOURCES[fy].results);
      fs.writeFileSync(path.join(TEXT_DIR, `results_${fy}.txt`), res.text);
      console.log(`  results ${res.kind} ${res.bytes}b`);
      extracted[fy].results = parseResults(res.text);
      console.log(`  results parsed:`, extracted[fy].results);
    } catch (e) {
      console.warn(`  results failed: ${e.message}`);
    }
  }

  /* ---------- raw extracts ---------- */
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  raw[COMPANY] = raw[COMPANY] || {};

  for (const fy of ['FY24', 'FY25']) {
    const e = extracted[fy];
    raw[COMPANY][fy] = raw[COMPANY][fy] || {};
    if (e.sales.total   != null) raw[COMPANY][fy].auto_volume_total = pack(e.sales.total,   'units', 'Auto segment',  SALES_LABEL,   SOURCES[fy].sales);
    if (e.sales.suv     != null) raw[COMPANY][fy].suv_volume        = pack(e.sales.suv,     'units', 'Auto segment',  SALES_LABEL,   SOURCES[fy].sales);
    if (e.sales.exports != null) raw[COMPANY][fy].export_volume     = pack(e.sales.exports, 'units', 'Auto segment',  SALES_LABEL,   SOURCES[fy].sales);
    if (e.results.consol_revenue != null)
      raw[COMPANY][fy].consol_revenue_cr = pack(e.results.consol_revenue, '₹ Cr', 'Consolidated', RESULTS_LABEL, SOURCES[fy].results);
    if (e.results.auto_revenue != null)
      raw[COMPANY][fy].auto_revenue_cr   = pack(e.results.auto_revenue,   '₹ Cr', 'Auto segment',  RESULTS_LABEL, SOURCES[fy].results);
    if (e.results.consol_pat != null)
      raw[COMPANY][fy].consol_pat_cr     = pack(e.results.consol_pat,     '₹ Cr', 'Consolidated', RESULTS_LABEL, SOURCES[fy].results);
    if (e.results.auto_ebitda_margin != null)
      raw[COMPANY][fy].auto_ebitda_margin_pct = pack(e.results.auto_ebitda_margin, '%', 'Auto segment', RESULTS_LABEL, SOURCES[fy].results);
  }

  /* ---------- calculations ---------- */
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const updates = [];

  /* Volume Growth % from auto-segment FY totals */
  if (extracted.FY25.sales.total && extracted.FY24.sales.total) {
    const g = +((extracted.FY25.sales.total / extracted.FY24.sales.total - 1) * 100).toFixed(1);
    const r = writeRow(data, 'FY25', 'Volume Growth %', g, SALES_LABEL, SOURCES.FY25.sales);
    if (r) updates.push(`FY25 Volume Growth %: ${r.before} → ${r.after}%`);
  }

  /* Revenue Growth % — prefer auto segment, fall back to consolidated only
     if auto isn't broken out, and mark scope in source label so it's clear. */
  function rev(fy, key) { return extracted[fy]?.results?.[key]; }
  if (rev('FY24', 'auto_revenue') && rev('FY25', 'auto_revenue')) {
    const g = +((rev('FY25', 'auto_revenue') / rev('FY24', 'auto_revenue') - 1) * 100).toFixed(1);
    const r = writeRow(data, 'FY25', 'Revenue Growth %', g, RESULTS_LABEL + ' (Auto segment)', SOURCES.FY25.results);
    if (r) updates.push(`FY25 Revenue Growth % (Auto): ${r.before} → ${r.after}%`);
  } else if (rev('FY24', 'consol_revenue') && rev('FY25', 'consol_revenue')) {
    const g = +((rev('FY25', 'consol_revenue') / rev('FY24', 'consol_revenue') - 1) * 100).toFixed(1);
    const r = writeRow(data, 'FY25', 'Revenue Growth %', g, RESULTS_LABEL + ' (Consolidated)', SOURCES.FY25.results);
    if (r) updates.push(`FY25 Revenue Growth % (Consol): ${r.before} → ${r.after}%`);
  }

  /* EBITDA Margin % — auto segment when explicitly reported */
  for (const fy of ['FY24', 'FY25']) {
    const v = extracted[fy].results.auto_ebitda_margin;
    if (v != null) {
      const r = writeRow(data, fy, 'EBITDA Margin %', v, RESULTS_LABEL + ' (Auto segment)', SOURCES[fy].results);
      if (r) updates.push(`${fy} EBITDA Margin %: ${r.before} → ${r.after}%`);
    }
  }

  /* ---------- summary ---------- */
  console.log('\n=== Output table ===');
  const fmt = v => v == null ? '—' : v.toLocaleString('en-IN');
  console.log('Metric                          | FY25            | FY24            | Scope         | Source');
  console.log('--------------------------------+-----------------+-----------------+---------------+--------');
  console.log(`Auto total volume (units)       | ${fmt(extracted.FY25.sales.total)} | ${fmt(extracted.FY24.sales.total)} | Auto segment  | sales PR`);
  console.log(`SUV volume (units)              | ${fmt(extracted.FY25.sales.suv)} | ${fmt(extracted.FY24.sales.suv)} | Auto segment  | sales PR`);
  console.log(`Export volume (units)           | ${fmt(extracted.FY25.sales.exports)} | ${fmt(extracted.FY24.sales.exports)} | Auto segment  | sales PR`);
  console.log(`Consol revenue (₹ Cr)           | ${fmt(extracted.FY25.results.consol_revenue)} | ${fmt(extracted.FY24.results.consol_revenue)} | Consolidated  | results PR`);
  console.log(`Auto revenue (₹ Cr)             | ${fmt(extracted.FY25.results.auto_revenue)} | ${fmt(extracted.FY24.results.auto_revenue)} | Auto segment  | results PR`);
  console.log(`Auto EBITDA margin (%)          | ${fmt(extracted.FY25.results.auto_ebitda_margin)} | ${fmt(extracted.FY24.results.auto_ebitda_margin)} | Auto segment  | results PR`);

  console.log(`\n[fetch-mm] ${updates.length} dashboard cell(s) to update:`);
  updates.forEach(u => console.log('  ' + u));

  if (DRY_RUN) { console.log('[fetch-mm] --dry-run: not writing files.'); return; }
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
  if (updates.length) fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[fetch-mm] wrote raw → ${RAW_PATH}`);
  if (updates.length) console.log(`[fetch-mm] wrote ${updates.length} update(s) → ${DATA_PATH}`);
}

main().catch(err => {
  console.error('[fetch-mm] fatal:', err);
  process.exit(1);
});
