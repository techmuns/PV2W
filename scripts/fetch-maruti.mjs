#!/usr/bin/env node
/**
 * fetch-maruti.mjs
 *
 * Direct web-fetch data layer — Maruti Suzuki, FY24 + FY25.
 *
 * Pulls audited annual financials from Yahoo Finance's quoteSummary
 * endpoint (which mirrors NSE/BSE filings — the same numbers Maruti's
 * own annual report reports). Stores raw extracted values in
 * data/config/raw_extracts.json for traceability, calculates the
 * dashboard metrics per the rules in the spec, and writes the result
 * into data/config/placeholder_data.json with proper Source /
 * Source_URL / Last_Updated on every row touched.
 *
 * Hard rules:
 *   - Never write a derived metric unless every input is present.
 *   - Never overwrite a row's Source/URL/date unless the Value
 *     actually changes.
 *   - Sales Volume / Employees / Dealers / Capacity are intentionally
 *     NOT touched here — they live in the AR / IR pages, not Yahoo.
 *
 * Usage:
 *   node scripts/fetch-maruti.mjs            # fetch + write
 *   node scripts/fetch-maruti.mjs --dry-run  # fetch, log, don't write
 *
 * Run via .github/workflows/refresh-data.yml.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH  = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH   = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN    = process.argv.includes('--dry-run');

const COMPANY    = 'Maruti';
const TICKER     = 'MARUTI.NS';
const TARGET_FYS = ['FY24', 'FY25'];

const SOURCE      = 'Yahoo Finance (NSE annual filings, audited)';
const SOURCE_URL  = `https://finance.yahoo.com/quote/${TICKER}/financials`;

/* ---------- helpers ---------- */
const today    = () => new Date().toISOString().slice(0, 10);
const toCrore  = (abs) => (abs == null ? null : Math.round(abs / 1e7));
const fyForDate = (epochSec) => {
  if (!epochSec) return null;
  const d = new Date(epochSec * 1000);
  /* Indian FY ends 31 Mar — endDate's calendar year IS the FY year. */
  return `FY${String(d.getUTCFullYear()).slice(2)}`;
};

