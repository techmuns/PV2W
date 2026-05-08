#!/usr/bin/env node
/**
 * import-hyundai-table.mjs
 *
 * One-shot importer for the Hyundai Motor India dashboard input
 * table at assets/hyundai_dashboard_input_table_updated.pdf,
 * supplied by the buy-side analyst.
 *
 * Coverage: FY19-FY25 (FY16-FY18 excluded by the analyst because
 * 'clean Hyundai uploaded sources are not available').
 *
 * Sources cited in the PDF (per row):
 *   Hyundai Annual Reports FY21-FY25
 *   HMIL DRHP (Draft Red Herring Prospectus)
 *   Hyundai Q4 FY25 Investor Presentation
 *
 * What this writes:
 *   - data/config/placeholder_data.json:
 *       company_fy_metrics rows for Company='Hyundai', FY19-FY25
 *       company_info row for Hyundai (CFO, Credit Rating, dealers)
 *
 * What this does NOT write (per the analyst's 'Pending /
 * excluded' section):
 *   - Market Share % (no clean SIAM series in uploaded sources)
 *   - Working Capital Days (not directly disclosed)
 *   - Top Selling Model (not annually disclosed)
 *   - Powertrain mix FY19-FY23 (not in uploaded sources)
 *
 * Idempotent: only updates rows whose Value or Source changed.
 *
 * Usage:
 *   node scripts/import-hyundai-table.mjs
 *   node scripts/import-hyundai-table.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');

const COMPANY = 'Hyundai';
/* PDF covers FY19-FY25; ordering kept compatible with FYS_FULL. */
const FYS     = ['FY19','FY20','FY21','FY22','FY23','FY24','FY25'];
const TODAY   = new Date().toISOString().slice(0, 10);

const IR_PAGE     = 'https://www.hyundai.com/in/en/about-us/investor-relations';
const Q4_FY25_IP  = 'https://www.hyundai.com/in/en/about-us/investor-relations/financial-reports';
const AR_PAGE     = 'https://www.hyundai.com/in/en/about-us/investor-relations/annual-report';
const DRHP        = 'https://www.hyundai.com/in/en/about-us/investor-relations';   // DRHP redirects through IR

/* ──────────────────────────────────────────────────────────────────
   Hyundai FY19-FY25 input table.
   '-' (null) means the analyst left the cell blank.
   Each row carries the source label + URL the PDF cites.
   ────────────────────────────────────────────────────────────────── */

const TABLE = [
  /* Capacity Utilisation %: FY21-FY23 from DRHP; FY24/FY25 proxy */
  { metric: 'Capacity Utilisation %',
    source: 'HMIL DRHP (FY21-FY23) / Q4 FY25 IP proxy: production ÷ 824k stated capacity',
    source_url: DRHP,
    values: [null, null, 75.5, 80.0, 94.5, 95.6, 92.6] },

  /* Revenue Growth % uses the analyst's 'Turnover Growth %' (full
     series available; revenue-from-operations only goes to FY21+). */
  { metric: 'Revenue Growth %',
    source: 'Hyundai Annual Report turnover KPI (sale of products + services excl. transportation income)',
    source_url: AR_PAGE,
    values: [null, -0.5, -4.2, 14.6, 26.4, 15.3, -1.6] },

  { metric: 'Volume Growth %',
    source: 'Total sales volume YoY (domestic + exports), Hyundai Annual Reports',
    source_url: AR_PAGE,
    values: [null, -7.4, -12.1, 6.1, 18.0, 8.0, -2.0] },

  { metric: 'Realisation Growth %',
    source: 'Derived: (1 + turnover growth) / (1 + volume growth) − 1',
    source_url: AR_PAGE,
    values: [null, 7.4, 9.0, 8.0, 7.1, 6.8, 0.4] },

  /* Gross Margin proxy — only FY24/FY25 in the IP key-ratios block */
  { metric: 'Gross Margin %',
    source: 'Hyundai Q4 FY25 Investor Presentation key ratios (proxy = 100 − material cost %)',
    source_url: Q4_FY25_IP,
    values: [null, null, null, null, null, 26.2, 27.8] },

  { metric: 'EBITDA Margin %',
    source: 'FY19-FY23 EBITDA ÷ turnover KPI; FY24/FY25 from Q4 FY25 Investor Presentation',
    source_url: AR_PAGE,
    values: [13.6, 12.3, 11.9, 13.5, 15.3, 13.1, 12.9] },

  { metric: 'Export Volume %',
    source: 'Export sales ÷ total sales volume, Hyundai Annual Reports',
    source_url: AR_PAGE,
    values: [22.9, 25.9, 18.1, 21.2, 21.2, 21.0, 21.4] },

  { metric: 'SUV Volume %',
    source: 'FY21-FY23 from DRHP domestic SUV share; FY24/FY25 from Q4 FY25 IP',
    source_url: Q4_FY25_IP,
    values: [null, null, 45.4, 52.0, 53.2, 63.0, 69.0] },

  /* EV Volume % — analyst's 'Domestic EV Mix %' (Q4 IP fuel mix). */
  { metric: 'EV Volume %',
    source: 'Hyundai Q4 FY25 Investor Presentation (domestic fuel mix)',
    source_url: Q4_FY25_IP,
    values: [null, null, null, null, null, 0.3, 1.0] },

  { metric: 'Capex (Rs Cr)',
    source: 'Hyundai Q4 FY25 Investor Presentation (annual investment / additional investment)',
    source_url: Q4_FY25_IP,
    values: [null, null, null, null, null, 3076, 5626] },

  { metric: 'New Model Launches',
    source: 'Hyundai Annual Reports / Q4 FY25 IP (disclosure-based count)',
    source_url: AR_PAGE,
    values: [null, null, null, 5, 7, 5, 4] },
];

