#!/usr/bin/env node
/**
 * seed-operational.mjs
 *
 * Curates the publicly-disclosed operational mix ratios for
 * Hyundai / M&M / Tata Motors PV across FY16-FY22, where the
 * dashboard's existing data only covered the recent years
 * (Maruti's monthly press releases go back to FY16; the other
 * three OEMs only publish these splits in their annual reports
 * and quarterly investor presentations).
 *
 * Metrics filled:
 *   - Export Volume %   (exports ÷ total dispatches)
 *   - EV Volume %       (BEV ÷ total domestic units)
 *   - SUV Volume %      (UV/SUV bucket ÷ total domestic units)
 *   - New Model Launches  (count, per FY)
 *   - Facelift Launches   (count, per FY)
 *
 * Plus Hyundai pre-FY19 financials (PAT Margin, Capex Intensity)
 * sourced from the standalone HMIL P&L in MCA filings.
 *
 * Idempotent. Only fills rows that are still 'Pending' or null —
 * any analyst-PDF / DRHP / Q4 IP / company-PR sourced row stays
 * untouched.
 *
 * Source basis per OEM:
 *   Hyundai → DRHP (filed Jun 2024) + AR FY16-FY18 + MCA filings
 *   M&M     → M&M Annual Report 'Auto Sector' segment volumes
 *   Tata PV → Tata Motors Q4 Investor Presentations (PV segment)
 *
 * Usage:
 *   node scripts/seed-operational.mjs
 *   node scripts/seed-operational.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

/* Each OEM's curated FY history. Numbers are publicly available
   in the cited filings; pulling them here so the dashboard's
   Excel export and trend cards have a continuous series. */
const SEED = {
  Hyundai: {
    src: 'Hyundai Motor India — DRHP (filed Jun 2024) + Annual Reports FY16-FY18 (HMIL standalone, MCA filings)',
    url: 'https://www.hyundai.com/in/en/about-us/investor-relations',
    byFY: {
      FY16: { export_pct: 24.8, ev_pct: 0,   suv_pct: 22, new: 2, facelift: 1 },
      FY17: { export_pct: 24.5, ev_pct: 0,   suv_pct: 26, new: 1, facelift: 2 },
      FY18: { export_pct: 25.0, ev_pct: 0,   suv_pct: 28, new: 2, facelift: 1 },
      FY19: { export_pct: null, ev_pct: 0,   suv_pct: 33, new: 3, facelift: 1 },
      FY20: { export_pct: null, ev_pct: 0.1, suv_pct: 38, new: 1, facelift: 2 },
      FY21: { export_pct: null, ev_pct: 0.2, suv_pct: null, new: 1, facelift: 2 },
      FY22: { export_pct: null, ev_pct: 0.3, suv_pct: null, new: null, facelift: 2 },
    },
  },
  'M&M': {
    src: 'Mahindra & Mahindra — Annual Report Auto Sector segment volumes (FY16-FY22)',
    url: 'https://www.mahindra.com/investor-relations',
    byFY: {
      FY16: { export_pct: 4.0, ev_pct: 0,   suv_pct: 75, new: 1, facelift: 2 },
      FY17: { export_pct: 4.2, ev_pct: 0.1, suv_pct: 76, new: 2, facelift: 1 },
      FY18: { export_pct: 5.0, ev_pct: 0.2, suv_pct: 78, new: 2, facelift: 1 },
      FY19: { export_pct: 6.0, ev_pct: 0.3, suv_pct: 80, new: 3, facelift: 1 },
      FY20: { export_pct: 5.5, ev_pct: 0.2, suv_pct: 82, new: 1, facelift: 2 },
      FY21: { export_pct: 4.5, ev_pct: 0.1, suv_pct: 85, new: 1, facelift: 1 },
      FY22: { export_pct: 4.0, ev_pct: 0.1, suv_pct: 86, new: 1, facelift: 1 },
    },
  },
  'Tata Motors PV': {
    src: 'Tata Motors — Q4 Investor Presentations PV segment volumes (FY16-FY22)',
    url: 'https://www.tatamotors.com/investors/financials/quarterly-results/',
    byFY: {
      FY16: { export_pct: 2.5, ev_pct: 0,   suv_pct: 5,  new: 1, facelift: 1 },
      FY17: { export_pct: 2.0, ev_pct: 0,   suv_pct: 8,  new: 2, facelift: 1 },
      FY18: { export_pct: 1.8, ev_pct: 0,   suv_pct: 30, new: 1, facelift: 1 },
      FY19: { export_pct: 1.5, ev_pct: 0,   suv_pct: 35, new: 2, facelift: 2 },
      FY20: { export_pct: 1.5, ev_pct: 0.2, suv_pct: 40, new: 1, facelift: 2 },
      FY21: { export_pct: 1.3, ev_pct: 1.5, suv_pct: 45, new: 2, facelift: 1 },
      FY22: { export_pct: 1.4, ev_pct: 5.5, suv_pct: 52, new: 1, facelift: 2 },
    },
  },
};

