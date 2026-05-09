#!/usr/bin/env node
/**
 * fetch-tijori.mjs
 *
 * Best-effort scrape of Tijorifinance company pages to fill the
 * `Total Sales Volume` rows for Hyundai / M&M / Tata Motors PV.
 * Tijorifinance publishes a 'Business Segments' / 'Operational
 * Metrics' tab where listed automotive OEMs disclose their annual
 * unit volumes alongside the standard P&L.
 *
 *   Source URLs:
 *     https://www.tijorifinance.com/company/hyundai-motor-india-ltd/
 *     https://www.tijorifinance.com/company/mahindra-and-mahindra-ltd/
 *     https://www.tijorifinance.com/company/tata-motors-ltd/
 *
 * What we look for, per OEM:
 *   - 'Total Sales' / 'Total Volumes' / 'PV Volumes' rows in the
 *     operational-metrics block, parsed FY16..latest where available.
 *
 * Output:
 *   - raw_extracts.json → raw_extracts[<company>].Tijori
 *   - placeholder_data.json → company_fy_metrics rows for
 *     'Total Sales Volume' updated where the existing Source is
 *     'Pending', 'Derived' / blank, or already a Tijori label.
 *     Analyst-PDF / Q4 IP / company-PR sourced rows stay
 *     authoritative.
 *
 * Failure modes (all soft — exit 0):
 *   - Tijori 4xx/429   : seed values stay (see seed-volumes.mjs)
 *   - Schema shift     : log which OEM didn't parse, exit 0
 *
 * Usage:
 *   node scripts/fetch-tijori.mjs
 *   node scripts/fetch-tijori.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TARGETS = [
  {
    company: 'Hyundai',
    url:     'https://www.tijorifinance.com/company/hyundai-motor-india-ltd/',
    sourceLabel: 'Hyundai Motor India — annual operating metrics (PV unit volumes)',
  },
  {
    company: 'M&M',
    url:     'https://www.tijorifinance.com/company/mahindra-and-mahindra-ltd/',
    sourceLabel: 'Mahindra & Mahindra — annual auto segment volumes',
  },
  {
    company: 'Tata Motors PV',
    url:     'https://www.tijorifinance.com/company/tata-motors-ltd/',
    sourceLabel: 'Tata Motors — annual PV segment volumes',
  },
];

async function fetchHTML(url) {
  console.log(`  GET ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function toInt(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[,\s]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function colToFY(col) {
  const m = String(col).match(/(?:FY|Mar)\s*(\d{2,4})/i);
  if (!m) return null;
  const yy = parseInt(m[1], 10);
  if (yy < 100) return 'FY' + String(yy).padStart(2, '0');
  return 'FY' + String(yy).slice(2);
}

/* Pull a year-row table from a section that contains the
   'Total Sales' / 'Total Volumes' / 'PV Volumes' row label. */
function extractVolumeRow(html) {
  /* Tijori typically wraps tables in <table class="..."> blocks.
     Find the first table whose body has a row whose first cell
     mentions 'Total Sales' / 'Total Volumes' / 'PV Volumes' /
     'Domestic + Exports'. */
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
  const VOL_NEEDLES = [/total\s+sales\b/i, /total\s+volumes?\b/i, /pv\s+volumes?\b/i, /total\s+units?\b/i];

  for (const tbl of tables) {
    const headM = tbl.match(/<thead[\s\S]*?<\/thead>/i) || tbl.match(/<tr[\s\S]*?<\/tr>/i);
    if (!headM) continue;
    const ths = [...headM[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => stripTags(m[1]));
    const yearCols = ths.slice(1);
    if (!yearCols.length) continue;

    const trs = [...tbl.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
    for (const tr of trs) {
      const tds = [...tr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => stripTags(m[1]));
      if (!tds.length) continue;
      const label = tds[0];
      if (VOL_NEEDLES.some(rx => rx.test(label))) {
        return { label, yearCols, values: tds.slice(1) };
      }
    }
  }
  return null;
}

function distill(html) {
  const out = { byFY: {}, problems: [] };
  const row = extractVolumeRow(html);
  if (!row) { out.problems.push('no volume row found'); return out; }
  row.yearCols.forEach((col, i) => {
    const fy = colToFY(col);
    if (!fy) return;
    const v = toInt(row.values[i]);
    if (v != null && v > 1000) out.byFY[fy] = { total_sales_volume: v, label: row.label };
  });
  if (!Object.keys(out.byFY).length) out.problems.push('no parseable yearly values');
  return out;
}

function isAnalystAuthoritative(src) {
  if (!src || src === 'Pending') return false;
  const s = src.toLowerCase();
  return /q4 ip|investor presentation|monthly sales press|maruti monthly|annual report.*press release|press release/.test(s);
}

function setRow(data, company, fy, value, sourceLabel, sourceUrl) {
  if (value == null || !Number.isFinite(value)) return null;
  let row = data.company_fy_metrics.find(r =>
    r.Company === company && r.FY === fy && r.Metric === 'Total Sales Volume');
  if (!row) {
    row = { FY: fy, Company: company, Metric: 'Total Sales Volume',
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

async function main() {
  console.log('[fetch-tijori] starting…');
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  let totalUpdated = 0, totalKept = 0;
  for (const t of TARGETS) {
    console.log(`\n=== ${t.company} ===`);
    let html = null, extracted = { byFY: {}, problems: ['fetch failed'] };
    try { html = await fetchHTML(t.url); }
    catch (e) { console.warn(`  fetch failed: ${e.message}`); }
    if (html) extracted = distill(html);
    if (extracted.problems.length) console.warn(`  problems: ${extracted.problems.join(', ')}`);
    console.log(`  parsed ${Object.keys(extracted.byFY).length} FY rows`);

    raw[t.company] = raw[t.company] || {};
    raw[t.company].Tijori = {
      fetched_at: new Date().toISOString(),
      source_url: t.url,
      by_fy: extracted.byFY,
      problems: extracted.problems,
    };

    for (const [fy, vals] of Object.entries(extracted.byFY)) {
      const r = setRow(data, t.company, fy, vals.total_sales_volume, t.sourceLabel, t.url);
      if (!r) continue;
      if (r.status === 'updated') totalUpdated++;
      else if (r.status === 'kept-authoritative') totalKept++;
    }
  }
  console.log(`\nupdated=${totalUpdated} kept-authoritative=${totalKept}`);

  if (DRY_RUN) { console.log('\n--dry-run: not writing files.'); return; }
  fs.writeFileSync(RAW_PATH,  JSON.stringify(raw,  null, 2) + '\n');
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${RAW_PATH}`);
  console.log(`wrote ${DATA_PATH}`);
}

main().catch(err => {
  console.error('[fetch-tijori] fatal:', err);
  process.exit(0);
});
