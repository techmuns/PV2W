#!/usr/bin/env node
/**
 * fetch-moneycontrol.mjs
 *
 * Best-effort scrape of Moneycontrol balance-sheet pages. MC's
 * year-on-year balance sheet pages have a stable HTML table
 * structure with row labels in the first column and FY columns
 * across the top. Each company has a separate URL; the path
 * trailer matches the company's ticker code.
 *
 *   Source URLs:
 *     https://www.moneycontrol.com/financials/marutisuzukiindia/balance-sheetVI/MS24
 *     https://www.moneycontrol.com/financials/hyundaimotorindia/balance-sheetVI/HMI01
 *     https://www.moneycontrol.com/financials/mahindramahindra/balance-sheetVI/MM
 *     https://www.moneycontrol.com/financials/tatamotors/balance-sheetVI/TM03
 *
 * Output:
 *   - raw_extracts.json → raw_extracts[<co>].Moneycontrol
 *
 * Usage:
 *   node scripts/fetch-moneycontrol.mjs
 *   node scripts/fetch-moneycontrol.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN   = process.argv.includes('--dry-run');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TARGETS = [
  { company: 'Maruti',         url: 'https://www.moneycontrol.com/financials/marutisuzukiindia/balance-sheetVI/MS24' },
  { company: 'Hyundai',        url: 'https://www.moneycontrol.com/financials/hyundaimotorindia/balance-sheetVI/HMI01' },
  { company: 'M&M',            url: 'https://www.moneycontrol.com/financials/mahindramahindra/balance-sheetVI/MM' },
  { company: 'Tata Motors PV', url: 'https://www.moneycontrol.com/financials/tatamotors/balance-sheetVI/TM03' },
];

const BS_PATTERNS = [
  { key: 'receivables_cr', rx: [/trade\s*receivables/i, /^sundry\s*debtors/i] },
  { key: 'inventory_cr',   rx: [/^inventor(y|ies)/i] },
  { key: 'payables_cr',    rx: [/trade\s*payables/i, /^sundry\s*creditors/i] },
  { key: 'cash_bank_cr',   rx: [/cash\s*(&|and)?\s*bank/i, /cash\s*equivalents/i] },
];

async function fetchHTML(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
function stripTags(s) { return String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function toNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function colToFY(col) {
  /* Moneycontrol headers like 'Mar 25' / 'Mar-25' / '202503'. */
  let m = String(col).match(/Mar[\s\-]*(\d{2,4})/i);
  if (!m) m = String(col).match(/(\d{4})-?(\d{2})/);
  if (!m) return null;
  const yy = parseInt(m[1], 10);
  return 'FY' + (yy < 100 ? String(yy).padStart(2, '0') : String(yy).slice(2));
}

function distill(html) {
  const out = { byFY: {}, problems: [] };
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
  BS_PATTERNS.forEach(({ key, rx }) => {
    for (const tbl of tables) {
      const headM = tbl.match(/<thead[\s\S]*?<\/thead>/i) || tbl.match(/<tr[\s\S]*?<\/tr>/i);
      if (!headM) continue;
      const ths = [...headM[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => stripTags(m[1]));
      const yearCols = ths.slice(1);
      const trs = [...tbl.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
      for (const tr of trs) {
        const tds = [...tr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => stripTags(m[1]));
        if (!tds.length) continue;
        if (rx.some(r => r.test(tds[0]))) {
          yearCols.forEach((col, i) => {
            const fy = colToFY(col); if (!fy) return;
            const v = toNum(tds[1 + i]); if (v == null) return;
            out.byFY[fy] = out.byFY[fy] || {};
            out.byFY[fy][key] = v;
          });
          return;
        }
      }
    }
  });
  if (!Object.keys(out.byFY).length) out.problems.push('no BS sub-lines parsed');
  return out;
}

async function main() {
  console.log('[fetch-moneycontrol] starting…');
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  for (const t of TARGETS) {
    console.log(`  ${t.company}: ${t.url}`);
    let html, extracted = { byFY: {}, problems: ['fetch failed'] };
    try { html = await fetchHTML(t.url); }
    catch (e) { console.warn(`    fetch failed: ${e.message}`); continue; }
    if (html) extracted = distill(html);
    raw[t.company] = raw[t.company] || {};
    raw[t.company].Moneycontrol = {
      fetched_at: new Date().toISOString(),
      source_url: t.url,
      by_fy: extracted.byFY,
      problems: extracted.problems,
    };
    console.log(`    parsed ${Object.keys(extracted.byFY).length} FYs`);
  }
  if (DRY_RUN) { console.log('--dry-run: not writing.'); return; }
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
  console.log(`wrote ${RAW_PATH}`);
}

main().catch(err => { console.error('[fetch-moneycontrol] fatal:', err); process.exit(0); });
