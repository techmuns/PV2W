#!/usr/bin/env node
/**
 * fetch-stock.mjs
 *
 * Live data refresh — Stock Price (31-Mar).
 *
 * Pulls each OEM's daily close from Yahoo Finance for the relevant
 * March, finds the last trading day of that month, and writes the
 * close into data/config/placeholder_data.json under the matching
 * (Company, FY, Metric="Stock Price (31-Mar)") row, along with
 * Source / Source_URL / Last_Updated.
 *
 * Yahoo Finance is used because:
 *   - Free, no auth, stable JSON endpoint
 *   - Mirrors NSE close prices (the "Stock Price (31-Mar)" cell in
 *     Maruti / M&M / Tata / Hyundai's annual reports refers to NSE
 *     closing price on the last trading day of FY)
 *   - Same data the Indian financial press cites
 *
 * Usage:
 *   node scripts/fetch-stock.mjs            # fetch + write
 *   node scripts/fetch-stock.mjs --dry-run  # fetch, log, don't write
 *
 * Run automatically by .github/workflows/refresh-data.yml.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH  = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN    = process.argv.includes('--dry-run');

/* NSE tickers via Yahoo Finance.
   Hyundai Motor India listed Oct 2024 — only FY25+ has data. */
const COMPANY_TICKERS = {
  "Maruti":         "MARUTI.NS",
  "M&M":            "M%26M.NS",      // URL-encoded ampersand
  "Tata Motors PV": "TATAMOTORS.NS",
  "Hyundai":        "HYUNDAI.NS",
};

const FY_LIST = ["FY23", "FY24", "FY25"];

/* FY25 → year ending 31 Mar 2025, so we look at March of 2025. */
const fyToMarchYear = (fy) => 2000 + parseInt(fy.replace(/^FY/, ""), 10);

async function fetchMarchClose(ticker, fyYear) {
  const start = Math.floor(Date.UTC(fyYear, 2, 1)  / 1000);   // 1 Mar
  const end   = Math.floor(Date.UTC(fyYear, 3, 5)  / 1000);   // 5 Apr (buffer)
  const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}` +
                `?period1=${start}&period2=${end}&interval=1d`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pv-dashboard-bot)' },
  });
  if (!res.ok) {
    return { ok: false, reason: `HTTP ${res.status}` };
  }
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    return { ok: false, reason: 'no result block' };
  }
  const ts     = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  let lastClose = null;
  let lastDate  = null;
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

async function main() {
  console.log(`[fetch-stock] Reading ${DATA_PATH}`);
  const data  = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const [company, ticker] of Object.entries(COMPANY_TICKERS)) {
    console.log(`\n[${company}] ${ticker}`);
    for (const fy of FY_LIST) {
      const year = fyToMarchYear(fy);
      const result = await fetchMarchClose(ticker, year);
      if (!result.ok) {
        console.log(`  ${fy}: skipped (${result.reason})`);
        skipped++;
        continue;
      }
      const row = data.company_fy_metrics.find(r =>
        r.Company === company && r.FY === fy &&
        r.Metric === 'Stock Price (31-Mar)'
      );
      if (!row) {
        console.log(`  ${fy}: no matching row in dataset, skipping`);
        skipped++;
        continue;
      }
      const newVal = Math.round(result.close * 100) / 100;
      const dateStr = result.date.toISOString().slice(0, 10);
      if (row.Value === newVal && row.Source && row.Source.startsWith('Yahoo')) {
        console.log(`  ${fy}: unchanged at ₹${newVal} (close ${dateStr})`);
        unchanged++;
        continue;
      }
      console.log(`  ${fy}: ${row.Value ?? '—'} → ₹${newVal} (close ${dateStr})`);
      row.Value         = newVal;
      row.Source        = 'Yahoo Finance (NSE close)';
      row.Source_URL    = `https://finance.yahoo.com/quote/${ticker}/history`;
      row.Last_Updated  = today;
      updated++;
    }
    /* polite pacing — Yahoo can rate-limit if hammered */
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n[fetch-stock] updated=${updated} unchanged=${unchanged} skipped=${skipped}`);

  if (DRY_RUN) {
    console.log('[fetch-stock] --dry-run: not writing file.');
    return;
  }
  if (updated === 0) {
    console.log('[fetch-stock] No updates — leaving file untouched.');
    return;
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[fetch-stock] Wrote ${updated} update(s) to placeholder_data.json`);
}

main().catch(err => {
  console.error('[fetch-stock] fatal:', err);
  process.exit(1);
});