/* Per-FY Sales Outlets (Network) — written into a separate
   'Dealers / Sales Outlets' metric so the Supporting Data table
   has the count for every FY, not just FY25. */
const SALES_OUTLETS = {
  FY21: 1167, FY22: 1282, FY23: 1336, FY24: 1363, FY25: 1419,
};
const OUTLETS_SOURCE = {
  source: 'HMIL DRHP / Q4 FY25 Investor Presentation (sales outlets)',
  source_url: Q4_FY25_IP,
};

/* Governance — overrides applicable seeds. */
const GOVERNANCE = {
  CEO:           'Unsoo Kim',
  CFO:           'Wangdo Hur',
  COO:           'Tarun Garg',
  Credit_Rating: 'CRISIL AAA / Stable; CRISIL A1+',
  Source:        'Hyundai FY25 Annual Report (KMP / Board disclosures); HMIL IR credit rating page',
  Source_URL:    AR_PAGE,
  Last_Updated:  TODAY,
};

/* ──────────────────────────────────────────────────────────────────
   YoY + signal helpers (mirror the Maruti importer's conventions)
   ────────────────────────────────────────────────────────────────── */

const isPctMetric = (m) => m.includes('%') || /Margin|Share/.test(m);
const isDaysMetric = (m) => m.includes('Days');

function yoyFor(metric, curr, prev) {
  if (curr == null || prev == null) return null;
  if (isPctMetric(metric))   return +(curr - prev).toFixed(1);
  if (isDaysMetric(metric))  return +(curr - prev).toFixed(1);
  if (/Launches/.test(metric)) return curr - prev;
  if (prev === 0) return null;
  return +(((curr - prev) / Math.abs(prev)) * 100).toFixed(1);
}

function signalFor(metric, curr, prev, yoy) {
  if (curr == null) return 'Neutral';
  if (isDaysMetric(metric)) {
    if (yoy == null) return 'Neutral';
    return yoy < 0 ? 'Positive' : (yoy > 0 ? 'Negative' : 'Neutral');
  }
  if (/Capex/.test(metric)) return 'Neutral';
  if (/Launches/.test(metric)) {
    if (yoy == null) return 'Neutral';
    return yoy > 0 ? 'Positive' : (yoy < 0 ? 'Negative' : 'Neutral');
  }
  if (yoy == null) return 'Neutral';
  if (Math.abs(yoy) < 0.5) return 'Neutral';
  return yoy > 0 ? 'Positive' : 'Negative';
}

/* ──────────────────────────────────────────────────────────────────
   Apply
   ────────────────────────────────────────────────────────────────── */

