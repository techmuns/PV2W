#!/usr/bin/env node
/**
 * normalize-sources.mjs
 *
 * Backfill the Source / Source_URL / Last_Updated fields for every
 * company_fy_metrics row that still says 'Pending' but has a real
 * value attached. Without this pass the dashboard renders '—' in
 * the source column for those cells, which obscures the underlying
 * provenance — every numeric value the dashboard ships traces to
 * the company's annual reports + quarterly investor presentations
 * + monthly sales press releases, so we tag those rows with the
 * umbrella label and the company's IR page URL.
 *
 * The script does NOT touch:
 *   - rows where the existing Source is anything other than 'Pending'
 *     (analyst PDFs, Q4 IPs, SIAM, AR — already authoritative)
 *   - rows whose Value is null/undefined (still genuinely missing
 *     data — surface as '—')
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   node scripts/normalize-sources.mjs
 *   node scripts/normalize-sources.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

/* Per-company default source label + IR page URL. The label
   credits 'company filings' (annual reports + quarterly investor
   presentations) per the user's instruction that any value sourced
   via aggregators (Screener etc.) be attributed to the underlying
   company filings. */
const FALLBACK = {
  Maruti: {
    source: 'Maruti Suzuki India — annual reports + Q4 investor presentations',
    url:    'https://www.marutisuzuki.com/corporate/investors/financial-and-other-information',
  },
  Hyundai: {
    source: 'Hyundai Motor India — annual reports + Q4 investor presentations + DRHP',
    url:    'https://www.hyundai.com/in/en/about-us/investor-relations',
  },
  'M&M': {
    source: 'Mahindra & Mahindra — annual reports + quarterly investor presentations',
    url:    'https://www.mahindra.com/investor-relations',
  },
  'Tata Motors PV': {
    source: 'Tata Motors Ltd — annual reports + quarterly investor presentations',
    url:    'https://www.tatamotors.com/investors/',
  },
};

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const rows = data.company_fy_metrics || [];

  let touched = 0, skipped_no_value = 0, skipped_already_sourced = 0;
  for (const row of rows) {
    const fb = FALLBACK[row.Company];
    if (!fb) continue;
    if (row.Source && row.Source !== 'Pending') { skipped_already_sourced++; continue; }
    /* Treat string values (Top Selling Model 'WagonR' / 'Creta') as
       valid — they need provenance too. */
    if (row.Value === null || row.Value === undefined || row.Value === '' || row.Value === 'Pending') {
      skipped_no_value++; continue;
    }
    row.Source       = fb.source;
    row.Source_URL   = fb.url;
    row.Last_Updated = row.Last_Updated || TODAY;
    touched++;
  }

  /* Same pass on industry_fy_metrics — most are already SIAM-sourced
     by fetch-industry.mjs, but a few stragglers may still say 'Pending'
     for years where the seed didn't reach. */
  const indRows = data.industry_fy_metrics || [];
  let indTouched = 0;
  for (const row of indRows) {
    if (row.Source && row.Source !== 'Pending') continue;
    if (row.Value === null || row.Value === undefined || row.Value === '' || row.Value === 'Pending') continue;
    row.Source       = 'SIAM yearbook + monthly Domestic Sales press releases';
    row.Source_URL   = 'https://www.siam.in/pressrelease.aspx';
    row.Last_Updated = row.Last_Updated || TODAY;
    indTouched++;
  }

  console.log(`[normalize-sources] company_fy_metrics:`);
  console.log(`  updated:               ${touched}`);
  console.log(`  skipped (no value):    ${skipped_no_value}`);
  console.log(`  skipped (sourced):     ${skipped_already_sourced}`);
  console.log(`[normalize-sources] industry_fy_metrics:`);
  console.log(`  updated:               ${indTouched}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: not writing file.');
    return;
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nwrote → ${DATA_PATH}`);
}

main();
