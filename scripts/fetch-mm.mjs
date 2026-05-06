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

  /* Mahindra's most reliable signal is the narrative line —
     verified from the saved text dump:
       FY25: "The company closed the year with 551487 SUVs ... 20% growth"
     The SUV YTD count is the number we want for the dashboard's
     M&M row (M&M's PV business is essentially SUVs). */
  const suvYtd = text.match(/closed\s+the\s+(?:financial\s+)?year\s+with\s+([0-9][0-9,]*)\s+SUVs?/i);
  if (suvYtd) out.suv = parseIndianInt(suvYtd[1]);

  /* "We also exported X vehicles in FY25" or similar — best-effort */
  const exp = text.match(/exported\s+([0-9][0-9,]*)\s+(?:vehicles?|units?)\s+in\s+(?:the\s+)?(?:financial\s+)?(?:year|FY)/i);
  if (exp) out.exports = parseIndianInt(exp[1]);

  /* Total auto for the FY can sometimes be inferred from "X total
     vehicles in FY25" — best-effort, often only March-month is given. */
  const total = text.match(/total\s+(?:vehicles?|volumes?)\s+of\s+([0-9][0-9,]*)\s+(?:in\s+)?(?:FY|the\s+(?:financial\s+)?year)/i);
  if (total) out.total = parseIndianInt(total[1]);

  return out;
}

/* ---------- results-page parser ----------
   M&M's FY results press release (verified from the saved text dump)
   uses two distinct phrasings for group vs sector:
     Group total:
       "F25 Consolidated Revenue at Rs 1,59,211 cr., up 14%"
       "F25 Consolidated PAT at Rs 12,929 cr., up 20%"
     Per sector (Auto first, then Farm, then Services, etc.):
       "Consolidated F25 Revenue Rs 90,825 cr., up 19%, PAT Rs 5,907 cr., up 25%"
   First sector-pattern match in document order = Auto sector. */
function parseResults(text) {
  const out = {
    consol_revenue: null,
    consol_pat:     null,
    auto_revenue:   null,
    auto_pat:       null,
    auto_ebitda_margin: null,
  };

  /* Group consolidated — different phrasing ("at Rs X cr.") */
  const groupRev = text.match(/F2\d\s+Consolidated\s+Revenue\s+at\s+Rs\.?\s*([0-9,]{4,})\s*cr/i);
  if (groupRev) out.consol_revenue = parseIndianInt(groupRev[1]);

  const groupPat = text.match(/F2\d\s+Consolidated\s+PAT\s+at\s+Rs\.?\s*([0-9,]{4,})\s*cr/i);
  if (groupPat) out.consol_pat = parseIndianInt(groupPat[1]);

  /* Auto-sector block — Mahindra's first sector in document order.
     Two phrasings observed across FY24 vs FY25 releases:
       FY25:  "Consolidated F25 Revenue Rs 90,825 cr., up 19%, PAT Rs 5,907 cr., up 25%"
       FY24:  "Consolidated Q4 Revenue Rs 20,908 cr., up 22%; FY24 Revenue Rs 76,156 cr., up 24%"
              "Consolidated Q4 PAT Rs 1,345 cr., up 3.0x; FY24 PAT Rs 4,714 cr., up 2.5x"
     Try the FY-explicit phrasing first; fall back to the F2N-prefix
     phrasing. First match wins → Auto sector since it's listed first. */
  const sectorFy24Rx = /Consolidated\s+Q4\s+Revenue\s+Rs\.?\s*[0-9,]+\s*cr[^;]*;\s*FY2\d\s+Revenue\s+Rs\.?\s*([0-9,]{4,})\s*cr/i;
  const sectorFy25Rx = /Consolidated\s+F2\d\s+Revenue\s+Rs\.?\s*([0-9,]{4,})\s*cr\.?,?\s*up\s+\d+(?:\.\d+)?\s*%?,?\s*PAT\s+Rs\.?\s*([0-9,]{3,})\s*cr/i;
  const autoFy24 = text.match(sectorFy24Rx);
  const autoFy25 = text.match(sectorFy25Rx);
  if (autoFy25) {
    out.auto_revenue = parseIndianInt(autoFy25[1]);
    out.auto_pat     = parseIndianInt(autoFy25[2]);
  } else if (autoFy24) {
    out.auto_revenue = parseIndianInt(autoFy24[1]);
  }
  /* Auto FY PAT in the FY24 phrasing */
  if (out.auto_pat == null) {
    const autoPat = text.match(/Consolidated\s+Q4\s+PAT\s+Rs\.?\s*[0-9,]+\s*cr[^;]*;\s*FY2\d\s+PAT\s+Rs\.?\s*([0-9,]{3,})\s*cr/i);
    if (autoPat) out.auto_pat = parseIndianInt(autoPat[1]);
  }

  /* Auto EBITDA margin — when the press release breaks it out.
     Phrasings vary: "Auto EBITDA at X%", "Automotive Operating margin at X%". */
  const autoMargRx = [
    /Auto(?:motive)?\s+(?:Segment\s+)?(?:Standalone\s+)?EBITDA\s*(?:at|of|margin)?\s*(\d+(?:\.\d+)?)\s*%/i,
    /Auto(?:motive)?\s+(?:Segment\s+)?Operating\s*Margin\s*(?:at|of)?\s*(\d+(?:\.\d+)?)\s*%/i,
  ];
  for (const rx of autoMargRx) {
    const m = text.match(rx);
    if (m) { out.auto_ebitda_margin = parseFloat(m[1]); break; }
  }
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
