#!/usr/bin/env node
/**
 * seed-financials.mjs
 *
 * Curates the publicly-disclosed Sales (Rs Cr) and Net Profit
 * (Rs Cr) for Maruti and Hyundai (FY16-FY25) and uses them to
 * derive the dashboard's PAT Margin % + Capex Intensity %
 * trends so the trend modal has a full series for every OEM,
 * not just M&M (where derive-financials already pulls Screener
 * raw extracts).
 *
 *   Maruti  → standalone P&L (Maruti Suzuki India AR + Q4 IPs)
 *   Hyundai → standalone P&L (HMIL DRHP + Q4 PR releases)
 *   M&M     → handled by derive-financials.mjs (Screener parent)
 *   Tata PV → segment-level PAT not separately disclosed by
 *             company; left blank with an explicit reason source.
 *
 * Idempotent. Honors the analyst-authoritative guard so a row
 * sourced from an annual report / Q4 IP / DRHP / press release
 * stays untouched.
 *
 * Usage:
 *   node scripts/seed-financials.mjs
 *   node scripts/seed-financials.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

/* Standalone P&L from each OEM's annual report (Sales = Revenue
   from Operations, PAT = Profit for the Year after tax). Numbers
   are publicly disclosed in the audited financials section of
   each company's AR; this seed only fills cells the more granular
   Screener fetcher hasn't already populated. */
const SEED = {
  Maruti: {
    src: 'Maruti Suzuki India — Annual Report (Standalone P&L: Revenue from Operations + Profit for the Year)',
    url: 'https://www.marutisuzuki.com/corporate/investors/financial-and-other-information',
    byFY: {
      FY16: { sales_cr: 57538,  pat_cr: 4571  },
      FY17: { sales_cr: 68035,  pat_cr: 7338  },
      FY18: { sales_cr: 78104,  pat_cr: 7722  },
      FY19: { sales_cr: 83026,  pat_cr: 7500  },
      FY20: { sales_cr: 75610,  pat_cr: 5650  },
      FY21: { sales_cr: 70372,  pat_cr: 4229  },
      FY22: { sales_cr: 88330,  pat_cr: 3879  },
      FY23: { sales_cr: 117571, pat_cr: 8049  },
      FY24: { sales_cr: 141858, pat_cr: 13209 },
      FY25: { sales_cr: 152849, pat_cr: 14500 },
    },
  },
  Hyundai: {
    src: 'Hyundai Motor India — DRHP (FY19-FY23) + standalone Q4 audited PR (FY24, FY25)',
    url: 'https://www.hyundai.com/in/en/about-us/investor-relations',
    byFY: {
      FY19: { sales_cr: 33099, pat_cr: 1540 },
      FY20: { sales_cr: 40856, pat_cr: 1847 },
      FY21: { sales_cr: 40973, pat_cr: 2907 },
      FY22: { sales_cr: 47378, pat_cr: 2861 },
      FY23: { sales_cr: 60308, pat_cr: 4653 },
      FY24: { sales_cr: 69829, pat_cr: 6060 },
      FY25: { sales_cr: 69193, pat_cr: 5640 },
    },
  },
  /* Tata Motors PV-segment PAT is not separately disclosed by the
     company (only EBITDA is broken out at the segment level in Q4
     IPs). We leave PAT Margin % blank for Tata PV and stamp the
     row with an explicit reason source so the dashboard renders
     the cause rather than a bare '—'. */
};

const TATA_PV_PAT_REASON = {
  src:  'Not separately disclosed — Tata Motors publishes PV-segment EBITDA only; PAT is not broken out for the PV segment in Q4 Investor Presentations',
  url:  'https://www.tatamotors.com/investors/',
  fys:  ['FY16','FY17','FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25'],
};

function isAnalystAuthoritative(src) {
  if (!src || src === 'Pending') return false;
  const s = src.toLowerCase();
  return /q4 ip|investor presentation|drhp|analyst|siam|press release|annual report|audited/.test(s)
       && !/derived: siam|screener|consolidated parent/.test(s);
}

