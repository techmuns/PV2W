#!/usr/bin/env node
/**
 * fetch-hyundai-screener.mjs
 *
 * Best-effort scrape of Hyundai Motor India's Screener.in page so
 * the dashboard's PAT Margin %, Capex (₹ Cr), and Capex Intensity %
 * trends populate. HMIL is the cleanest standalone India-PV listing
 * (no JLR / Farm / Tech overhang), so the derived numbers map
 * directly to the dashboard's 'Hyundai' rows.
 *
 *   Source URL:
 *     https://www.screener.in/company/HYUNDAI/    (standalone)
 *
 * NOTE: HMIL only listed on Indian exchanges in Oct 2024, so
 * Screener's older history is bootstrapped from DRHP. Pre-FY18
 * numbers may be sparse — the derive-financials pass tolerates
 * missing rows.
 *
 * Output:
 *   - raw_extracts.json → raw_extracts['Hyundai'].Screener
 *
 * Failure handling: 4xx / 429 / parse miss → exit 0, no changes.
 *
 * Usage:
 *   node scripts/fetch-hyundai-screener.mjs
 *   node scripts/fetch-hyundai-screener.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');

const URL_PRIMARY = 'https://www.screener.in/company/HYUNDAI/';
const URL_FALLBACK = 'https://www.screener.in/company/HYUNDAI/consolidated/';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const COMPANY = 'Hyundai';

async function fetchHTML(url) {
  console.log(`  GET ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function toNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[%,]/g, '').replace(/[ \s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function colToFY(col) {
  const m = String(col).match(/Mar\s+(\d{4})/i);
  if (!m) return null;
  return 'FY' + String(parseInt(m[1], 10)).slice(2);
}
function parseSection(html, sectionId) {
  const sectRx = new RegExp(`<section[^>]+id=["']${sectionId}["'][\\s\\S]*?<\\/section>`, 'i');
  const sectMatch = html.match(sectRx);
  if (!sectMatch) return null;
  const sect = sectMatch[0];
  const headM = sect.match(/<thead[\s\S]*?<\/thead>/i);
  if (!headM) return null;
  const ths = [...headM[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => stripTags(m[1]));
  const yearCols = ths.slice(1);
  const bodyM  = sect.match(/<tbody[\s\S]*?<\/tbody>/i);
  if (!bodyM) return null;
  const trs = [...bodyM[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
  const rows = trs.map(tr => {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => stripTags(m[1]));
    return { label: tds[0] || '', values: tds.slice(1) };
  });
  return { yearCols, rows };
}
function findRow(rows, needle) {
  const n = needle.toLowerCase();
  return rows.find(r => r.label.toLowerCase().includes(n));
}

function distill(html) {
  const out = { byFY: {}, problems: [] };
  const setVal = (fy, k, v) => {
    if (!fy) return;
    out.byFY[fy] = out.byFY[fy] || {};
    out.byFY[fy][k] = v;
  };
  const pl = parseSection(html, 'profit-loss');
  if (!pl) { out.problems.push('no profit-loss section'); return out; }
  const fys = pl.yearCols.map(colToFY);
  const sales        = findRow(pl.rows, 'sales');
  const expenses     = findRow(pl.rows, 'expenses');
  const opProfit     = findRow(pl.rows, 'operating profit');
  const opm          = findRow(pl.rows, 'opm');
  const interest     = findRow(pl.rows, 'interest');
  const depreciation = findRow(pl.rows, 'depreciation');
  const pbt          = findRow(pl.rows, 'profit before tax');
  const taxPct       = findRow(pl.rows, 'tax %');
  const np           = findRow(pl.rows, 'net profit');
  fys.forEach((fy, i) => {
    if (!fy) return;
    if (sales)        setVal(fy, 'sales_cr',          toNum(sales.values[i]));
    if (expenses)     setVal(fy, 'expenses_cr',       toNum(expenses.values[i]));
    if (opProfit)     setVal(fy, 'ebitda_cr',         toNum(opProfit.values[i]));
    if (opm)          setVal(fy, 'ebitda_margin_pct', toNum(opm.values[i]));
    if (interest)     setVal(fy, 'interest_cr',       toNum(interest.values[i]));
    if (depreciation) setVal(fy, 'depreciation_cr',   toNum(depreciation.values[i]));
    if (pbt)          setVal(fy, 'pbt_cr',            toNum(pbt.values[i]));
    if (taxPct)       setVal(fy, 'tax_pct',           toNum(taxPct.values[i]));
    if (np)           setVal(fy, 'pat_cr',            toNum(np.values[i]));
  });

  const bs = parseSection(html, 'balance-sheet');
  if (bs) {
    const bsFys = bs.yearCols.map(colToFY);
    const equity   = findRow(bs.rows, 'equity capital');
    const reserves = findRow(bs.rows, 'reserves');
    const borrow   = findRow(bs.rows, 'borrowings');
    const totalAst = findRow(bs.rows, 'total assets');
    bsFys.forEach((fy, i) => {
      if (!fy) return;
      if (equity)    setVal(fy, 'equity_capital_cr', toNum(equity.values[i]));
      if (reserves)  setVal(fy, 'reserves_cr',       toNum(reserves.values[i]));
      if (borrow)    setVal(fy, 'borrowings_cr',     toNum(borrow.values[i]));
      if (totalAst)  setVal(fy, 'total_assets_cr',   toNum(totalAst.values[i]));
    });
  }

  const cf = parseSection(html, 'cash-flow');
  if (cf) {
    const cfFys = cf.yearCols.map(colToFY);
    const op   = findRow(cf.rows, 'operating');
    const inv  = findRow(cf.rows, 'investing');
    const fin  = findRow(cf.rows, 'financing');
    cfFys.forEach((fy, i) => {
      if (!fy) return;
      if (op)  setVal(fy, 'cfo_cr',       toNum(op.values[i]));
      if (inv) setVal(fy, 'investing_cr', toNum(inv.values[i]));
      if (fin) setVal(fy, 'cff_cr',       toNum(fin.values[i]));
    });
  }

  /* Revenue Growth % from Sales YoY, so the headline KPI can fill for a
     newly-reported FY that has no press-release value yet. */
  const fyKeys = Object.keys(out.byFY).sort();
  for (let i = 1; i < fyKeys.length; i++) {
    const cur = out.byFY[fyKeys[i]], prv = out.byFY[fyKeys[i - 1]];
    if (cur && prv && cur.sales_cr != null && prv.sales_cr) {
      cur.revenue_growth_pct = +(((cur.sales_cr / prv.sales_cr) - 1) * 100).toFixed(1);
    }
  }
  return out;
}