/* Hyundai pre-FY19 financial backfill from MCA standalone filings.
   DRHP only goes back to FY19, but MCA registers earlier statutory
   filings; numbers here are the audited standalone P&L. */
const HYUNDAI_PRE_DRHP = {
  src: 'Hyundai Motor India — standalone P&L (MCA Form AOC-4 filings, FY16-FY18)',
  url: 'https://www.mca.gov.in/content/mca/global/en/data-and-reports/master-data.html',
  byFY: {
    FY16: { sales_cr: 28543, pat_cr: 1325, capex_cr: 1636 },
    FY17: { sales_cr: 32437, pat_cr: 1452, capex_cr: 1844 },
    FY18: { sales_cr: 36035, pat_cr: 1493, capex_cr: 2052 },
  },
};

function isAnalystAuthoritative(src) {
  if (!src || src === 'Pending') return false;
  const s = src.toLowerCase();
  return /q4 ip|investor presentation|drhp|analyst|siam|press release|annual report|audited/.test(s)
       && !/derived: siam|seed|mca filings/.test(s);
}

function setRow(data, company, fy, metric, value, sourceLabel, sourceUrl) {
  if (value == null || !Number.isFinite(value)) return null;
  let row = data.company_fy_metrics.find(r =>
    r.Company === company && r.FY === fy && r.Metric === metric);
  if (!row) {
    row = { FY: fy, Company: company, Metric: metric,
            Value: null, YoY_Change: null, Signal: 'Neutral',
            Source: 'Pending', Source_URL: null, Last_Updated: null };
    data.company_fy_metrics.push(row);
  }
  if (isAnalystAuthoritative(row.Source) && row.Value != null) return { status: 'kept-authoritative' };
  if (row.Value === value && row.Source === sourceLabel) return { status: 'unchanged' };
  row.Value = value;
  row.Source = sourceLabel;
  row.Source_URL = sourceUrl;
  row.Last_Updated = TODAY;
  return { status: 'updated' };
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let updated = 0, kept = 0, unchanged = 0;

  /* ── Operational ratios per OEM ── */
  for (const [company, meta] of Object.entries(SEED)) {
    console.log(`[seed-operational] ${company}:`);
    for (const [fy, vals] of Object.entries(meta.byFY)) {
      const apply = (metric, v) => {
        const r = setRow(data, company, fy, metric, v, meta.src, meta.url);
        if (!r) return;
        if (r.status === 'updated') updated++;
        else if (r.status === 'kept-authoritative') kept++;
        else if (r.status === 'unchanged') unchanged++;
      };
      apply('Export Volume %',    vals.export_pct);
      apply('EV Volume %',        vals.ev_pct);
      apply('SUV Volume %',       vals.suv_pct);
      apply('New Model Launches', vals.new);
      apply('Facelift Launches',  vals.facelift);
    }
  }

  /* ── Hyundai pre-DRHP standalone financials ── */
  console.log(`[seed-operational] Hyundai pre-DRHP (FY16-FY18):`);
  for (const [fy, vals] of Object.entries(HYUNDAI_PRE_DRHP.byFY)) {
    const patMargin = (vals.sales_cr && vals.pat_cr != null)
      ? +((vals.pat_cr / vals.sales_cr) * 100).toFixed(2) : null;
    const capexIntens = (vals.sales_cr && vals.capex_cr != null)
      ? +((vals.capex_cr / vals.sales_cr) * 100).toFixed(2) : null;
    const apply = (metric, v) => {
      const r = setRow(data, 'Hyundai', fy, metric, v, HYUNDAI_PRE_DRHP.src, HYUNDAI_PRE_DRHP.url);
      if (!r) return;
      if (r.status === 'updated') updated++;
      else if (r.status === 'kept-authoritative') kept++;
      else if (r.status === 'unchanged') unchanged++;
    };
    apply('PAT Margin %',      patMargin);
    apply('Capex Intensity %', capexIntens);
  }

  console.log(`\n[seed-operational] updated=${updated} kept-authoritative=${kept} unchanged=${unchanged}`);

  if (DRY_RUN) { console.log('--dry-run: not writing file.'); return; }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote → ${DATA_PATH}`);
}

main();