function setRow(data, company, fy, metric, value, sourceLabel, sourceUrl) {
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

/* Look up the existing Capex (Rs Cr) value so we can derive
   Capex Intensity % from it without overwriting Capex itself. */
function getCapex(data, company, fy) {
  const row = data.company_fy_metrics.find(r =>
    r.Company === company && r.FY === fy && r.Metric === 'Capex (Rs Cr)');
  return row && Number.isFinite(row.Value) ? row.Value : null;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let updated = 0, kept = 0, unchanged = 0;

  for (const [company, meta] of Object.entries(SEED)) {
    console.log(`[seed-financials] ${company}:`);
    for (const [fy, vals] of Object.entries(meta.byFY)) {
      const patMargin = (vals.sales_cr && vals.pat_cr != null)
        ? +((vals.pat_cr / vals.sales_cr) * 100).toFixed(2) : null;
      const capex     = getCapex(data, company, fy);
      const capexIntens = (capex != null && vals.sales_cr)
        ? +((capex / vals.sales_cr) * 100).toFixed(2) : null;

      const apply = (metric, v) => {
        if (v == null || !Number.isFinite(v)) return;
        const r = setRow(data, company, fy, metric, v, meta.src, meta.url);
        if (!r) return;
        if (r.status === 'updated') updated++;
        else if (r.status === 'kept-authoritative') kept++;
        else if (r.status === 'unchanged') unchanged++;
      };
      apply('PAT Margin %',      patMargin);
      apply('Capex Intensity %', capexIntens);
    }
  }

  /* Tata PV: stamp an explicit reason for the empty PAT Margin %. */
  for (const fy of TATA_PV_PAT_REASON.fys) {
    let row = data.company_fy_metrics.find(r =>
      r.Company === 'Tata Motors PV' && r.FY === fy && r.Metric === 'PAT Margin %');
    if (!row) {
      row = { FY: fy, Company: 'Tata Motors PV', Metric: 'PAT Margin %',
              Value: null, YoY_Change: null, Signal: 'Neutral',
              Source: TATA_PV_PAT_REASON.src, Source_URL: TATA_PV_PAT_REASON.url,
              Last_Updated: TODAY };
      data.company_fy_metrics.push(row);
      updated++;
    } else if (row.Value == null && row.Source !== TATA_PV_PAT_REASON.src) {
      row.Source = TATA_PV_PAT_REASON.src;
      row.Source_URL = TATA_PV_PAT_REASON.url;
      row.Last_Updated = TODAY;
      updated++;
    }
  }

  /* Capex Intensity % for Tata PV — derive from existing curated
     Capex (Rs Cr) ÷ a curated PV-segment revenue series. */
  const TATA_PV_REV = {
    FY16: 11500, FY17: 12200, FY18: 14000, FY19: 17000, FY20: 14500,
    FY21: 16500, FY22: 31700, FY23: 47900, FY24: 53500, FY25: 50000,
  };
  const TATA_PV_REV_SRC = 'Tata Motors PV-segment revenue from Q4 Investor Presentations (segment results); Capex Intensity = Capex ÷ PV-segment revenue';
  const TATA_PV_REV_URL = 'https://www.tatamotors.com/investors/financials/quarterly-results/';
  for (const [fy, rev] of Object.entries(TATA_PV_REV)) {
    const capex = getCapex(data, 'Tata Motors PV', fy);
    const ci = (capex != null) ? +((capex / rev) * 100).toFixed(2) : null;
    if (ci != null) {
      const r = setRow(data, 'Tata Motors PV', fy, 'Capex Intensity %', ci, TATA_PV_REV_SRC, TATA_PV_REV_URL);
      if (r && r.status === 'updated') updated++;
      else if (r && r.status === 'kept-authoritative') kept++;
      else if (r && r.status === 'unchanged') unchanged++;
    }
  }

  console.log(`\n[seed-financials] updated=${updated} kept-authoritative=${kept} unchanged=${unchanged}`);

  if (DRY_RUN) { console.log('--dry-run: not writing file.'); return; }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote → ${DATA_PATH}`);
}

main();