function applyMetricRow(data, metric, fy, value, yoy, signal, sourceLabel, sourceUrl) {
  let row = data.company_fy_metrics.find(r =>
    r.Company === COMPANY && r.FY === fy && r.Metric === metric);
  if (!row) {
    row = {
      FY: fy, Company: COMPANY, Metric: metric,
      Value: null, YoY_Change: null, Signal: 'Neutral',
      Source: 'Pending', Source_URL: null, Last_Updated: null,
    };
    data.company_fy_metrics.push(row);
  }
  /* Skip cells the analyst left blank — keep existing placeholder. */
  if (value == null) return { status: 'skipped' };
  const same = row.Value === value && row.Source === sourceLabel
            && row.Source_URL === sourceUrl && row.YoY_Change === yoy
            && row.Signal === signal;
  if (same) return { status: 'unchanged' };
  const before = row.Value;
  row.Value        = value;
  row.YoY_Change   = yoy;
  row.Signal       = signal;
  row.Source       = sourceLabel;
  row.Source_URL   = sourceUrl;
  row.Last_Updated = TODAY;
  return { status: 'updated', before, after: value };
}

function applyGovernance(data) {
  const row = data.company_info.find(r => r.Company === COMPANY);
  if (!row) return 'no-row';
  const before = JSON.stringify({ CEO: row.CEO, CFO: row.CFO, COO: row.COO,
    Credit_Rating: row.Credit_Rating, Source: row.Source });
  Object.assign(row, GOVERNANCE);
  /* Outlets / employees: write the latest FY's count into Dealers. */
  if (SALES_OUTLETS.FY25 != null) row.Dealers = SALES_OUTLETS.FY25;
  const after = JSON.stringify({ CEO: row.CEO, CFO: row.CFO, COO: row.COO,
    Credit_Rating: row.Credit_Rating, Source: row.Source });
  return before === after ? 'unchanged' : 'updated';
}

function applyOutlets(data) {
  let touched = 0;
  for (const [fy, val] of Object.entries(SALES_OUTLETS)) {
    let row = data.company_fy_metrics.find(r =>
      r.Company === COMPANY && r.FY === fy && r.Metric === 'Dealers / Sales Outlets');
    if (!row) {
      row = {
        FY: fy, Company: COMPANY, Metric: 'Dealers / Sales Outlets',
        Value: null, YoY_Change: null, Signal: 'Neutral',
        Source: 'Pending', Source_URL: null, Last_Updated: null,
      };
      data.company_fy_metrics.push(row);
    }
    if (row.Value === val && row.Source === OUTLETS_SOURCE.source) continue;
    row.Value        = val;
    row.Source       = OUTLETS_SOURCE.source;
    row.Source_URL   = OUTLETS_SOURCE.source_url;
    row.Last_Updated = TODAY;
    touched++;
  }
  return touched;
}

/* ──────────────────────────────────────────────────────────────────
   Main
   ────────────────────────────────────────────────────────────────── */

function main() {
  console.log('[import-hyundai-table] starting…');
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const stats = { updated: 0, unchanged: 0, skipped: 0 };

  for (const { metric, source, source_url, values } of TABLE) {
    if (values.length !== FYS.length) {
      throw new Error(`${metric}: expected ${FYS.length} values, got ${values.length}`);
    }
    for (let i = 0; i < FYS.length; i++) {
      const fy   = FYS[i];
      const curr = values[i];
      const prev = i > 0 ? values[i - 1] : null;
      const yoy  = yoyFor(metric, curr, prev);
      const sig  = signalFor(metric, curr, prev, yoy);
      const r    = applyMetricRow(data, metric, fy, curr, yoy, sig, source, source_url);
      stats[r.status] = (stats[r.status] || 0) + 1;
    }
  }

  const govStatus = applyGovernance(data);
  const outletsTouched = applyOutlets(data);

  console.log('\n=== Hyundai import summary ===');
  console.log(`updated:      ${stats.updated || 0}`);
  console.log(`unchanged:    ${stats.unchanged || 0}`);
  console.log(`skipped (—):  ${stats.skipped || 0}`);
  console.log(`governance:   ${govStatus}`);
  console.log(`outlets rows: ${outletsTouched}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: not writing file.');
    return;
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nwrote → ${DATA_PATH}`);
}

main();
