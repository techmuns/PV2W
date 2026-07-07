#!/usr/bin/env node
/**
 * fetch-hyundai.mjs
 *
 * Hyundai Motor India — financials & volumes from the Q4 audited
 * standalone results press release.
 *
 * Primary source: hyundai.com IR — pressrelease-audited-standalone.pdf
 * Scope: Standalone (HMIL is the listed entity)
 *
 * The reported fiscal year is read *from the PDF itself* (its title
 * line "Q4 and FY25 Financial Results" / the annual column header
 * "FY25 FY24"), NOT assumed from a hardcoded literal. Hyundai keeps the
 * same URL and overwrites it each quarter, so the moment the FY26 filing
 * lands the parser labels the new figures FY26 automatically instead of
 * mislabelling them as the prior year.
 *
 * Extracts (where present):
 *   - Revenue (₹ Cr) / EBITDA (₹ Cr) / EBITDA margin % / PAT (₹ Cr)
 *     per FY (current + prior, from the 5-column table)
 *   - Domestic / Export sales (units), SUV mix % (narrative, latest FY)
 *
 * Calculates and writes (only when inputs are present):
 *   - Revenue Growth %, EBITDA Margin %, Volume Growth %,
 *     Export Volume %, Realisation Growth %, SUV Volume %
 *
 * Hard rules:
 *   - Skip any metric whose required input(s) are null; no guessing
 *   - Idempotent: only writes when value or source-tag changes
 *   - Creates the dashboard row if a newly-reported FY has none yet
 *   - Saves the raw PDF text to data/config/press_text/hyundai/ for
 *     audit + parser-debugging in the next iteration
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestCompleteFY } from './lib/fy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const TEXT_DIR  = path.join(__dirname, '..', 'data', 'config', 'press_text', 'hyundai');
const DRY_RUN   = process.argv.includes('--dry-run');

const COMPANY = 'Hyundai';
const SCOPE   = 'Standalone';
const SOURCES = {
  standalone_pdf: 'https://www.hyundai.com/content/dam/hyundai/in/en/data/investor-relations/annoucements/pressrelease-audited-standalone.pdf',
  ir_page:        'https://www.hyundai.com/in/en/investor-relations/financial-information/reports',
};
const SOURCE_LABEL = 'Hyundai Q4 audited standalone results PR';

const today = () => new Date().toISOString().slice(0, 10);
const priorFYName = (fy) => 'FY' + String(parseInt(fy.replace(/^FY/i, ''), 10) - 1).padStart(2, '0');

async function loadPdfParse() {
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  return mod.default || mod;
}

async function fetchPdfText(url, pdfParse) {
  console.log(`  fetching ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pv-dashboard-bot)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`  got ${buf.length} bytes, parsing PDF…`);
  const out = await pdfParse(buf);
  return out.text || '';
}

function parseIndianInt(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/* Read the fiscal year the PDF reports on. Tries, in order:
     1. the results title  — "Q4 and FY25 Financial Results"
     2. the annual header  — "FY25 FY24"
     3. the full-year form  — "FY 2024-25"
   Returns { cur, prev } FY names, or null if none matched (caller then
   skips writing rather than guessing the year). */
