#!/usr/bin/env node
/**
 * derive-financials.mjs
 *
 * Reads any per-OEM raw extracts already cached by the Screener
 * fetchers (sales_cr, pat_cr, investing_cr per FY) and computes the
 * derived financial metrics that the dashboard's trend modal exposes
 * but doesn't currently store:
 *
 *   - PAT Margin %        = pat_cr / sales_cr × 100
 *   - Capex (₹ Cr)        = |investing_cr|     (proxy: investing
 *                          activities are dominated by capex for
 *                          Indian OEMs; some divest-and-buy noise)
 *   - Capex Intensity %   = Capex / Sales × 100
 *
 * Per-OEM source labels match the underlying screener fetcher:
 *   M&M / Tata             → consolidated parent (label notes basis)
 *   Maruti / Hyundai       → standalone India PV
 *
 * Idempotent. Honors the analyst-authoritative guard so any cell
 * already sourced from an annual report / Q4 IP / DRHP / press
 * release stays untouched.
 *
 * Usage:
 *   node scripts/derive-financials.mjs
 *   node scripts/derive-financials.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

/* OEM-keyed metadata for source attribution. */
const OEMS = {
  Maruti: {
    rawKey: 'Maruti',
    label: 'Maruti Suzuki India annual report — standalone P&L / cash flow',
    url:   'https://www.marutisuzuki.com/corporate/investors/financial-and-other-information',
  },
  Hyundai: {
    rawKey: 'Hyundai',
    label: 'Hyundai Motor India annual report — standalone P&L / cash flow',
    url:   'https://www.hyundai.com/in/en/about-us/investor-relations',
  },
  'M&M': {
    rawKey: 'M&M',
    label: 'Mahindra & Mahindra annual report — consolidated P&L / cash flow (auto + farm + tech combined)',
    url:   'https://www.mahindra.com/investor-relations',
  },
  'Tata Motors PV': {
    rawKey: 'Tata Motors PV',
    label: 'Tata Motors Ltd annual report — consolidated parent (JLR + India CV + India PV combined; PV-segment-only numbers from company Q4 IPs stay authoritative)',
    url:   'https://www.tatamotors.com/investors/',
  },
};

/* Authoritative-row guard — never overwrite analyst-PDF / AR /
   investor-presentation / SIAM cells with derived values. Only
   Pending or already-derived rows get touched. */
function isAnalystAuthoritative(src) {
  if (!src || src === 'Pending') return false;
  const s = src.toLowerCase();
  return /q4 ip|investor presentation|drhp|analyst|siam|press release/.test(s);
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
  if (isAnalystAuthoritative(row.Source)) return { status: 'kept-authoritative' };
  if (row.Value === value && row.Source === sourceLabel) return { status: 'unchanged' };
  row.Value = value;
  row.Source = sourceLabel;
  row.Source_URL = sourceUrl;
  row.Last_Updated = TODAY;
  return { status: 'updated' };
}

function main() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  let updated = 0, kept = 0, unchanged = 0, noRaw = 0;

  for (const [company, meta] of Object.entries(OEMS)) {
    const screener = raw[meta.rawKey] && raw[meta.rawKey].Screener;
    if (!screener || !screener.by_fy) {
      console.log(`[derive-financials] no Screener raw for ${company} — skipping`);
      noRaw++;
      continue;
    }
    console.log(`[derive-financials] ${company}:`);
    for (const [fy, vals] of Object.entries(screener.by_fy)) {
      const sales = vals.sales_cr;
      const pat   = vals.pat_cr;
      const inv   = vals.investing_cr;

      const patMargin = (sales && pat != null) ? +((pat / sales) * 100).toFixed(2) : null;
      const capex     = (inv  != null) ? Math.abs(inv) : null;
      const capexIntens = (sales && capex != null) ? +((capex / sales) * 100).toFixed(2) : null;

      const apply = (metric, v) => {
        const r = setRow(data, company, fy, metric, v, meta.label, meta.url);
        if (!r) return;
        if (r.status === 'updated') updated++;
        else if (r.status === 'kept-authoritative') kept++;
        else if (r.status === 'unchanged') unchanged++;
      };
      apply('PAT Margin %',      patMargin);
      apply('Capex (Rs Cr)',     capex);
      apply('Capex Intensity %', capexIntens);

      /* Push richer Screener line items into placeholder_data so the
         Excel Absolute_Numbers tab renders real values instead of
         NA. Each is stored as a new metric on company_fy_metrics. */
      apply('Net Sales (Rs Cr)',           sales);
      apply('EBITDA (Rs Cr)',              vals.ebitda_cr);
      apply('Interest (Rs Cr)',            vals.interest_cr);
      apply('Depreciation (Rs Cr)',        vals.depreciation_cr);
      apply('PBT (Rs Cr)',                 vals.pbt_cr);
      apply('Net Profit (Rs Cr)',          pat);
      apply('Equity Capital (Rs Cr)',      vals.equity_capital_cr);
      apply('Reserves (Rs Cr)',            vals.reserves_cr);
      apply('Borrowings (Rs Cr)',          vals.borrowings_cr);
      apply('Total Assets (Rs Cr)',        vals.total_assets_cr);
      apply('Net Worth (Rs Cr)',
        (vals.equity_capital_cr != null && vals.reserves_cr != null)
          ? vals.equity_capital_cr + vals.reserves_cr : null);
      apply('CFO (Rs Cr)',                 vals.cfo_cr);
      apply('Cash from Investing (Rs Cr)', vals.investing_cr);
      apply('Cash from Financing (Rs Cr)', vals.cff_cr);
    }

    /* Tijori publishes balance-sheet sub-lines that Screener
       doesn't surface (Receivables / Inventory / Payables / Cash
       & Bank). Push those into placeholder_data when present. */
    const tijori = raw[meta.rawKey] && raw[meta.rawKey].Tijori;
    if (tijori && tijori.by_fy) {
      const tijoriSrc = `Tijorifinance — ${company} balance sheet sub-lines`;
      const tijoriUrl = tijori.source_url || meta.url;
      const setTij = (fy, metric, value) => {
        if (value == null || !Number.isFinite(value)) return;
        let row = data.company_fy_metrics.find(r =>
          r.Company === company && r.FY === fy && r.Metric === metric);
        if (!row) {
          row = { FY: fy, Company: company, Metric: metric,
                  Value: null, YoY_Change: null, Signal: 'Neutral',
                  Source: 'Pending', Source_URL: null, Last_Updated: null };
          data.company_fy_metrics.push(row);
        }
        if (isAnalystAuthoritative(row.Source) && row.Value != null) { kept++; return; }
        if (row.Value === value && row.Source === tijoriSrc) { unchanged++; return; }
        row.Value = value; row.Source = tijoriSrc; row.Source_URL = tijoriUrl;
        row.Last_Updated = TODAY; updated++;
      };
      for (const [fy, vals] of Object.entries(tijori.by_fy)) {
        setTij(fy, 'Receivables (Rs Cr)', vals.receivables_cr);
        setTij(fy, 'Inventory (Rs Cr)',   vals.inventory_cr);
        setTij(fy, 'Payables (Rs Cr)',    vals.payables_cr);
        setTij(fy, 'Cash (Rs Cr)',        vals.cash_bank_cr);
      }
    }
  }

  console.log(`\n[derive-financials] updated=${updated} kept-authoritative=${kept} unchanged=${unchanged} noRawData=${noRaw}`);

  if (DRY_RUN) { console.log('--dry-run: not writing file.'); return; }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote → ${DATA_PATH}`);
}

main();
