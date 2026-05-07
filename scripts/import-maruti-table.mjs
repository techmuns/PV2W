#!/usr/bin/env node
/**
 * import-maruti-table.mjs
 *
 * One-shot importer for the Maruti Suzuki dashboard input table
 * (assets/maruti_dashboard_input_table.pdf) supplied by the buy-side
 * analyst. Sources are Maruti Annual Reports + Q4 Investor
 * Presentations + SIAM (per the table's own "Source / method"
 * column). Values are entered directly here so the dashboard is
 * source-backed for FY16-FY25 across every metric the user
 * provided.
 *
 * What this writes:
 *   - data/config/placeholder_data.json:
 *       company_fy_metrics rows for Company="Maruti", FY16..FY25
 *       company_info row for Maruti (CEO/CFO/COO/employees/dealers)
 *
 * What this does NOT write (per the user's "Pending / excluded"
 * section): Export Revenue %, EV Revenue %, SUV Revenue %. Those
 * stay un-sourced and the UI shows "—" in the source column.
 *
 * Idempotent: only updates rows whose Value or Source changed.
 *
 * Usage:
 *   node scripts/import-maruti-table.mjs
 *   node scripts/import-maruti-table.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');

const COMPANY = 'Maruti';
const FYS     = ['FY16','FY17','FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25'];
const TODAY   = new Date().toISOString().slice(0, 10);

const IR_PAGE = 'https://www.marutisuzuki.com/corporate/investors/financial-and-other-information';

/* ──────────────────────────────────────────────────────────────────
   Maruti FY15-FY25 input table.
   FY15 column dropped — dashboard FY range starts at FY16.
   Each entry: { metric, source, values: [FY16..FY25] }.
   ────────────────────────────────────────────────────────────────── */

const TABLE = [
  { metric: 'Capacity Utilisation %',
    source: 'Maruti AR (capacity) + Q4 IP (volume); proxy = sales volume / capacity',
    values: [95.3, 104.6, 101.7, 89.7, 78.2, 72.9, 73.5, 87.4, 90.9, 85.9] },

  { metric: 'Market Share %',
    source: 'Maruti Annual Report / SIAM (domestic PV share)',
    values: [46.8, 47.4, 50.0, 51.2, 51.0, 47.7, 43.4, 41.3, 41.7, 41.4] },

  { metric: 'Revenue Growth %',
    source: 'Maruti Q4 Investor Presentation (net sales growth) / FY25 AR',
    values: [15.9, 18.5, 16.7, 6.3, -13.7, -7.2, 25.9, 34.3, 19.9, 7.5] },

  { metric: 'Volume Growth %',
    source: 'Maruti Q4 Investor Presentation (total sales volume) / FY25 AR',
    values: [10.6, 9.8, 13.4, 4.7, -16.1, -6.7, 13.4, 19.0, 8.6, 4.6] },

  { metric: 'Realisation Growth %',
    source: 'Derived: (1 + revenue growth) / (1 + volume growth) − 1',
    values: [4.8, 7.9, 2.9, 1.5, 2.9, -0.5, 11.0, 12.8, 10.4, 2.8] },

  { metric: 'Gross Margin %',
    source: 'Maruti Q4 IP (material cost %); proxy = 100 − material cost %',
    values: [31.2, 30.3, 29.7, 27.6, 26.0, 23.8, 21.4, 23.5, 25.6, 25.5] },

  { metric: 'EBITDA Margin %',
    source: 'Maruti Q4 Investor Presentation / FY25 AR',
    values: [15.9, 15.5, 15.4, 13.2, 10.2, 8.1, 6.8, 9.8, 12.1, 12.3] },

  { metric: 'Export Volume %',
    source: 'Maruti Q4 Investor Presentation (volume split) / FY25 AR',
    values: [8.7, 7.9, 7.1, 5.8, 6.5, 6.6, 14.0, 13.0, 13.3, 15.0] },

  { metric: 'EV Volume %',
    source: 'Maruti Annual Report / company disclosures (no BEV sales pre-FY25)',
    values: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },

  { metric: 'SUV Volume %',
    source: 'Maruti Q4 IP (domestic segment mix) / FY25 AR (SUV share)',
    values: [7.2, 13.6, 15.3, 15.1, 16.1, 16.8, 21.0, 21.0, 34.7, 28.0] },

  { metric: 'Capex (Rs Cr)',
    source: 'Maruti Annual Report cash flow (PPE + CWIP + intangibles)',
    values: [2581, 3250, 3892, 4745, 3194, 2132, 3206, 6115, 6727, 8349] },

  { metric: 'Working Capital Days',
    source: 'Maruti Annual Report balance sheet (derived)',
    values: [-27, -36, -40, -30, -20, -47, -30, -27, -25, -23] },

  { metric: 'New Model Launches',
    source: 'Maruti Annual Report (product portfolio / launch commentary)',
    values: [3, 2, 3, 2, 2, 0, 0, 3, 3, 2] },

  { metric: 'Facelift Launches',
    source: 'Maruti Annual Report (product portfolio / launch commentary)',
    values: [0, 0, 1, 2, 6, 1, 1, 4, 0, 7] },

  { metric: 'Top Selling Model',
    source: 'Maruti announcements / industry annual model-wise sales',
    values: ['Alto', 'Alto', 'Alto', 'Alto', 'Alto', 'Swift', 'WagonR', 'WagonR', 'WagonR', 'WagonR'] },
];

