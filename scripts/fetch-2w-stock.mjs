#!/usr/bin/env node
/**
 * scripts/fetch-2w-stock.mjs
 *
 * Live data refresh — 2W segment Stock Price (31-Mar) for the
 * Indian-listed two-wheeler OEMs. Same Yahoo Finance approach
 * as scripts/fetch-stock.mjs (which handles the PV side).
 *
 * Listed in India (have Yahoo NSE ticker):
 *   TVS            — TVSMOTOR.NS
 *   Bajaj Auto     — BAJAJ-AUTO.NS
 *   Eicher Motors  — EICHERMOT.NS
 *   Hero MotoCorp  — HEROMOTOCO.NS
 *   Ola Electric   — OLAELEC.NS    (IPO Aug 2024 → FY25 onwards)
 *   Ather Energy   — ATHERENERG.NS (IPO 2024     → FY25 onwards)
 *
 * Not listed in India (private subsidiaries — no stock price):
 *   Honda Motorcycle & Scooter India (HMSI)
 *   India Yamaha Motor
 *   Suzuki Motorcycle India
 *
 * Output: appends rows to data/config/placeholder_data.json under
 * a new `segment_metrics` array, following the schema documented
 * in data/config/segments_config.json._dataSchema:
 *
 *   { segment_id, company, fiscal_year, metric, value,
 *     source_url, last_updated }
 *
 * Usage:
 *   node scripts/fetch-2w-stock.mjs            # fetch + write
 *   node scripts/fetch-2w-stock.mjs --dry-run  # log only
 *
 * Wired into .github/workflows/refresh-data.yml as a continue-on-
 * error step so a Yahoo rate-limit doesn't break the whole pipeline.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');

/* NSE tickers via Yahoo Finance. Only listed entities — the three
   non-listed (Honda HMSI, Yamaha India, Suzuki Motorcycle India)
   are private subsidiaries with no public share price. */
const TWO_W_TICKERS = {
  "TVS":           "TVSMOTOR.NS",
  "Bajaj Auto":    "BAJAJ-AUTO.NS",
  "Eicher Motors": "EICHERMOT.NS",
  "Hero MotoCorp": "HEROMOTOCO.NS",
  "Ola Electric":  "OLAELEC.NS",
  "Ather Energy":  "ATHERENERG.NS",
};

/* Full 10-year FY window so the dashboard's FY16-FY25 history fills
   in for the four long-listed OEMs (TVS / Bajaj Auto / Eicher / Hero
   MotoCorp). Ola Electric listed Aug 2024 and Ather Energy listed
   Aug 2024, so any pre-FY25 March close lookup for those tickers
   returns "no March close in window" and is gracefully skipped. */
const FY_LIST = [
  "FY16","FY17","FY18","FY19","FY20",
  "FY21","FY22","FY23","FY24","FY25",
];

const fyToMarchYear = (fy) => 2000 + parseInt(fy.replace(/^FY/, ""), 10);

async function fetchMarchClose(ticker, fyYear) {
  const start = Math.floor(Date.UTC(fyYear, 2, 1) / 1000);
  const end   = Math.floor(Date.UTC(fyYear, 3, 5) / 1000);
  const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}` +
                `?period1=${start}&period2=${end}&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pv-dashboard-bot)' },
  });
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  const json   = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return { ok: false, reason: 'no result block' };
  const ts     = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  let lastClose = null, lastDate = null;
  for (let i = 0; i < ts.length; i++) {
    const d = new Date(ts[i] * 1000);
    if (d.getUTCMonth() === 2 && closes[i] !== null && closes[i] !== undefined) {
      if (!lastDate || d > lastDate) {
        lastDate  = d;
        lastClose = closes[i];
      }
    }
  }
  if (lastClose === null) return { ok: false, reason: 'no March close in window' };
  return { ok: true, close: lastClose, date: lastDate };
}

/* Upsert a row in placeholder.segment_metrics keyed by
   (segment_id, company, fiscal_year, metric). */
function upsertRow(data, row) {
  if (!Array.isArray(data.segment_metrics)) data.segment_metrics = [];
  const existing = data.segment_metrics.find(r =>
    r.segment_id  === row.segment_id  &&
    r.company     === row.company     &&
    r.fiscal_year === row.fiscal_year &&
    r.metric      === row.metric
  );
  if (existing) {
    if (existing.value === row.value && existing.source_url === row.source_url) return false;
    Object.assign(existing, row);
    return true;
  }
  data.segment_metrics.push(row);
  return true;
}

async function main() {
  console.log(`[fetch-2w-stock] Reading ${DATA_PATH}`);
  const data  = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  let updated = 0, skipped = 0;

  for (const [company, ticker] of Object.entries(TWO_W_TICKERS)) {
    console.log(`\n[${company}] ${ticker}`);
    for (const fy of FY_LIST) {
      const year = fyToMarchYear(fy);
      const result = await fetchMarchClose(ticker, year);
      if (!result.ok) {
        console.log(`  ${fy}: skipped (${result.reason})`);
        skipped++;
        continue;
      }
      const value = Math.round(result.close * 100) / 100;
      const dateStr = result.date.toISOString().slice(0, 10);
      const row = {
        segment_id:  "2W",
        company:     company,
        fiscal_year: fy,
        metric:      "Stock Price (31-Mar)",
        value:       value,
        source_url:  `https://finance.yahoo.com/quote/${ticker}/history`,
        last_updated: today,
        note:        `Yahoo Finance NSE close on ${dateStr}`,
      };
      const changed = upsertRow(data, row);
      console.log(`  ${fy}: ${changed ? 'wrote' : 'unchanged'} ₹${value} (close ${dateStr})`);
      if (changed) updated++;
    }
    await new Promise(r => setTimeout(r, 250));    // polite pacing
  }

  console.log(`\n[fetch-2w-stock] updated=${updated} skipped=${skipped}`);
  if (DRY_RUN) { console.log('[fetch-2w-stock] --dry-run: not writing.'); return; }
  if (updated === 0) { console.log('[fetch-2w-stock] No updates — leaving file untouched.'); return; }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[fetch-2w-stock] Wrote ${updated} update(s) to placeholder_data.json`);
}

main().catch(err => {
  console.error('[fetch-2w-stock] fatal:', err);
  process.exit(1);
});