function detectFYs(text) {
  let curYY = null;
  let m = text.match(/Q4\s*(?:and|&)?\s*FY\s*'?(\d{2})\b[^\n]*Financial\s+Results/i)
       || text.match(/\bFY\s*'?(\d{2})\s+FY\s*'?(\d{2})\b/i);
  if (m) curYY = parseInt(m[1], 10);
  if (curYY == null) {
    const y = text.match(/FY\s*20(\d{2})\s*[-–]\s*(\d{2})\b/i);   // FY 2024-25 → 25
    if (y) curYY = parseInt(y[2], 10);
  }
  if (curYY == null) return null;
  const cur = 'FY' + String(curYY).padStart(2, '0');
  return { cur, prev: priorFYName(cur) };
}

/* Pull rows from the standalone results PR.
   HMIL's PR layout (verified from the saved text dump):
     - Numbers reported in INR Mn. (1 Cr = 10 Mn → divide by 10)
     - Five-column financial table: Q4-cur | Q4-prev | Q3-cur | FY-cur | FY-prev
       i.e. we want the 4th and 5th tokens on the row
     - EBITDA% row similarly has 5 percent values
     - Volumes appear in narrative form only ("Domestic volumes stood at
       599K", "Export volumes sustained at 163K") for the latest FY
     - SUV Contribution narrative: "domestic SUV Contribution at 68.5%" */
function parseStandalone(text) {
  const out = {
    cur:  { revenue:null, ebitda:null, ebitda_margin:null, pat:null, domestic:null, export:null, suv_pct:null },
    prev: { revenue:null, ebitda:null, ebitda_margin:null, pat:null, domestic:null, export:null, suv_pct:null },
  };
  const lines = text.split(/\r?\n/).map(l => l.trim());

  /* Detect unit. HMIL writes "(INR Mn.)" near the table header. */
  const isMillion = /\(\s*INR\s*Mn|in\s*Mn\.?\s*\)/i.test(text);
  const cr = (mn) => mn == null ? null : (isMillion ? Math.round(mn / 10) : mn);

  /* Walk forward from a row label, collecting numeric tokens until we
     have at least N. Returns the FY-cur (idx 3) and FY-prev (idx 4)
     when a 5-col row, or first 2 when only 2 are found (narrative). */
  function tableRowNums(rx, lookahead = 14, minCount = 5, magMin = 100) {
    for (let i = 0; i < lines.length; i++) {
      if (!rx.test(lines[i])) continue;
      const buf = [];
      for (let j = i; j < Math.min(i + lookahead, lines.length); j++) {
        for (const m of lines[j].matchAll(/(\d{1,3}(?:,\d{2,3})+|\d{4,})/g)) {
          const n = parseIndianInt(m[0]);
          if (n != null && n >= magMin) buf.push(n);
        }
        if (buf.length >= minCount) break;
      }
      if (buf.length >= 5) return { cur: buf[3], prev: buf[4] };
      if (buf.length >= 2) return { cur: buf[0], prev: buf[1] };
    }
    return null;
  }
  function tableRowPcts(rx, lookahead = 12) {
    for (let i = 0; i < lines.length; i++) {
      if (!rx.test(lines[i])) continue;
      const buf = [];
      for (let j = i; j < Math.min(i + lookahead, lines.length); j++) {
        for (const m of lines[j].matchAll(/(\d+(?:\.\d+)?)\s*%/g)) buf.push(parseFloat(m[1]));
        if (buf.length >= 5) break;
      }
      if (buf.length >= 5) return { cur: buf[3], prev: buf[4] };
      if (buf.length >= 2) return { cur: buf[0], prev: buf[1] };
    }
    return null;
  }

  const rev = tableRowNums(/^Revenue\b/i, 14, 5, 1000);
  if (rev) { out.cur.revenue = cr(rev.cur); out.prev.revenue = cr(rev.prev); }

  const eb = tableRowNums(/^EBITDA(?!\s*%)\*?\b/i, 14, 5, 100);
  if (eb) { out.cur.ebitda = cr(eb.cur); out.prev.ebitda = cr(eb.prev); }

  const ebM = tableRowPcts(/^EBITDA\s*%/i);
  if (ebM) { out.cur.ebitda_margin = ebM.cur; out.prev.ebitda_margin = ebM.prev; }

  const pat = tableRowNums(/^PAT\b/i, 14, 5, 100);
  if (pat) { out.cur.pat = cr(pat.cur); out.prev.pat = cr(pat.prev); }

  /* Volume narrative — latest FY only in HMIL's standalone PR */
  const dom = text.match(/Domestic\s+volumes?\s+(?:stood\s+at|at)\s+(\d+(?:\.\d+)?)\s*K\b/i);
  if (dom) out.cur.domestic = Math.round(parseFloat(dom[1]) * 1000);
  const exp = text.match(/Export\s+volumes?\s+(?:sustained\s+at|stood\s+at|at)\s+(\d+(?:\.\d+)?)\s*K\b/i);
  if (exp) out.cur.export = Math.round(parseFloat(exp[1]) * 1000);

  /* SUV mix narrative — latest FY only */
  const suv = text.match(/SUV\s+Contribution\s+at\s+(\d+(?:\.\d+)?)\s*%/i);
  if (suv) out.cur.suv_pct = parseFloat(suv[1]);

  return out;
}

function writeRow(data, fy, metric, value, sourceLabel, sourceUrl) {
  if (value == null) return null;
  let row = data.company_fy_metrics.find(r =>
    r.Company === COMPANY && r.FY === fy && r.Metric === metric
  );
  if (!row) {
    /* Create the row on demand so a newly-reported FY fills in instead
       of being silently dropped (the old behaviour returned null here). */
    row = { FY: fy, Company: COMPANY, Metric: metric,
            Value: null, YoY_Change: null, Signal: 'Neutral',
            Source: 'Pending', Source_URL: null, Last_Updated: null };
    data.company_fy_metrics.push(row);
  }
  if (row.Value === value && row.Source === sourceLabel && row.Source_URL === sourceUrl) return null;
  const before = row.Value;
  row.Value = value;
  row.Source = sourceLabel;
  row.Source_URL = sourceUrl;
  row.Last_Updated = today();
  return { before, after: value };
}

function pack(value, unit, label, url) {
  if (value == null) return null;
  return { value, unit, scope: SCOPE, source: label, source_url: url, last_updated: today() };
}

async function main() {
  console.log('[fetch-hyundai] starting…');
  fs.mkdirSync(TEXT_DIR, { recursive: true });
  const pdfParse = await loadPdfParse();

  let extracted, fys;
  try {
    const text = await fetchPdfText(SOURCES.standalone_pdf, pdfParse);
    fs.writeFileSync(path.join(TEXT_DIR, 'standalone.txt'), text);
    fys = detectFYs(text);
    if (!fys) {
      console.warn('[fetch-hyundai] could not detect the reported FY from the PDF — skipping write to avoid mislabelling.');
      return;
    }
    extracted = parseStandalone(text);
    console.log(`[fetch-hyundai] reported period: ${fys.cur} (prior ${fys.prev})`);
    console.log(`  ${fys.cur}:`, extracted.cur);
    console.log(`  ${fys.prev}:`, extracted.prev);
  } catch (e) {
    console.error('[fetch-hyundai] standalone PDF fetch/parse failed:', e.message);
    throw e;
  }

  /* Sanity guard: the detected FY should never run ahead of the newest
     completed fiscal year (a filing can lag the calendar, never lead it).
     If it somehow does, trust the data-derived year but log it loudly. */
  if (fys.cur > latestCompleteFY()) {
    console.warn(`[fetch-hyundai] note: PDF reports ${fys.cur}, ahead of latest completed ${latestCompleteFY()} — using PDF value.`);
  }

  /* ---------- raw extracts (audit trail) ---------- */
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  raw[COMPANY] = raw[COMPANY] || {};

  for (const key of ['prev', 'cur']) {
    const fy = fys[key];
    const v = extracted[key];
    raw[COMPANY][fy] = raw[COMPANY][fy] || {};
    if (v.revenue       != null) raw[COMPANY][fy].revenue_cr        = pack(v.revenue,       '₹ Cr',  SOURCE_LABEL, SOURCES.standalone_pdf);
    if (v.ebitda        != null) raw[COMPANY][fy].ebitda_cr         = pack(v.ebitda,        '₹ Cr',  SOURCE_LABEL, SOURCES.standalone_pdf);
    if (v.ebitda_margin != null) raw[COMPANY][fy].ebitda_margin_pct = pack(v.ebitda_margin, '%',     SOURCE_LABEL, SOURCES.standalone_pdf);
    if (v.pat           != null) raw[COMPANY][fy].pat_cr            = pack(v.pat,           '₹ Cr',  SOURCE_LABEL, SOURCES.standalone_pdf);
    if (v.domestic      != null) raw[COMPANY][fy].domestic_volume   = pack(v.domestic,      'units', SOURCE_LABEL, SOURCES.standalone_pdf);
    if (v.export        != null) raw[COMPANY][fy].export_volume     = pack(v.export,        'units', SOURCE_LABEL, SOURCES.standalone_pdf);
    if (v.suv_pct       != null) raw[COMPANY][fy].suv_mix_pct       = pack(v.suv_pct,       '%',     SOURCE_LABEL, SOURCES.standalone_pdf);
  }

  /* ---------- calculations ---------- */
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const updates = [];
  const URL = SOURCES.standalone_pdf;

  /* Revenue Growth % */
  if (extracted.cur.revenue && extracted.prev.revenue) {
    const g = +((extracted.cur.revenue / extracted.prev.revenue - 1) * 100).toFixed(1);
    const r = writeRow(data, fys.cur, 'Revenue Growth %', g, SOURCE_LABEL, URL);
    if (r) updates.push(`${fys.cur} Revenue Growth %: ${r.before} → ${r.after}%`);
  }

  /* EBITDA Margin % — prefer explicit, fall back to EBITDA/Revenue */
  for (const key of ['prev', 'cur']) {
    const e = extracted[key];
    let value = null;
    if (e.ebitda_margin != null) value = e.ebitda_margin;
    else if (e.ebitda && e.revenue) value = +((e.ebitda / e.revenue) * 100).toFixed(1);
    if (value != null) {
      const r = writeRow(data, fys[key], 'EBITDA Margin %', value, SOURCE_LABEL, URL);
      if (r) updates.push(`${fys[key]} EBITDA Margin %: ${r.before} → ${r.after}%`);
    }
  }

  /* Volume Growth %, Export Volume %, Realisation Growth % */
  const total = (key) => {
    const e = extracted[key];
    return (e.domestic && e.export) ? (e.domestic + e.export) : null;
  };
  if (total('prev') && total('cur')) {
    const g = +((total('cur') / total('prev') - 1) * 100).toFixed(1);
    const r = writeRow(data, fys.cur, 'Volume Growth %', g, SOURCE_LABEL, URL);
    if (r) updates.push(`${fys.cur} Volume Growth %: ${r.before} → ${r.after}%`);
  }
  for (const key of ['prev', 'cur']) {
    const e = extracted[key];
    if (e.domestic && e.export) {
      const t = e.domestic + e.export;
      const pct = +((e.export / t) * 100).toFixed(1);
      const r = writeRow(data, fys[key], 'Export Volume %', pct, SOURCE_LABEL, URL);
      if (r) updates.push(`${fys[key]} Export Volume %: ${r.before} → ${r.after}%`);
    }
  }
  const realisation = (key) => {
    const e = extracted[key];
    const t = total(key);
    if (!e.revenue || !t) return null;
    return (e.revenue * 1e7) / t;   // ₹ per unit
  };
  const rCur = realisation('cur'), rPrev = realisation('prev');
  if (rCur && rPrev) {
    const g = +((rCur / rPrev - 1) * 100).toFixed(1);
    const r = writeRow(data, fys.cur, 'Realisation Growth %', g, SOURCE_LABEL, URL);
    if (r) updates.push(`${fys.cur} Realisation Growth %: ${r.before} → ${r.after}% (₹${rPrev.toFixed(0)}/u → ₹${rCur.toFixed(0)}/u)`);
  }

  /* SUV Volume % */
  for (const key of ['prev', 'cur']) {
    const e = extracted[key];
    if (e.suv_pct != null) {
      const r = writeRow(data, fys[key], 'SUV Volume %', e.suv_pct, SOURCE_LABEL, URL);
      if (r) updates.push(`${fys[key]} SUV Volume %: ${r.before} → ${r.after}%`);
    }
  }

  /* ---------- summary ---------- */
  console.log('\n=== Output table ===');
  const fmt = v => v == null ? '—' : v.toLocaleString('en-IN');
  console.log(`Metric                          | ${fys.cur.padEnd(15)} | ${fys.prev.padEnd(15)} | Source`);
  console.log('--------------------------------+-----------------+-----------------+-----------');
  console.log(`Revenue (₹ Cr)                  | ${fmt(extracted.cur.revenue)} | ${fmt(extracted.prev.revenue)} | standalone PR`);
  console.log(`EBITDA (₹ Cr)                   | ${fmt(extracted.cur.ebitda)} | ${fmt(extracted.prev.ebitda)} | standalone PR`);
  console.log(`EBITDA margin (%)               | ${fmt(extracted.cur.ebitda_margin)} | ${fmt(extracted.prev.ebitda_margin)} | standalone PR`);
  console.log(`PAT (₹ Cr)                      | ${fmt(extracted.cur.pat)} | ${fmt(extracted.prev.pat)} | standalone PR`);
  console.log(`Domestic sales (units)          | ${fmt(extracted.cur.domestic)} | ${fmt(extracted.prev.domestic)} | standalone PR`);
  console.log(`Export sales (units)            | ${fmt(extracted.cur.export)} | ${fmt(extracted.prev.export)} | standalone PR`);
  console.log(`SUV mix (%)                     | ${fmt(extracted.cur.suv_pct)} | ${fmt(extracted.prev.suv_pct)} | standalone PR`);

  console.log(`\n[fetch-hyundai] ${updates.length} dashboard cell(s) to update:`);
  updates.forEach(u => console.log('  ' + u));

  if (DRY_RUN) {
    console.log('[fetch-hyundai] --dry-run: not writing files.');
    return;
  }
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
  if (updates.length) fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[fetch-hyundai] wrote raw → ${RAW_PATH}`);
  if (updates.length) console.log(`[fetch-hyundai] wrote ${updates.length} update(s) → ${DATA_PATH}`);
}

main().catch(err => {
  console.error('[fetch-hyundai] fatal:', err);
  process.exit(1);
});
