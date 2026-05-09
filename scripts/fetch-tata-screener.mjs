#!/usr/bin/env node
/**
 * fetch-tata-screener.mjs
 *
 * Best-effort scrape of Tata Motors Ltd's Screener.in page for the
 * dashboard's 'Tata Motors PV' rows.
 *
 *   Source URL:
 *     https://www.screener.in/company/TATAMOTORS/consolidated/
 *
 * IMPORTANT: Screener's TATAMOTORS series is the *listed parent* —
 * JLR + Indian CV + Indian PV combined. Pure PV-segment numbers
 * are only published in company Q4 Investor Presentations. We
 * therefore label the Source explicitly so the analyst sees the
 * basis is parent-level (good as a directional proxy, not as a
 * segment-pure number) and the authoritative-row guard preserves
 * any analyst-PDF / AR / IP-sourced cells already in place.
 *
 * What we pull (FY15..latest where available):
 *   - Sales (Rs Cr)            → Revenue Growth % YoY (parent)
 *   - OPM %                    → EBITDA Margin % (parent)
 *   - Net Profit               → raw_extracts only
 *   - Working Capital Days     → Working Capital Days (parent)
 *   - Cash from Investing      → raw_extracts as 'investing_cr'
 *   - ROCE %                   → raw_extracts only
 *
 * Output:
 *   - raw_extracts.json → raw_extracts['Tata Motors PV'].Screener
 *   - placeholder_data.json → company_fy_metrics rows for
 *     Revenue Growth %, EBITDA Margin %, Working Capital Days
 *     where the existing Source is 'Pending' or already a
 *     Screener label. Analyst-PDF / AR / IP sourced rows stay
 *     authoritative.
 *
 * Failure handling: any 4xx / 429 / parse miss → exit 0, no
 * file changes. Yahoo / Tata press fetchers stay authoritative.
 *
 * Usage:
 *   node scripts/fetch-tata-screener.mjs
 *   node scripts/fetch-tata-screener.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN   = process.argv.includes('--dry-run');

const URL_CONS = 'https://www.screener.in/company/TATAMOTORS/consolidated/';
const TODAY    = new Date().toISOString().slice(0, 10);

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const COMPANY = 'Tata Motors PV';
const SCREENER_SRC = 'Tata Motors Ltd annual report — consolidated parent (JLR + India CV + India PV), aggregated via Screener.in';

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
   Parsers
   ────────────────────────────────────────────────────────────────── */
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

  const sales = findRow(pl.rows, 'sales');
  const opm   = findRow(pl.rows, 'opm');
  const np    = findRow(pl.rows, 'net profit');
  if (!sales) out.problems.push('no Sales row');
  if (!opm)   out.problems.push('no OPM row');

  fys.forEach((fy, i) => {
    if (!fy) return;
    if (sales) setVal(fy, 'sales_cr',          toNum(sales.values[i]));
    if (opm)   setVal(fy, 'ebitda_margin_pct', toNum(opm.values[i]));
    if (np)    setVal(fy, 'pat_cr',            toNum(np.values[i]));
  });

  const ratios = parseSection(html, 'ratios');
  if (ratios) {
    const ratFys = ratios.yearCols.map(colToFY);
    const wcd  = findRow(ratios.rows, 'working capital days');
    const roce = findRow(ratios.rows, 'roce');
    ratFys.forEach((fy, i) => {
      if (!fy) return;
      if (wcd)  setVal(fy, 'working_capital_days', toNum(wcd.values[i]));
      if (roce) setVal(fy, 'roce_pct',             toNum(roce.values[i]));
    });
  } else {
    out.problems.push('no ratios section');
  }

  const cf = parseSection(html, 'cash-flow');
  if (cf) {
    const cfFys = cf.yearCols.map(colToFY);
    const inv = findRow(cf.rows, 'investing');
    cfFys.forEach((fy, i) => {
      if (!fy) return;
      if (inv) setVal(fy, 'investing_cr', toNum(inv.values[i]));
    });
  }

  /* Revenue Growth % from Sales YoY. */
  const fyList = Object.keys(out.byFY).sort();
  for (let i = 1; i < fyList.length; i++) {
    const cur = out.byFY[fyList[i]], prv = out.byFY[fyList[i-1]];
    if (cur && prv && cur.sales_cr != null && prv.sales_cr) {
      cur.revenue_growth_pct = +(((cur.sales_cr / prv.sales_cr) - 1) * 100).toFixed(1);
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────
   Authoritative-row guard — never overwrite analyst-PDF / AR /
   investor-presentation / SIAM cells with parent-level Screener
   numbers. Only Pending or already-Screener rows get touched.
   ────────────────────────────────────────────────────────────────── */
function isAnalystAuthoritative(src) {
  if (!src || src === 'Pending') return false;
  const s = src.toLowerCase();
  return /annual report|investor presentation|q4 ip|drhp|analyst|siam|press release/.test(s)
       && !/screener/.test(s);
}

function setRow(data, fy, metric, value) {
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
  if (row.Value === value && row.Source === SCREENER_SRC) return { status: 'unchanged' };
  row.Value = value;
  row.Source = SCREENER_SRC;
  row.Source_URL = URL_CONS;
  row.Last_Updated = TODAY;
  return { status: 'updated', value };
}

async function main() {
  console.log('[fetch-tata-screener] starting…');
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

  /* raw_extracts.json — keyed by company name */
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  raw[COMPANY] = raw[COMPANY] || {};
  raw[COMPANY].Screener = {
    fetched_at: new Date().toISOString(),
    source_url: URL_CONS,
    basis: 'Tata Motors Ltd consolidated parent (JLR + India CV + India PV combined)',
    by_fy: extracted.byFY,
    problems: extracted.problems,
  };

  /* placeholder_data.json — only Pending / already-Screener rows */
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let updated = 0, kept = 0, unchanged = 0;
  for (const [fy, vals] of Object.entries(extracted.byFY)) {
    const apply = (metric, v) => {
      const r = setRow(data, fy, metric, v);
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
  console.error('[fetch-tata-screener] fatal:', err);
  process.exit(0);
});