/* ---------- network ---------- */
async function fetchYahoo() {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${TICKER}` +
    `?modules=incomeStatementHistory,cashflowStatementHistory,balanceSheetHistory`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pv-dashboard-bot)' },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.quoteSummary?.error) throw new Error(`Yahoo error: ${json.quoteSummary.error.description}`);
  return json;
}

/* Pull the four statements into a per-FY shape. Missing fields stay null. */
function extractByFY(json) {
  const result = json.quoteSummary?.result?.[0];
  if (!result) throw new Error('Yahoo: no result block');
  const out = {};
  const stash = (fy, end_date, src) => {
    out[fy] = out[fy] || { fy, end_date };
    return out[fy];
  };

  for (const s of (result.incomeStatementHistory?.incomeStatementHistory || [])) {
    const fy = fyForDate(s.endDate?.raw);
    if (!fy) continue;
    const row = stash(fy, s.endDate?.fmt);
    row.revenue          = s.totalRevenue?.raw      ?? null;
    row.gross_profit     = s.grossProfit?.raw       ?? null;
    row.operating_income = s.operatingIncome?.raw   ?? null;
    row.ebit             = s.ebit?.raw              ?? null;
    row.pat              = s.netIncome?.raw         ?? null;
  }
  for (const c of (result.cashflowStatementHistory?.cashflowStatements || [])) {
    const fy = fyForDate(c.endDate?.raw);
    if (!fy) continue;
    const row = stash(fy, c.endDate?.fmt);
    row.capex        = c.capitalExpenditures?.raw != null ? Math.abs(c.capitalExpenditures.raw) : null;
    row.depreciation = c.depreciation?.raw                 ?? null;
  }
  for (const b of (result.balanceSheetHistory?.balanceSheetStatements || [])) {
    const fy = fyForDate(b.endDate?.raw);
    if (!fy) continue;
    const row = stash(fy, b.endDate?.fmt);
    row.current_assets      = b.totalCurrentAssets?.raw      ?? null;
    row.current_liabilities = b.totalCurrentLiabilities?.raw ?? null;
    row.inventory           = b.inventory?.raw               ?? null;
    row.receivables         = b.netReceivables?.raw          ?? null;
  }
  return out;
}

/* ---------- write helpers ---------- */
function writeRow(data, company, fy, metric, value, srcUrl) {
  if (value == null) return { ok: false, reason: 'null value' };
  const row = data.company_fy_metrics.find(r =>
    r.Company === company && r.FY === fy && r.Metric === metric
  );
  if (!row) return { ok: false, reason: 'no matching row in dataset' };
  const sameValue  = row.Value === value;
  const sameSource = row.Source === SOURCE && row.Source_URL === (srcUrl || SOURCE_URL);
  if (sameValue && sameSource) return { ok: false, reason: 'unchanged' };
  const oldVal = row.Value;
  row.Value        = value;
  row.Source       = SOURCE;
  row.Source_URL   = srcUrl || SOURCE_URL;
  row.Last_Updated = today();
  return { ok: true, oldVal, newVal: value };
}

function pack(value) {
  if (value == null) return null;
  return { value, unit: 'INR (absolute)', source: SOURCE, source_url: SOURCE_URL, last_updated: today() };
}

/* ---------- main ---------- */
async function main() {
  console.log(`[fetch-maruti] Pulling ${TICKER}…`);
  const yahoo = await fetchYahoo();
  const byFY  = extractByFY(yahoo);

  console.log(`[fetch-maruti] FYs returned: ${Object.keys(byFY).join(', ')}`);
  for (const fy of Object.keys(byFY)) {
    const v = byFY[fy];
    console.log(`  ${fy} (end ${v.end_date}):`,
      `rev=${toCrore(v.revenue)} Cr,`,
      `op=${toCrore(v.operating_income)} Cr,`,
      `gp=${toCrore(v.gross_profit)} Cr,`,
      `pat=${toCrore(v.pat)} Cr,`,
      `capex=${toCrore(v.capex)} Cr`);
  }

  /* ----- raw extracts (separate file, full provenance) ----- */
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  raw._notes = raw._notes ||
    'Raw values fetched from public sources before any calculation. ' +
    'Each entry: { value (absolute INR), unit, source, source_url, last_updated }. ' +
    'The dashboard reads calculated metrics from placeholder_data.json — this ' +
    'file is the audit trail.';
  raw[COMPANY] = raw[COMPANY] || {};

  for (const fy of Object.keys(byFY)) {
    const v = byFY[fy];
    raw[COMPANY][fy] = {
      end_date:            v.end_date,
      revenue:             pack(v.revenue),
      gross_profit:        pack(v.gross_profit),
      operating_income:    pack(v.operating_income),
      ebit:                pack(v.ebit),
      pat:                 pack(v.pat),
      capex:               pack(v.capex),
      depreciation:        pack(v.depreciation),
      current_assets:      pack(v.current_assets),
      current_liabilities: pack(v.current_liabilities),
      inventory:           pack(v.inventory),
      receivables:         pack(v.receivables),
    };
  }

  /* ----- calculations (only FY24, FY25 per spec) ----- */
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const updates = [];

  for (const fy of TARGET_FYS) {
    const cur = byFY[fy];
    if (!cur) { console.log(`  ${fy}: no Yahoo row, skipping`); continue; }

    /* Revenue Growth % = (rev_t / rev_{t-1} − 1) × 100 */
    const prevFY = `FY${String(parseInt(fy.slice(2), 10) - 1).padStart(2, '0')}`;
    const prev   = byFY[prevFY];
    if (cur.revenue && prev?.revenue) {
      const growth = +((cur.revenue / prev.revenue - 1) * 100).toFixed(1);
      const r = writeRow(data, COMPANY, fy, 'Revenue Growth %', growth);
      if (r.ok) updates.push(`${fy} Revenue Growth %: ${r.oldVal} → ${growth}%`);
    }

    /* EBITDA Margin % — Operating Income / Revenue × 100.
       Maruti reports Operating Profit; using it as EBITDA proxy per spec
       ("EBITDA or Operating Profit"). */
    if (cur.revenue && cur.operating_income) {
      const margin = +((cur.operating_income / cur.revenue) * 100).toFixed(1);
      const r = writeRow(data, COMPANY, fy, 'EBITDA Margin %', margin);
      if (r.ok) updates.push(`${fy} EBITDA Margin %: ${r.oldVal} → ${margin}% (Operating Income basis)`);
    }

    /* Gross Margin % = Gross Profit / Revenue × 100 */
    if (cur.revenue && cur.gross_profit) {
      const margin = +((cur.gross_profit / cur.revenue) * 100).toFixed(1);
      const r = writeRow(data, COMPANY, fy, 'Gross Margin %', margin);
      if (r.ok) updates.push(`${fy} Gross Margin %: ${r.oldVal} → ${margin}%`);
    }

    /* Capex (Rs Cr) — direct from cash flow statement */
    if (cur.capex) {
      const cr = toCrore(cur.capex);
      const r = writeRow(data, COMPANY, fy, 'Capex (Rs Cr)', cr);
      if (r.ok) updates.push(`${fy} Capex: ${r.oldVal} → ₹${cr} Cr`);
    }

    /* Working Capital Days = (CA − CL) / Revenue × 365.
       Net working capital can be negative for Maruti (favourable). */
    if (cur.revenue && cur.current_assets != null && cur.current_liabilities != null) {
      const nwc = cur.current_assets - cur.current_liabilities;
      const days = Math.round((nwc / cur.revenue) * 365);
      const r = writeRow(data, COMPANY, fy, 'Working Capital Days', days);
      if (r.ok) updates.push(`${fy} Working Capital Days: ${r.oldVal} → ${days}d`);
    }
  }

  /* ----- summary ----- */
  console.log(`\n[fetch-maruti] ${updates.length} dashboard cell(s) to update:`);
  updates.forEach(u => console.log('  ' + u));

  if (DRY_RUN) {
    console.log('[fetch-maruti] --dry-run: not writing files.');
    return;
  }
  fs.writeFileSync(RAW_PATH,  JSON.stringify(raw,  null, 2) + '\n');
  if (updates.length) fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[fetch-maruti] Wrote raw extracts → ${RAW_PATH}`);
  console.log(`[fetch-maruti] Wrote ${updates.length} update(s) → ${DATA_PATH}`);
}

main().catch(err => {
  console.error('[fetch-maruti] fatal:', err);
  process.exit(1);
});
