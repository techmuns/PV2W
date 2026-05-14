#!/usr/bin/env node
/**
 * fetch-tvs-screener.mjs
 *
 * Mirror of scripts/fetch-maruti-screener.mjs for the 2W side —
 * pulls TVS Motor Company's consolidated annual P&L, balance sheet,
 * and cash flow from Screener.in and caches the full FY-by-FY table
 * into raw_extracts.json under raw_extracts['TVS'].Screener.
 *
 * Why TVS goes through Screener too: TVS's own annual press release
 * publishes Revenue / EBITDA Margin / PBT / PAT but not the deeper
 * P&L lines (Interest, Depreciation, Tax %) or the balance-sheet /
 * cash-flow rows the dashboard's trend modal exposes. Screener
 * carries the full 10-year picture in a single page-load.
 *
 *   Source URL: https://www.screener.in/company/TVSMOTOR/consolidated/
 *
 * For metrics the press-release seed (scripts/seed-tvs-2w.mjs)
 * already populated, this fetcher follows the same authoritative
 * guard the PV side uses (scripts/derive-financials.mjs:
 * isAnalystAuthoritative): press-release rows stay untouched. The
 * fetcher only fills cells Screener uniquely covers (Interest,
 * Depreciation, Tax %, Borrowings, Reserves, Total Assets, CFO /
 * CFI / CFF, Capex from |investing|) and any cells the seed left
 * null (FY16/FY17 EBITDA margin, FY17 PAT, etc.).
 *
 * Failure handling: 4xx / 429 / parse miss → exit 0, no changes.
 * The workflow's continue-on-error wraps this anyway.
 *
 * Usage:
 *   node scripts/fetch-tvs-screener.mjs
 *   node scripts/fetch-tvs-screener.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

const URL_CONS  = 'https://www.screener.in/company/TVSMOTOR/consolidated/';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const COMPANY  = 'TVS';
const SEGMENT  = '2W';
const SRC_LBL  = 'TVS Motor Company — Screener.in consolidated annual P&L / balance sheet / cash flow';

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
    const fixed    = findRow(bs.rows, 'fixed assets');
    const inv      = findRow(bs.rows, 'investments');
    const totalAst = findRow(bs.rows, 'total assets');
    bsFys.forEach((fy, i) => {
      if (!fy) return;
      if (equity)    setVal(fy, 'equity_capital_cr', toNum(equity.values[i]));
      if (reserves)  setVal(fy, 'reserves_cr',       toNum(reserves.values[i]));
      if (borrow)    setVal(fy, 'borrowings_cr',     toNum(borrow.values[i]));
      if (fixed)     setVal(fy, 'fixed_assets_cr',   toNum(fixed.values[i]));
      if (inv)       setVal(fy, 'investments_cr',    toNum(inv.values[i]));
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

/* ────────── segment_metrics writer ──────────
   Same schema as fetch-2w-press.mjs and seed-tvs-2w.mjs:
     { segment_id, company, fiscal_year, metric, value,
       source, source_url, last_updated }

   Authoritative-row guard: any cell already sourced from a TVS
   press release / annual report stays untouched. We only touch
   rows that are missing OR already sourced from Screener. */
function isAuthoritative(source) {
  if (!source) return false;
  const s = String(source).toLowerCase();
  return /press release|annual report|investor presentation|q4 ip|drhp|siam/.test(s)
      && !s.includes('screener');
}

function upsertSegment(data, row) {
  if (!Array.isArray(data.segment_metrics)) data.segment_metrics = [];
  const i = data.segment_metrics.findIndex(r =>
    r.segment_id  === row.segment_id  &&
    r.company     === row.company     &&
    r.fiscal_year === row.fiscal_year &&
    r.metric      === row.metric
  );
  if (i >= 0) {
    const e = data.segment_metrics[i];
    if (isAuthoritative(e.source)) return { status: 'kept-authoritative' };
    if (e.value === row.value && e.source_url === row.source_url) return { status: 'unchanged' };
    data.segment_metrics[i] = { ...e, ...row };
    return { status: 'updated' };
  }
  data.segment_metrics.push(row);
  return { status: 'added' };
}

function writeSegment(data, fy, metric, value) {
  if (value == null || !Number.isFinite(value)) return 0;
  const r = upsertSegment(data, {
    segment_id:   SEGMENT,
    company:      COMPANY,
    fiscal_year:  fy,
    metric,
    value,
    source:       SRC_LBL,
    source_url:   URL_CONS,
    last_updated: TODAY,
  });
  return (r.status === 'added' || r.status === 'updated') ? 1 : 0;
}