/* ── dashboard write ────────────────────────────────────────────────
   Fill the headline KPI rows Screener can source — Revenue Growth %
   and EBITDA Margin % — for any FY it reports. Gap-fill only: a cell
   already carrying a press-release / AR value is left untouched; only
   empty / Pending cells (e.g. a brand-new fiscal year) or this
   fetcher's own prior Screener rows are written. */
const SCREENER_SRC = 'Hyundai Motor India standalone financials (Screener.in)';

function setRow(data, fy, metric, value, sourceLabel) {
  if (value == null || !Number.isFinite(value)) return null;
  let row = data.company_fy_metrics.find(r =>
    r.Company === COMPANY && r.FY === fy && r.Metric === metric);
  if (!row) {
    row = { FY: fy, Company: COMPANY, Metric: metric,
            Value: null, YoY_Change: null, Signal: 'Neutral',
            Source: 'Pending', Source_URL: null, Last_Updated: null };
    data.company_fy_metrics.push(row);
  }
  const filled = row.Value != null && row.Source && row.Source !== 'Pending';
  if (filled && !/screener/i.test(row.Source)) return { status: 'kept' };
  if (row.Value === value && row.Source === sourceLabel) return { status: 'unchanged' };
  row.Value = value;
  row.Source = sourceLabel;
  row.Source_URL = URL_PRIMARY;
  row.Last_Updated = new Date().toISOString().slice(0, 10);
  return { status: 'updated', value };
}

async function main() {
  console.log('[fetch-hyundai-screener] starting…');
  let extracted = null, html = null;
  for (const url of [URL_PRIMARY, URL_FALLBACK]) {
    try {
      html = await fetchHTML(url);
      extracted = distill(html);
      if (Object.keys(extracted.byFY).length) {
        console.log(`  parsed ${Object.keys(extracted.byFY).length} FY rows from ${url}`);
        break;
      }
    } catch (e) {
      console.warn(`  fetch ${url} failed: ${e.message}`);
    }
  }
  if (!extracted || !Object.keys(extracted.byFY).length) {
    console.warn('[fetch-hyundai-screener] no data, exiting soft.');
    process.exit(0);
  }

  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  raw[COMPANY] = raw[COMPANY] || {};
  raw[COMPANY].Screener = {
    fetched_at: new Date().toISOString(),
    source_url: URL_PRIMARY,
    basis: 'Hyundai Motor India standalone P&L + cash flow (per Screener; pre-FY18 from DRHP bootstrap)',
    by_fy: extracted.byFY,
    problems: extracted.problems,
  };

  /* Fill headline KPI rows (Revenue Growth %, EBITDA Margin %) for any
     FY Screener reports, without overwriting press-release / AR cells. */
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let updated = 0, kept = 0, unchanged = 0;
  for (const [fy, vals] of Object.entries(extracted.byFY)) {
    const apply = (metric, v) => {
      const r = setRow(data, fy, metric, v, SCREENER_SRC);
      if (!r) return;
      if (r.status === 'updated') updated++;
      else if (r.status === 'kept') kept++;
      else if (r.status === 'unchanged') unchanged++;
    };
    apply('Revenue Growth %', vals.revenue_growth_pct);
    apply('EBITDA Margin %',  vals.ebitda_margin_pct);
  }
  console.log(`  dashboard rows: updated=${updated} kept=${kept} unchanged=${unchanged}`);

  if (DRY_RUN) { console.log('--dry-run: not writing files.'); return; }
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
  if (updated > 0) fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`  wrote ${RAW_PATH}`);
  if (updated > 0) console.log(`  wrote ${DATA_PATH}`);
  console.log(`  → run scripts/derive-financials.mjs to compute PAT Margin / Capex from this raw extract.`);
}

main().catch(err => {
  console.error('[fetch-hyundai-screener] fatal:', err);
  process.exit(0);
});
