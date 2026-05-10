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
  return out;
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

  if (DRY_RUN) { console.log('--dry-run: not writing files.'); return; }
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
  console.log(`  wrote ${RAW_PATH}`);
  console.log(`  → run scripts/derive-financials.mjs to compute PAT Margin / Capex from this raw extract.`);
}

main().catch(err => {
  console.error('[fetch-hyundai-screener] fatal:', err);
  process.exit(0);
});
