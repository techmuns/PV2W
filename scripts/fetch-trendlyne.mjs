#!/usr/bin/env node
/**
 * fetch-trendlyne.mjs
 *
 * Best-effort scrape of Trendlyne.com balance-sheet pages for OEM
 * BS sub-lines. Trendlyne is a JS-rendered SPA so static HTML
 * parsing only captures what's pre-rendered server-side; a fair
 * amount may not load. Soft-fail the same way other fetchers do.
 *
 *   Source URLs:
 *     https://trendlyne.com/equity/Fundamentals/MARUTI/9694/Maruti-Suzuki-India/
 *     https://trendlyne.com/equity/Fundamentals/HYUNDAI/22155/Hyundai-Motor-India/
 *     https://trendlyne.com/equity/Fundamentals/M%26M/12181/Mahindra-and-Mahindra/
 *     https://trendlyne.com/equity/Fundamentals/TATAMOTORS/13458/Tata-Motors/
 *
 * Output:
 *   - raw_extracts.json → raw_extracts[<co>].Trendlyne
 *
 * Usage:
 *   node scripts/fetch-trendlyne.mjs
 *   node scripts/fetch-trendlyne.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN   = process.argv.includes('--dry-run');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TARGETS = [
  { company: 'Maruti',         url: 'https://trendlyne.com/equity/Fundamentals/MARUTI/9694/Maruti-Suzuki-India/' },
  { company: 'Hyundai',        url: 'https://trendlyne.com/equity/Fundamentals/HYUNDAI/22155/Hyundai-Motor-India/' },
  { company: 'M&M',            url: 'https://trendlyne.com/equity/Fundamentals/M%26M/12181/Mahindra-and-Mahindra/' },
  { company: 'Tata Motors PV', url: 'https://trendlyne.com/equity/Fundamentals/TATAMOTORS/13458/Tata-Motors/' },
];

const BS_PATTERNS = [
  { key: 'receivables_cr', rx: [/trade\s*receivables/i, /sundry\s*debtors/i, /^receivables/i] },
  { key: 'inventory_cr',   rx: [/^inventor(y|ies)/i] },
  { key: 'payables_cr',    rx: [/trade\s*payables/i, /sundry\s*creditors/i, /^payables/i] },
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
  if (!Object.keys(out.byFY).length) out.problems.push('no BS sub-lines parsed (Trendlyne may be JS-rendered)');
  return out;
}

async function main() {
  console.log('[fetch-trendlyne] starting…');
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  for (const t of TARGETS) {
    console.log(`  ${t.company}: ${t.url}`);
    let html, extracted = { byFY: {}, problems: ['fetch failed'] };
    try { html = await fetchHTML(t.url); }
    catch (e) { console.warn(`    fetch failed: ${e.message}`); continue; }
    if (html) extracted = distill(html);
    raw[t.company] = raw[t.company] || {};
    raw[t.company].Trendlyne = {
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

main().catch(err => { console.error('[fetch-trendlyne] fatal:', err); process.exit(0); });
