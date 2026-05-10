#!/usr/bin/env node
/**
 * fetch-tickertape.mjs
 *
 * Best-effort scrape of Tickertape.in for OEM balance-sheet
 * sub-lines that Screener / Tijori don't cleanly expose:
 *   Receivables / Inventory / Payables / Cash & Bank
 *
 *   Source URLs:
 *     https://www.tickertape.in/stocks/maruti-suzuki-india-MARU
 *     https://www.tickertape.in/stocks/hyundai-motor-india-HMI
 *     https://www.tickertape.in/stocks/mahindra-mahindra-MM
 *     https://www.tickertape.in/stocks/tata-motors-TM
 *
 * Tickertape's Financials tab exposes the standard P&L / BS / CF
 * tables. Best-effort regex pass over the HTML — soft-fails on
 * 4xx / 429 / parse miss.
 *
 * Output:
 *   - raw_extracts.json → raw_extracts[<co>].Tickertape
 *
 * Usage:
 *   node scripts/fetch-tickertape.mjs
 *   node scripts/fetch-tickertape.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN   = process.argv.includes('--dry-run');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TARGETS = [
  { company: 'Maruti',         url: 'https://www.tickertape.in/stocks/maruti-suzuki-india-MARU' },
  { company: 'Hyundai',        url: 'https://www.tickertape.in/stocks/hyundai-motor-india-HMI' },
  { company: 'M&M',            url: 'https://www.tickertape.in/stocks/mahindra-mahindra-MM' },
  { company: 'Tata Motors PV', url: 'https://www.tickertape.in/stocks/tata-motors-TM' },
];

const BS_PATTERNS = [
  { key: 'receivables_cr', rx: [/trade\s*receivables/i, /^receivables/i, /^debtors/i] },
  { key: 'inventory_cr',   rx: [/^inventor(y|ies)/i] },
  { key: 'payables_cr',    rx: [/trade\s*payables/i, /^payables/i, /^creditors/i] },
  { key: 'cash_bank_cr',   rx: [/cash\s*&?\s*bank/i, /cash\s*equivalents/i] },
];

async function fetchHTML(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function toNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function colToFY(col) {
  const m = String(col).match(/(?:FY|Mar)\s*(\d{2,4})/i);
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
      if (!yearCols.length) continue;
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
  console.log('[fetch-tickertape] starting…');
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  for (const t of TARGETS) {
    console.log(`  ${t.company}: ${t.url}`);
    let html, extracted = { byFY: {}, problems: ['fetch failed'] };
    try { html = await fetchHTML(t.url); }
    catch (e) { console.warn(`    fetch failed: ${e.message}`); continue; }
    if (html) extracted = distill(html);
    raw[t.company] = raw[t.company] || {};
    raw[t.company].Tickertape = {
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

main().catch(err => { console.error('[fetch-tickertape] fatal:', err); process.exit(0); });
