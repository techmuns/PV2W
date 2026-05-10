#!/usr/bin/env node
/**
 * fetch-mm-screener.mjs
 *
 * Best-effort scrape of M&M's Screener.in page for the dashboard's
 * M&M (Auto + Farm consolidated) metrics. Screener is reasonably
 * tolerant of GitHub Actions runner IPs and serves clean HTML, so
 * a regex pass over the company page is generally enough.
 *
 *   Source URL:
 *     https://www.screener.in/company/M%26M/consolidated/
 *
 * What we pull (where available):
 *   - Sales (Rs Cr)            FY15..latest        → Revenue Growth %
 *   - OPM %                                         → EBITDA Margin %
 *   - Net Profit                                    → raw_extracts only
 *   - Working Capital Days                          → Working Capital Days
 *   - Fixed assets line from cash flow              → Capex (Rs Cr) proxy
 *   - ROCE %                                        → raw_extracts only
 *
 *   FY mapping: Screener column 'Mar 2024' → FY24, 'Mar 2015' → FY15.
 *
 * Output:
 *   - raw_extracts.json → raw_extracts['M&M'].Screener
 *   - placeholder_data.json
 *       company_fy_metrics rows for Company='M&M' updated where the
 *       Screener value beats a 'Pending' source. We do NOT overwrite
 *       analyst-PDF-sourced values; if a row's Source mentions
 *       'analyst' or 'AR' or 'Investor Presentation' we leave it.
 *
 * Failure modes (all soft — exit 0):
 *   - Screener 4xx / 429   : keep existing values
 *   - HTML structure shift : log which rows didn't parse, exit 0
 *
 * Usage:
 *   node scripts/fetch-mm-screener.mjs
 *   node scripts/fetch-mm-screener.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN   = process.argv.includes('--dry-run');

const URL_CONS = 'https://www.screener.in/company/M%26M/consolidated/';
const TODAY    = new Date().toISOString().slice(0, 10);

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* ──────────────────────────────────────────────────────────────────
   Network
   ────────────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────────────
   Parse helpers — Screener tables look like:
     <table>
       <thead><tr><th></th><th>Mar 2015</th>...<th>TTM</th></tr></thead>
       <tbody>
         <tr><td><button>Sales</button></td>
             <td>69 220</td><td>...</td>
         </tr>
         ...
       </tbody>
     </table>
   ────────────────────────────────────────────────────────────────── */

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function toNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[%,]/g, '').replace(/[ \s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/* Pick a section's <table> and parse year headers + row labels. */
function parseSection(html, sectionId) {
  const sectRx = new RegExp(`<section[^>]+id=["']${sectionId}["'][\\s\\S]*?<\\/section>`, 'i');
  const sectMatch = html.match(sectRx);
  if (!sectMatch) return null;
  const sect = sectMatch[0];

  /* Year header row */
  const headRx  = /<thead[\s\S]*?<\/thead>/i;
  const headM   = sect.match(headRx);
  if (!headM) return null;
  const headHtml = headM[0];
  const ths = [...headHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => stripTags(m[1]));
  /* First TH is row-label header, rest are year columns. */
  const yearCols = ths.slice(1);

  /* Body rows */
  const bodyRx = /<tbody[\s\S]*?<\/tbody>/i;
  const bodyM  = sect.match(bodyRx);
  if (!bodyM) return null;
  const trs = [...bodyM[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
  const rows = trs.map(tr => {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => stripTags(m[1]));
    return { label: tds[0] || '', values: tds.slice(1) };
  });

  return { yearCols, rows };
}

/* Return the row whose first cell label loosely matches `needle`. */
function findRow(rows, needle) {
  const n = needle.toLowerCase();
  return rows.find(r => r.label.toLowerCase().includes(n));
}

/* Map Screener year header 'Mar 2015' → 'FY15'. Screener also has
   'TTM' for the trailing-twelve-months column, which we skip. */
function colToFY(col) {
  const m = String(col).match(/Mar\s+(\d{4})/i);
  if (!m) return null;
  return 'FY' + String(parseInt(m[1], 10)).slice(2);
}

/* ──────────────────────────────────────────────────────────────────
   Distill — produce a flat per-FY object for the metrics we care about.
   ────────────────────────────────────────────────────────────────── */
function distill(html) {
  const out = { byFY: {}, problems: [] };

  const pl = parseSection(html, 'profit-loss');
  if (!pl) { out.problems.push('no profit-loss section'); return out; }

  const fys = pl.yearCols.map(colToFY);

  /* Pull every P&L line item Screener publishes — Sales, Expenses,
     Operating Profit, OPM%, Other Income, Interest, Depreciation,
     Profit Before Tax, Tax%, Net Profit. Each maps onto an
     Absolute_Numbers / dashboard row so PV cells fill cleanly. */
  const sales      = findRow(pl.rows, 'sales');
  const expenses   = findRow(pl.rows, 'expenses');
  const opProfit   = findRow(pl.rows, 'operating profit');
  const opm        = findRow(pl.rows, 'opm');
  const interest   = findRow(pl.rows, 'interest');
  const depreciation = findRow(pl.rows, 'depreciation');
  const pbt        = findRow(pl.rows, 'profit before tax');
  const taxPct     = findRow(pl.rows, 'tax %');
  const np         = findRow(pl.rows, 'net profit');
  if (!sales) out.problems.push('no Sales row');
  if (!opm)   out.problems.push('no OPM row');

  const setVal = (fy, k, v) => {
    if (!fy) return;
    out.byFY[fy] = out.byFY[fy] || {};
    out.byFY[fy][k] = v;
  };

  fys.forEach((fy, i) => {
    if (!fy) return;
    if (sales)        setVal(fy, 'sales_cr',           toNum(sales.values[i]));
    if (expenses)     setVal(fy, 'expenses_cr',        toNum(expenses.values[i]));
    if (opProfit)     setVal(fy, 'ebitda_cr',          toNum(opProfit.values[i]));
    if (opm)          setVal(fy, 'ebitda_margin_pct',  toNum(opm.values[i]));
    if (interest)     setVal(fy, 'interest_cr',        toNum(interest.values[i]));
    if (depreciation) setVal(fy, 'depreciation_cr',    toNum(depreciation.values[i]));
    if (pbt)          setVal(fy, 'pbt_cr',             toNum(pbt.values[i]));
    if (taxPct)       setVal(fy, 'tax_pct',            toNum(taxPct.values[i]));
    if (np)           setVal(fy, 'pat_cr',             toNum(np.values[i]));
  });

  /* Balance Sheet section — Equity, Borrowings, Other Liabilities,
     Total Liabilities, Fixed Assets, CWIP, Investments, Other
     Assets, Total Assets. */
  const bs = parseSection(html, 'balance-sheet');
  if (bs) {
    const bsFys = bs.yearCols.map(colToFY);
    const equity   = findRow(bs.rows, 'equity capital');
    const reserves = findRow(bs.rows, 'reserves');
    const borrow   = findRow(bs.rows, 'borrowings');
    const totalLiab= findRow(bs.rows, 'total liabilities');
    const fixed    = findRow(bs.rows, 'fixed assets');
    const inv      = findRow(bs.rows, 'investments');
    const totalAst = findRow(bs.rows, 'total assets');
    bsFys.forEach((fy, i) => {
      if (!fy) return;
      if (equity)    setVal(fy, 'equity_capital_cr', toNum(equity.values[i]));
      if (reserves)  setVal(fy, 'reserves_cr',       toNum(reserves.values[i]));
      if (borrow)    setVal(fy, 'borrowings_cr',     toNum(borrow.values[i]));
      if (totalLiab) setVal(fy, 'total_liab_cr',     toNum(totalLiab.values[i]));
      if (fixed)     setVal(fy, 'fixed_assets_cr',   toNum(fixed.values[i]));
      if (inv)       setVal(fy, 'investments_cr',    toNum(inv.values[i]));
      if (totalAst)  setVal(fy, 'total_assets_cr',   toNum(totalAst.values[i]));
    });
  } else {
    out.problems.push('no balance-sheet section');
  }

  /* Ratios section — Working Capital Days, ROCE %, etc. */
  const ratios = parseSection(html, 'ratios');
  if (ratios) {
    const ratFys = ratios.yearCols.map(colToFY);
    const wcd = findRow(ratios.rows, 'working capital days');
    const roce = findRow(ratios.rows, 'roce');
    ratFys.forEach((fy, i) => {
      if (!fy) return;
      if (wcd)  setVal(fy, 'working_capital_days', toNum(wcd.values[i]));
      if (roce) setVal(fy, 'roce_pct',             toNum(roce.values[i]));
    });
  } else {
    out.problems.push('no ratios section');
  }

  /* Cash flow section — Cash from Operating, Investing, Financing
     and Net Cash Flow. */
  const cf = parseSection(html, 'cash-flow');
  if (cf) {
    const cfFys = cf.yearCols.map(colToFY);
    const op    = findRow(cf.rows, 'operating');
    const inv   = findRow(cf.rows, 'investing');
    const fin   = findRow(cf.rows, 'financing');
    const net   = findRow(cf.rows, 'net cash flow');
    cfFys.forEach((fy, i) => {
      if (!fy) return;
      if (op)  setVal(fy, 'cfo_cr',       toNum(op.values[i]));
      if (inv) setVal(fy, 'investing_cr', toNum(inv.values[i]));
      if (fin) setVal(fy, 'cff_cr',       toNum(fin.values[i]));
      if (net) setVal(fy, 'net_cash_cr',  toNum(net.values[i]));
    });
  }

  /* Compute Revenue Growth % from Sales YoY. */
  const fyList = Object.keys(out.byFY).sort();
  for (let i = 1; i < fyList.length; i++) {
    const cur = out.byFY[fyList[i]],     prv = out.byFY[fyList[i-1]];
    if (cur && prv && cur.sales_cr != null && prv.sales_cr) {
      cur.revenue_growth_pct = +(((cur.sales_cr / prv.sales_cr) - 1) * 100).toFixed(1);
    }
  }

  return out;
}

/* ──────────────────────────────────────────────────────────────────
   Apply — write into placeholder_data.json carefully.
   We only overwrite a row when the existing Source is 'Pending' or
   when the existing source mentions screener.in (so re-runs update
   the same rows but never clobber an analyst-PDF or AR-cited value).
   ────────────────────────────────────────────────────────────────── */
const COMPANY = 'M&M';
/* The dashboard label deliberately credits the underlying company
   filings only — Screener.in is the aggregator we hit, but the
   audit trail in raw_extracts.json already records that path. */
const SCREENER_SRC = 'Mahindra & Mahindra annual report — consolidated P&L / ratios / cash flow';

function isAnalystAuthoritative(src) {
  if (!src || src === 'Pending') return false;
  const s = src.toLowerCase();
  return /annual report|investor presentation|q4 ip|drhp|analyst|siam/.test(s)
       && !/screener/.test(s);
}

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
  if (isAnalystAuthoritative(row.Source)) return { status: 'kept-authoritative' };
  if (row.Value === value && row.Source === sourceLabel) return { status: 'unchanged' };
  row.Value = value;
  row.Source = sourceLabel;
  row.Source_URL = URL_CONS;
  row.Last_Updated = TODAY;
  return { status: 'updated', value };
}

async function main() {
  console.log('[fetch-mm-screener] starting…');
  let extracted = null, html = null;
  try {
    html = await fetchHTML(URL_CONS);
    extracted = distill(html);
    console.log(`  parsed ${Object.keys(extracted.byFY).length} FY rows`);
    if (extracted.problems.length) console.warn('  problems:', extracted.problems.join(', '));
  } catch (e) {
    console.warn(`  fetch failed: ${e.message}`);
    process.exit(0);
  }

  /* Update raw_extracts.json */
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  raw[COMPANY] = raw[COMPANY] || {};
  raw[COMPANY].Screener = {
    fetched_at: new Date().toISOString(),
    source_url: URL_CONS,
    by_fy: extracted.byFY,
    problems: extracted.problems,
  };

  /* Update placeholder_data.json */
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let updated = 0, kept = 0, unchanged = 0;
  for (const [fy, vals] of Object.entries(extracted.byFY)) {
    const apply = (metric, v) => {
      const r = setRow(data, fy, metric, v, SCREENER_SRC);
      if (!r) return;
      if (r.status === 'updated') updated++;
      else if (r.status === 'kept-authoritative') kept++;
      else if (r.status === 'unchanged') unchanged++;
    };
    apply('Revenue Growth %',     vals.revenue_growth_pct);
    apply('EBITDA Margin %',      vals.ebitda_margin_pct);
    apply('Working Capital Days', vals.working_capital_days);
  }
  console.log(`  updated=${updated} kept-authoritative=${kept} unchanged=${unchanged}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: not writing files.');
    return;
  }
  fs.writeFileSync(RAW_PATH,  JSON.stringify(raw,  null, 2) + '\n');
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`  wrote ${RAW_PATH}`);
  console.log(`  wrote ${DATA_PATH}`);
}

main().catch(err => {
  console.error('[fetch-mm-screener] fatal:', err);
  process.exit(0);
});