/* Governance / FY25 only */
const GOVERNANCE = {
  CEO:           'Hisashi Takeuchi',
  CFO:           'Arnab Roy',
  COO:           '—',
  Credit_Rating: '—',
  Employees:     20171,
  Dealers:       4235,
  Source:        'Maruti Annual Report FY25 (KMP / sales channel disclosures)',
  Source_URL:    IR_PAGE,
  Last_Updated:  TODAY,
};

/* ──────────────────────────────────────────────────────────────────
   YoY + signal helpers
   ────────────────────────────────────────────────────────────────── */

const isPctMetric = (m) => m.includes('%') || /Margin|Share/.test(m);
const isDaysMetric = (m) => m.includes('Days');
const isStringMetric = (m) => m === 'Top Selling Model';

function yoyFor(metric, curr, prev) {
  if (prev == null || curr == null) return null;
  if (isStringMetric(metric)) return null;
  if (isPctMetric(metric))   return +(curr - prev).toFixed(1);          // pp delta
  if (isDaysMetric(metric))  return +(curr - prev).toFixed(1);          // raw delta
  /* counts (launches) — small ints, raw delta */
  if (/Launches/.test(metric)) return curr - prev;
  /* currency / count — % change */
  if (prev === 0) return null;
  return +(((curr - prev) / Math.abs(prev)) * 100).toFixed(1);
}

function signalFor(metric, curr, prev, yoy) {
  if (curr == null) return 'Neutral';
  if (isStringMetric(metric)) return 'Neutral';
  /* Working Capital Days: more negative = better (supplier finance funding ops) */
  if (isDaysMetric(metric)) {
    if (yoy == null) return 'Neutral';
    return yoy < 0 ? 'Positive' : (yoy > 0 ? 'Negative' : 'Neutral');
  }
  /* Capex: directional interpretation depends on cycle stage; keep Neutral */
  if (/Capex/.test(metric)) return 'Neutral';
  /* Launches: more is generally Positive */
  if (/Launches/.test(metric)) {
    if (yoy == null) return 'Neutral';
    return yoy > 0 ? 'Positive' : (yoy < 0 ? 'Negative' : 'Neutral');
  }
  /* All other: up=Positive, down=Negative, near-zero=Neutral */
  if (yoy == null) return 'Neutral';
  if (Math.abs(yoy) < 0.5) return 'Neutral';
  return yoy > 0 ? 'Positive' : 'Negative';
}