const round1 = x => Math.round(x * 10) / 10;

async function main() {
  console.log('[fetch-tvs-screener] starting…');
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

  /* ---- write raw_extracts audit trail ---- */
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  raw[COMPANY] = raw[COMPANY] || {};
  raw[COMPANY].Screener = {
    fetched_at: new Date().toISOString(),
    source_url: URL_CONS,
    basis: 'TVS Motor Company consolidated annual P&L + balance sheet + cash flow',
    by_fy: extracted.byFY,
    problems: extracted.problems,
  };

  /* ---- write segment_metrics rows (non-authoritative cells only) ---- */
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let segWrites = 0;
  for (const [fy, b] of Object.entries(extracted.byFY)) {
    if (b.sales_cr          != null) segWrites += writeSegment(data, fy, 'Revenue (Rs Cr)',     b.sales_cr);
    if (b.ebitda_cr         != null) segWrites += writeSegment(data, fy, 'EBITDA (Rs Cr)',      b.ebitda_cr);
    if (b.ebitda_margin_pct != null) segWrites += writeSegment(data, fy, 'EBITDA Margin %',     b.ebitda_margin_pct);
    if (b.interest_cr       != null) segWrites += writeSegment(data, fy, 'Interest (Rs Cr)',    b.interest_cr);
    if (b.depreciation_cr   != null) segWrites += writeSegment(data, fy, 'Depreciation (Rs Cr)',b.depreciation_cr);
    if (b.pbt_cr            != null) segWrites += writeSegment(data, fy, 'PBT (Rs Cr)',         b.pbt_cr);
    if (b.tax_pct           != null) segWrites += writeSegment(data, fy, 'Tax %',               b.tax_pct);
    if (b.pat_cr            != null) segWrites += writeSegment(data, fy, 'PAT (Rs Cr)',         b.pat_cr);

    if (b.borrowings_cr     != null) segWrites += writeSegment(data, fy, 'Borrowings (Rs Cr)',  b.borrowings_cr);
    if (b.reserves_cr       != null) segWrites += writeSegment(data, fy, 'Reserves (Rs Cr)',    b.reserves_cr);
    if (b.fixed_assets_cr   != null) segWrites += writeSegment(data, fy, 'Fixed Assets (Rs Cr)',b.fixed_assets_cr);
    if (b.investments_cr    != null) segWrites += writeSegment(data, fy, 'Investments (Rs Cr)', b.investments_cr);
    if (b.total_assets_cr   != null) segWrites += writeSegment(data, fy, 'Total Assets (Rs Cr)',b.total_assets_cr);

    if (b.cfo_cr            != null) segWrites += writeSegment(data, fy, 'CFO (Rs Cr)',         b.cfo_cr);
    if (b.investing_cr      != null) {
      segWrites += writeSegment(data, fy, 'CFI (Rs Cr)',         b.investing_cr);
      /* |investing| is the standard Screener-derived Capex proxy. */
      segWrites += writeSegment(data, fy, 'Capex (Rs Cr)',       Math.abs(b.investing_cr));
    }
    if (b.cff_cr            != null) segWrites += writeSegment(data, fy, 'CFF (Rs Cr)',         b.cff_cr);

    /* Derived margins / intensity — only when both inputs landed
       in this same Screener pull so the basis is consistent. */
    if (b.pat_cr != null && b.sales_cr) {
      segWrites += writeSegment(data, fy, 'PAT Margin %',
        round1((b.pat_cr / b.sales_cr) * 100));
    }
    if (b.investing_cr != null && b.sales_cr) {
      segWrites += writeSegment(data, fy, 'Capex Intensity %',
        round1((Math.abs(b.investing_cr) / b.sales_cr) * 100));
    }
  }

  if (DRY_RUN) {
    console.log(`  --dry-run: would write ${segWrites} segment_metrics row(s); skipping file writes.`);
    return;
  }
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
  console.log(`  wrote ${path.relative(process.cwd(), RAW_PATH)}`);
  if (segWrites > 0) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
    console.log(`  wrote ${segWrites} segment_metrics row(s) → ${path.relative(process.cwd(), DATA_PATH)}`);
  } else {
    console.log('  segment_metrics: no new/changed cells.');
  }
}

main().catch(err => {
  console.error('[fetch-tvs-screener] fatal:', err);
  process.exit(0);
});
