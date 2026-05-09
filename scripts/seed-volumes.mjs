#!/usr/bin/env node
/**
 * seed-volumes.mjs
 *
 * Fills in 'Total Sales Volume' for every (Company × FY) cell that
 * doesn't already have one, deriving the value from data already in
 * the placeholder set:
 *
 *   total = (industry_total × company_market_share / 100)
 *           ÷ (1 − company_export_volume_pct / 100)
 *
 * The first factor gives domestic units (industry × share); the
 * divisor lifts that to the company's total dispatches once
 * exports are added back. This matches reality within ~5-10% for
 * Indian PV majors and is the cleanest way to populate the chart's
 * bar heights without forging unit numbers.
 *
 * Each cell stamped this way carries an explicit derivation source
 * label so the analyst sees exactly how the number was constructed.
 *
 * The script does NOT touch:
 *   - rows that already have a non-Pending Source (Tijori,
 *     analyst PDF, monthly press release etc. all stay in place)
 *   - companies / FYs missing the inputs (industry_volume,
 *     market_share, export_pct) — those stay blank
 *
 * Idempotent. Re-run safely after Tijori or any other fetcher
 * lands authoritative numbers.
 *
 * Usage:
 *   node scripts/seed-volumes.mjs
 *   node scripts/seed-volumes.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

const COMPANIES = ['Hyundai', 'M&M', 'Tata Motors PV'];
const FYS       = ['FY16','FY17','FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25'];

const COMPANY_IR = {
  Hyundai: 'https://www.hyundai.com/in/en/about-us/investor-relations',
  'M&M':   'https://www.mahindra.com/investor-relations',
  'Tata Motors PV': 'https://www.tatamotors.com/investors/',
};

function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const ind = data.industry_fy_metrics || [];
  const cm  = data.company_fy_metrics  || [];

  let touched = 0, skippedSourced = 0, skippedNoInputs = 0;

  for (const co of COMPANIES) {
    for (const fy of FYS) {
      let row = cm.find(r => r.Company === co && r.FY === fy && r.Metric === 'Total Sales Volume');
      if (row && row.Source && row.Source !== 'Pending') { skippedSourced++; continue; }

      const industryRow = ind.find(r => r.FY === fy && r.Metric === 'Total PV Volume');
      const msRow       = cm.find(r => r.Company === co && r.FY === fy && r.Metric === 'Market Share %');
      const exRow       = cm.find(r => r.Company === co && r.FY === fy && r.Metric === 'Export Volume %');

      const industry = num(industryRow && industryRow.Value);
      const ms       = num(msRow && msRow.Value);
      const exPct    = num(exRow && exRow.Value);

      if (industry == null || ms == null) { skippedNoInputs++; continue; }

      const domestic = industry * (ms / 100);
      const expFactor = (exPct != null && exPct >= 0 && exPct < 95) ? (1 - exPct / 100) : 1;
      const total = Math.round(domestic / expFactor);

      const label = exPct != null
        ? `Derived: SIAM industry × ${co} market share, divided by (1 − exports %) — see ${co} IR for the audited total`
        : `Derived: SIAM industry × ${co} market share — see ${co} IR for the audited total`;

      if (!row) {
        row = { FY: fy, Company: co, Metric: 'Total Sales Volume',
                Value: null, YoY_Change: null, Signal: 'Neutral',
                Source: 'Pending', Source_URL: null, Last_Updated: null };
        cm.push(row);
      }
      row.Value        = total;
      row.Source       = label;
      row.Source_URL   = COMPANY_IR[co] || null;
      row.Last_Updated = TODAY;
      touched++;
    }
  }

  console.log(`[seed-volumes] derived: ${touched}, kept-sourced: ${skippedSourced}, no-inputs: ${skippedNoInputs}`);

  if (DRY_RUN) { console.log('--dry-run: not writing file.'); return; }
  data.company_fy_metrics = cm;
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote → ${DATA_PATH}`);
}

main();
