#!/usr/bin/env node
/**
 * fetch-tata.mjs
 *
 * Tata Motors PV (segment) FY24 + FY25 — sales volumes and financial
 * data from official Tata Motors press release pages.
 *
 * Sources (HTML):
 *   - Q4 sales PR (FY24 + FY25)
 *   - Q4 + FY consolidated results PR (FY24 + FY25)
 *
 * Scope handling (per spec):
 *   - PV-segment volumes / revenue       → Scope: "Tata PV segment"
 *   - Consolidated group revenue          → Scope: "Consolidated"
 *     (kept as raw extract only; never written to a PV dashboard cell)
 *
 * Tata Motors group consolidates JLR + India CV + India PV. The
 * dashboard's Tata Motors PV row must reflect the PV segment only.
 *
 * Extracts (when present):
 *   - PV segment sales volume (FY total) — derived from sales PR
 *   - PV segment revenue (₹ Cr)          — from results PR segment notes
 *   - PV segment EBITDA margin %         — when explicit
 *   - PV segment EBIT margin %           — when explicit
 *   - Consolidated revenue/PAT           — for raw audit only
 *
 * Calculates and writes (PV-segment only):
 *   - Volume Growth %
 *   - Revenue Growth %
 *   - EBITDA Margin % (or EBIT margin if EBITDA not reported)
 *   - Realisation Growth %
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAsText, parseIndianInt } from './lib/fetch-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const TEXT_DIR  = path.join(__dirname, '..', 'data', 'config', 'press_text', 'tata');
const DRY_RUN   = process.argv.includes('--dry-run');

const COMPANY = 'Tata Motors PV';
const SOURCES = {
  FY24: {
    sales:   'https://www.tatamotors.com/press-releases/tata-motors-registered-total-sales-of-265090-units-in-q4-fy24/',
    results: 'https://www.tatamotors.com/press-releases/tata-motors-consolidated-q4-fy24-results/',
  },
  FY25: {
    sales:   'https://www.tatamotors.com/press-releases/tata-motors-registered-total-sales-of-252642-units-in-q4-fy25/',
    results: 'https://www.tatamotors.com/press-releases/tata-motors-consolidated-q4-fy25-results/',
  },
};
const SALES_LABEL   = 'Tata Motors Q4/FY sales PR';
const RESULTS_LABEL = 'Tata Motors Q4/FY results PR';

const today = () => new Date().toISOString().slice(0, 10);

/* ---------- sales-page parser ----------
   Verified from the saved text dump: Tata's PR has narrative line
   "Tata Motors Passenger Vehicles achieved wholesales of 5,56,263
   units, including 64,726 units of EVs" — the cleanest signal for
   the FY-cumulative PV total. */
function parseSales(text) {
  const out = { pv_fy_total: null, pv_q4: null };

  const wholesale = text.match(
    /(?:Tata\s+Motors\s+)?Passenger\s+Vehicles?\s+(?:achieved|recorded|posted)?\s*wholesales\s+of\s+([0-9][0-9,]{4,})\s*units?/i
  );
  if (wholesale) out.pv_fy_total = parseIndianInt(wholesale[1]);

  return out;
}

/* ---------- results-page parser ----------
   Verified from the saved text dump: Tata's results page has a
   four-segment table (Group | JLR-£m | Tata CV | Tata PV) repeated
   twice — first under a "Q4 FY25" header, then under a "FY25" header.
   PV is the 4th numeric token on each row. We need the SECOND
   occurrence of each row label (Revenue / EBITDA (%) / EBIT (%)) —
   those are the FY rows. */