/* ──────────────────────────────────────────────────────────────────
   Apply
   ────────────────────────────────────────────────────────────────── */

function applyMetricRow(data, metric, fy, value, yoy, signal, sourceLabel) {
  let row = data.company_fy_metrics.find(r =>
    r.Company === COMPANY && r.FY === fy && r.Metric === metric);
  if (!row) {
    /* Some pre-seed rows don't exist for FY16-FY22 (Export/EV/SUV
       Volume %, Launches, Top Selling Model). Create them so the
       trend modal has 10-yr coverage. */
    row = {
      FY: fy, Company: COMPANY, Metric: metric,
      Value: null, YoY_Change: null, Signal: 'Neutral',
      Source: 'Pending', Source_URL: null, Last_Updated: null,
    };
    data.company_fy_metrics.push(row);
  }
  const same = row.Value === value && row.Source === sourceLabel
            && row.Source_URL === IR_PAGE && row.YoY_Change === yoy
            && row.Signal === signal;
  if (same) return { status: 'unchanged' };
  const before = row.Value;
  row.Value        = value;
  row.YoY_Change   = yoy;
  row.Signal       = signal;
  row.Source       = sourceLabel;
  row.Source_URL   = IR_PAGE;
  row.Last_Updated = TODAY;
  return { status: 'updated', before, after: value };
}

function applyGovernance(data) {
  const row = data.company_info.find(r => r.Company === COMPANY);
  if (!row) return 'no-row';
  const before = JSON.stringify({
    CEO: row.CEO, CFO: row.CFO, COO: row.COO,
    Credit_Rating: row.Credit_Rating, Employees: row.Employees,
    Dealers: row.Dealers, Source: row.Source });
  Object.assign(row, GOVERNANCE);
  const after = JSON.stringify({
    CEO: row.CEO, CFO: row.CFO, COO: row.COO,
    Credit_Rating: row.Credit_Rating, Employees: row.Employees,
    Dealers: row.Dealers, Source: row.Source });
  return before === after ? 'unchanged' : 'updated';
}

/* ──────────────────────────────────────────────────────────────────
   Main
   ────────────────────────────────────────────────────────────────── */

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const stats = { updated: 0, unchanged: 0, missing: 0 };
  const updates = [];

  for (const { metric, source, values } of TABLE) {
    if (values.length !== FYS.length) {
      throw new Error(`${metric}: expected ${FYS.length} values, got ${values.length}`);
    }
    for (let i = 0; i < FYS.length; i++) {
      const fy   = FYS[i];
      const curr = values[i];
      const prev = i > 0 ? values[i - 1] : null;
      const yoy  = yoyFor(metric, curr, prev);
      const sig  = signalFor(metric, curr, prev, yoy);
      const r = applyMetricRow(data, metric, fy, curr, yoy, sig, source);
      stats[r.status] = (stats[r.status] || 0) + 1;
      if (r.status === 'updated') {
        updates.push(`  ${fy} ${metric}: ${r.before} → ${r.after}${yoy != null ? ` (yoy ${yoy})` : ''}`);
      }
    }
  }

  const govStatus = applyGovernance(data);
  console.log(`Governance row: ${govStatus}`);

  console.log('\n=== Maruti import summary ===');
  console.log(`updated: ${stats.updated || 0}`);
  console.log(`unchanged: ${stats.unchanged || 0}`);
  console.log(`missing: ${stats['no-row'] || 0}`);
  if (updates.length && updates.length <= 30) updates.forEach(u => console.log(u));
  else if (updates.length) console.log(`(${updates.length} cell updates — list suppressed)`);

  if (DRY_RUN) {
    console.log('\n--dry-run: not writing file.');
    return;
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nwrote → ${DATA_PATH}`);
}

main();