function parseResults(text) {
  const out = {
    pv_revenue:        null,
    pv_ebitda_margin:  null,
    pv_ebit_margin:    null,
    consol_revenue:    null,
    consol_pat:        null,
  };
  const lines = text.split(/\r?\n/).map(l => l.trim());

  /* Find the n-th line index matching rx (1-based: nth=2 = second occurrence). */
  function nthIndex(rx, nth = 1) {
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (rx.test(lines[i])) {
        count++;
        if (count === nth) return i;
      }
    }
    return -1;
  }
  /* From a starting index, collect numeric tokens (Indian-formatted)
     looking ahead until we have at least N. Returns the array. */
  function collectInts(startIdx, count = 4, lookahead = 18, magMin = 100) {
    if (startIdx < 0) return null;
    const buf = [];
    for (let j = startIdx; j < Math.min(startIdx + lookahead, lines.length); j++) {
      for (const m of lines[j].matchAll(/(\d{1,3}(?:,\d{2,3})+|\d{4,})/g)) {
        const n = parseIndianInt(m[0]);
        if (n != null && n >= magMin) buf.push(n);
      }
      if (buf.length >= count) break;
    }
    return buf;
  }
  /* Margin rows can appear two ways across releases:
       FY25 PR: "14.0%" each on its own line
       FY24 PR: bare decimal "14.3" (no %), with "X bps" change marker
                following on the next line.
     We accept either format: capture standalone decimals (with or
     without trailing %), skip lines containing "bps" (those are the
     change markers), and stop at the next text label. */
  function collectPcts(startIdx, count = 4, lookahead = 30) {
    if (startIdx < 0) return null;
    const buf = [];
    for (let j = startIdx + 1; j < Math.min(startIdx + lookahead, lines.length); j++) {
      const line = lines[j].trim();
      if (!line) continue;
      if (/\bbps\b/i.test(line)) continue;                     // change-marker line — skip
      if (/^[A-Za-z]/.test(line) && !/^\(/.test(line)) break;  // hit next row label
      const m = line.match(/^[(\s]*(\d+(?:\.\d+)?)\s*%?\s*[)\s]*$/);
      if (m) buf.push(parseFloat(m[1]));
      if (buf.length >= count) break;
    }
    return buf;
  }

  /* PV revenue = 4th numeric on the SECOND "Revenue" row (FY block).
     If only one Revenue row appears (some PR variants), take the 4th
     number from the first one. */
  let revIdx = nthIndex(/^\s*Revenue\s*$/i, 2);
  if (revIdx < 0) revIdx = nthIndex(/^\s*Revenue\s*$/i, 1);
  const revNums = collectInts(revIdx, 4);
  if (revNums && revNums.length >= 4) {
    out.consol_revenue = revNums[0];   // group, ₹ Cr
    out.pv_revenue     = revNums[3];   // PV, ₹ Cr
  }

  /* PV EBITDA % = 4th percent on the SECOND "EBITDA (%)" row */
  let ebMIdx = nthIndex(/^\s*EBITDA\s*\(%\)\s*$/i, 2);
  if (ebMIdx < 0) ebMIdx = nthIndex(/^\s*EBITDA\s*\(%\)\s*$/i, 1);
  const ebMPcts = collectPcts(ebMIdx, 4);
  if (ebMPcts && ebMPcts.length >= 4) out.pv_ebitda_margin = ebMPcts[3];

  /* PV EBIT % = 4th percent on the SECOND "EBIT (%)" row */
  let ebitIdx = nthIndex(/^\s*EBIT\s*\(%\)\s*$/i, 2);
  if (ebitIdx < 0) ebitIdx = nthIndex(/^\s*EBIT\s*\(%\)\s*$/i, 1);
  const ebitPcts = collectPcts(ebitIdx, 4);
  if (ebitPcts && ebitPcts.length >= 4) out.pv_ebit_margin = ebitPcts[3];

  /* Consol revenue narrative — "TML reported record revenues of ₹439.7K Cr"
     (₹ K Cr → multiply by 1000 to get ₹ Cr). Fallback to table value above. */
  const consolNarrative = text.match(/revenues?\s+of\s+₹\s*([0-9,]+(?:\.\d+)?)\s*K\s*Cr/i);
  if (consolNarrative) {
    const v = parseFloat(consolNarrative[1].replace(/,/g, ''));
    if (Number.isFinite(v)) out.consol_revenue = Math.round(v * 1000);
  }

  /* Consol net profit narrative — "net profit of ₹28.1K Cr" */
  const consolPat = text.match(/net\s+profit\s+of\s+₹\s*([0-9,]+(?:\.\d+)?)\s*K\s*Cr/i);
  if (consolPat) {
    const v = parseFloat(consolPat[1].replace(/,/g, ''));
    if (Number.isFinite(v)) out.consol_pat = Math.round(v * 1000);
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
  console.log('[fetch-tata] starting…');
  fs.mkdirSync(TEXT_DIR, { recursive: true });

  const extracted = {};
  for (const fy of ['FY24', 'FY25']) {
    console.log(`\n=== ${fy} ===`);
    extracted[fy] = { sales: { pv_fy_total:null, pv_q4:null },
                       results: { pv_revenue:null, pv_ebitda_margin:null,
                                  pv_ebit_margin:null, consol_revenue:null, consol_pat:null } };
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
    if (e.sales.pv_fy_total != null)
      raw[COMPANY][fy].pv_volume_fy_total = pack(e.sales.pv_fy_total, 'units', 'Tata PV segment', SALES_LABEL,   SOURCES[fy].sales);
    if (e.results.pv_revenue != null)
      raw[COMPANY][fy].pv_revenue_cr      = pack(e.results.pv_revenue, '₹ Cr', 'Tata PV segment', RESULTS_LABEL, SOURCES[fy].results);
    if (e.results.pv_ebitda_margin != null)
      raw[COMPANY][fy].pv_ebitda_margin   = pack(e.results.pv_ebitda_margin, '%', 'Tata PV segment', RESULTS_LABEL, SOURCES[fy].results);
    if (e.results.pv_ebit_margin != null)
      raw[COMPANY][fy].pv_ebit_margin     = pack(e.results.pv_ebit_margin, '%', 'Tata PV segment', RESULTS_LABEL, SOURCES[fy].results);
    if (e.results.consol_revenue != null)
      raw[COMPANY][fy].consol_revenue_cr  = pack(e.results.consol_revenue, '₹ Cr', 'Consolidated',  RESULTS_LABEL, SOURCES[fy].results);
    if (e.results.consol_pat != null)
      raw[COMPANY][fy].consol_pat_cr      = pack(e.results.consol_pat,     '₹ Cr', 'Consolidated',  RESULTS_LABEL, SOURCES[fy].results);
  }

  /* ---------- calculations (PV-segment only) ---------- */
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const updates = [];

  /* Volume Growth % from PV-segment FY totals */
  if (extracted.FY25.sales.pv_fy_total && extracted.FY24.sales.pv_fy_total) {
    const g = +((extracted.FY25.sales.pv_fy_total / extracted.FY24.sales.pv_fy_total - 1) * 100).toFixed(1);
    const r = writeRow(data, 'FY25', 'Volume Growth %', g, SALES_LABEL + ' (PV segment)', SOURCES.FY25.sales);
    if (r) updates.push(`FY25 Volume Growth %: ${r.before} → ${r.after}%`);
  }

  /* Revenue Growth % — PV segment only */
  if (extracted.FY25.results.pv_revenue && extracted.FY24.results.pv_revenue) {
    const g = +((extracted.FY25.results.pv_revenue / extracted.FY24.results.pv_revenue - 1) * 100).toFixed(1);
    const r = writeRow(data, 'FY25', 'Revenue Growth %', g, RESULTS_LABEL + ' (PV segment)', SOURCES.FY25.results);
    if (r) updates.push(`FY25 Revenue Growth %: ${r.before} → ${r.after}%`);
  }

  /* EBITDA Margin % per FY — PV segment */
  for (const fy of ['FY24', 'FY25']) {
    const v = extracted[fy].results.pv_ebitda_margin ?? extracted[fy].results.pv_ebit_margin;
    if (v != null) {
      const lbl = extracted[fy].results.pv_ebitda_margin != null
        ? RESULTS_LABEL + ' (PV segment EBITDA)'
        : RESULTS_LABEL + ' (PV segment EBIT — EBITDA not broken out)';
      const r = writeRow(data, fy, 'EBITDA Margin %', v, lbl, SOURCES[fy].results);
      if (r) updates.push(`${fy} EBITDA Margin %: ${r.before} → ${r.after}%`);
    }
  }

  /* Realisation Growth % — needs PV revenue and PV volume both years */
  function realisation(fy) {
    const e = extracted[fy];
    if (!e.results.pv_revenue || !e.sales.pv_fy_total) return null;
    return (e.results.pv_revenue * 1e7) / e.sales.pv_fy_total;
  }
  const r25 = realisation('FY25'), r24 = realisation('FY24');
  if (r25 && r24) {
    const g = +((r25 / r24 - 1) * 100).toFixed(1);
    const r = writeRow(data, 'FY25', 'Realisation Growth %', g, RESULTS_LABEL + ' + sales PR (PV segment)', SOURCES.FY25.results);
    if (r) updates.push(`FY25 Realisation Growth %: ${r.before} → ${r.after}% (₹${r24.toFixed(0)}/u → ₹${r25.toFixed(0)}/u)`);
  }

  /* ---------- summary ---------- */
  console.log('\n=== Output table ===');
  const fmt = v => v == null ? '—' : v.toLocaleString('en-IN');
  console.log('Metric                          | FY25            | FY24            | Scope            | Source');
  console.log('--------------------------------+-----------------+-----------------+------------------+--------');
  console.log(`PV FY total volume (units)      | ${fmt(extracted.FY25.sales.pv_fy_total)} | ${fmt(extracted.FY24.sales.pv_fy_total)} | Tata PV segment  | sales PR`);
  console.log(`PV revenue (₹ Cr)               | ${fmt(extracted.FY25.results.pv_revenue)} | ${fmt(extracted.FY24.results.pv_revenue)} | Tata PV segment  | results PR`);
  console.log(`PV EBITDA margin (%)            | ${fmt(extracted.FY25.results.pv_ebitda_margin)} | ${fmt(extracted.FY24.results.pv_ebitda_margin)} | Tata PV segment  | results PR`);
  console.log(`PV EBIT margin (%)              | ${fmt(extracted.FY25.results.pv_ebit_margin)} | ${fmt(extracted.FY24.results.pv_ebit_margin)} | Tata PV segment  | results PR`);
  console.log(`Consol revenue (₹ Cr)           | ${fmt(extracted.FY25.results.consol_revenue)} | ${fmt(extracted.FY24.results.consol_revenue)} | Consolidated     | results PR (audit-only)`);

  console.log(`\n[fetch-tata] ${updates.length} dashboard cell(s) to update:`);
  updates.forEach(u => console.log('  ' + u));

  if (DRY_RUN) { console.log('[fetch-tata] --dry-run: not writing files.'); return; }
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
  if (updates.length) fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[fetch-tata] wrote raw → ${RAW_PATH}`);
  if (updates.length) console.log(`[fetch-tata] wrote ${updates.length} update(s) → ${DATA_PATH}`);
}

main().catch(err => {
  console.error('[fetch-tata] fatal:', err);
  process.exit(1);
});
