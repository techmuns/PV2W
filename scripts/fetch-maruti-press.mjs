#!/usr/bin/env node
/**
 * fetch-maruti-press.mjs
 *
 * Maruti FY24 + FY25 — sales volumes (monthly press release) and
 * revenue (FY financial results press release), straight from
 * Maruti's hosted PDFs at marutistoragenew.blob.core.windows.net.
 *
 * Pipeline:
 *   1. Download each PDF
 *   2. Extract text via pdf-parse
 *   3. Save raw text to data/config/press_text/maruti/ for audit
 *   4. Regex out the key numbers (Total Sales, Domestic, Export,
 *      Net Sales / Revenue, EBITDA, PAT)
 *   5. Save raw values to data/config/raw_extracts.json with full
 *      source / source_url / last_updated provenance
 *   6. Calculate dashboard cells unlocked by these inputs:
 *        - Volume Growth %        (FY25 vs FY24 total sales)
 *        - Export Volume %        (export / total)
 *        - Realisation Growth %   (rev/units, FY25 vs FY24)
 *        - Revenue Growth %       (FY25 vs FY24 revenue)
 *        - EBITDA Margin %        (only when EBITDA explicit)
 *   7. Write into data/config/placeholder_data.json with the
 *      Maruti press release as the Source / Source_URL
 *
 * Hard rules (per spec):
 *   - Skip any metric whose required input(s) are null
 *   - No guessing, no placeholder values
 *   - Idempotent — only writes when value or source-tag changes
 *
 * Usage:
 *   node scripts/fetch-maruti-press.mjs            # fetch + write
 *   node scripts/fetch-maruti-press.mjs --dry-run  # fetch + log only
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAsText } from './lib/fetch-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const TEXT_DIR  = path.join(__dirname, '..', 'data', 'config', 'press_text', 'maruti');
const DRY_RUN   = process.argv.includes('--dry-run');

const SOURCES = {
  FY24: {
    sales_pdf:        'https://marutistoragenew.blob.core.windows.net/msilintiwebpdf/Maruti_Suzuki_sales_in_March_2024.pdf',
    sales_page:       'https://www.marutisuzuki.com/corporate/media/press-releases/2024/april/maruti-suzuki-sales-in-march-2024',
    financials_pdf:   'https://marutistoragenew.blob.core.windows.net/msilintiwebpdf/Press-Release-Financial-Results-FY-2023-24.pdf',
    financials_page:  'https://www.marutisuzuki.com/corporate/media/press-releases/2024/april/maruti-suzuki-announces-financial-results-for-fy2023-24',
  },
  FY25: {
    sales_pdf:        'https://marutistoragenew.blob.core.windows.net/msilintiwebpdf/PressRelease-Maruti_Suzuki_sales_in_March_2025_and_FY_2024-25.pdf',
    sales_page:       'https://www.marutisuzuki.com/corporate/media/press-releases/2025/april/maruti-suzuki-sales-in-march-2025',
    financials_pdf:   'https://marutistoragenew.blob.core.windows.net/msilintiwebpdf/Press_Release_Financial_Results_FY_2024-25_f.pdf',
    financials_page:  'https://www.marutisuzuki.com/corporate/media/press-releases/2025/april/maruti-suzuki-announces-financial-results-for-fy2024-25',
  },
};

const today = () => new Date().toISOString().slice(0, 10);

/* pdf-parse has a long-standing bug where its index.js tries to read a
   test PDF at import time. We import the inner module directly to avoid
   tripping it. */
async function loadPdfParse() {
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  return mod.default || mod;
}

async function fetchPdfText(url, pdfParse) {
  console.log(`  fetching ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pv-dashboard-bot)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`  got ${buf.length} bytes, parsing PDF…`);
  const out = await pdfParse(buf);
  return out.text || '';
}

/* Indian-formatted-int parser: "1,42,857" → 142857 */
function parseIndianInt(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/* Pull the sales volume rows from a sales-press-release text dump.

   Maruti's sales PRs have a four-column table:
     Segment | March (current) | March (prior) | YTD (current) | YTD (prior)
   For the March release, "YTD (current)" equals the full-FY total.

   Strategy: locate each row by its label, then collect numeric tokens
   (1000+) from that line and the next few — pdf-parse sometimes wraps
   tables across lines. We assume the numbers appear in the same column
   order they printed in the PDF, so the 3rd large number on the row
   line is "YTD current" (i.e. full-FY total). */
/* Pull sales volumes. Verified from the saved HTML dump — Maruti's
   marutisuzuki.com press release page narrates:
     "Highest-ever annual domestic sales of 1,795,259 units"
     "Highest-ever annual exports of 332,585 units"
     "registered record total exports of 332,585 units in FY 2024-25"
   These are clean signals; we don't need the table.  */
function parseSales(text) {
  const result = { total: null, domestic: null, export: null };

  const dom = text.match(/(?:Highest[-\s]?ever\s+)?annual\s+domestic\s+sales\s+of\s+([0-9][0-9,]+)\s+units?/i)
           || text.match(/domestic\s+sales\s+of\s+([0-9][0-9,]+)\s+units?\s+in\s+FY/i);
  if (dom) result.domestic = parseIndianInt(dom[1]);

  const exp = text.match(/(?:Highest[-\s]?ever\s+)?annual\s+exports?\s+of\s+([0-9][0-9,]+)\s+units?/i)
           || text.match(/(?:record\s+)?total\s+exports?\s+of\s+([0-9][0-9,]+)\s+units?\s+in\s+FY/i);
  if (exp) result.export = parseIndianInt(exp[1]);

  if (result.domestic && result.export) result.total = result.domestic + result.export;
  return result;
}

/* Pull Net Sales / Net Profit from Maruti's HTML financial PR. The
   page narrates both current and prior FY in one sentence:
     "Net Sales of INR 1,451,152 million in FY2024-25, a growth of
      7.5% over the Net Sales of INR 1,349,378 million in FY2023-24"
   The release we're parsing IS the current-FY release, so the FIRST
   match in document order is the current FY (the one we want). All
   values are in INR Million; we convert to ₹ Cr (divide by 10). */
function parseFinancials(text) {
  const out = { net_sales: null, revenue: null, ebitda: null, pat: null };

  /* Returns the first numeric capture from any matching pattern,
     converted to ₹ Cr. Mn-suffix forms divide by 10; Cr-suffix
     forms keep the value. */
  function pullCr(rxsMillion, rxsCrore = []) {
    for (const rx of rxsMillion) {
      const m = text.match(rx);
      if (m) {
        const v = parseIndianInt(m[1]);
        if (v != null) return Math.round(v / 10);
      }
    }
    for (const rx of rxsCrore) {
      const m = text.match(rx);
      if (m) {
        const v = parseIndianInt(m[1]);
        if (v != null && v > 1000) return v;
      }
    }
    return null;
  }

  out.net_sales = pullCr(
    [/Net\s+Sales\s+of\s+INR\s+([0-9,]+)\s+million/i],
    [/Net\s+Sales\D{0,30}([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i]
  );
  out.revenue = pullCr(
    [/(?:Total\s+Revenue|Revenue\s+from\s+Operations|Operating\s+Revenue)\s+of\s+INR\s+([0-9,]+)\s+million/i],
    [/(?:Total\s+Revenue|Revenue\s+from\s+Operations|Operating\s+Revenue)\D{0,30}([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i]
  );
  out.ebitda = pullCr(
    [/EBITDA\s+of\s+INR\s+([0-9,]+)\s+million/i],
    [/EBITDA\D{0,30}([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i]
  );
  out.pat = pullCr(
    [/Net\s+Profit\s+of\s+INR\s+([0-9,]+)\s+million/i,
     /Profit\s+After\s+Tax\s+of\s+INR\s+([0-9,]+)\s+million/i],
    [/(?:Profit\s+After\s+Tax|Net\s+Profit)\D{0,30}([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i]
  );

  return out;
}

function writeRow(data, fy, metric, value, sourceLabel, sourceUrl) {
  if (value == null) return null;
  const row = data.company_fy_metrics.find(r =>
    r.Company === 'Maruti' && r.FY === fy && r.Metric === metric
  );
  if (!row) return null;
  const same = row.Value === value && row.Source === sourceLabel && row.Source_URL === sourceUrl;
  if (same) return null;
  const before = row.Value;
  row.Value        = value;
  row.Source       = sourceLabel;
  row.Source_URL   = sourceUrl;
  row.Last_Updated = today();
  return { before, after: value };
}

function pack(value, unit, label, url) {
  if (value == null) return null;
  return { value, unit, source: label, source_url: url, last_updated: today() };
}

async function main() {
  console.log('[fetch-maruti-press] starting…');
  fs.mkdirSync(TEXT_DIR, { recursive: true });

  const pdfParse = await loadPdfParse();
  const extracted = {};

  /* HTML-first then PDF-fallback. The Azure blob CDN has been
     intermittently 4xx-ing for GitHub Actions runners; the
     marutisuzuki.com HTML page is more reachable and often
     carries the same headline numbers in the body. */
  async function fetchWithFallback(label, urls) {
    for (const url of urls) {
      try {
        const r = await fetchAsText(url);
        if (r.text && r.text.length > 800) {
          console.log(`  ${label}: sourced from ${url} (${r.kind}, ${r.bytes}b)`);
          return { text: r.text, url };
        }
        console.log(`  ${label}: ${url} returned only ${r.text?.length || 0}c — too thin, trying next`);
      } catch (e) {
        console.warn(`  ${label}: ${url} → ${e.message}`);
      }
    }
    return null;
  }

  for (const fy of ['FY24', 'FY25']) {
    console.log(`\n=== ${fy} ===`);
    const src = SOURCES[fy];
    extracted[fy] = { src, sales: { total:null, domestic:null, export:null },
                            fin:   { net_sales:null, revenue:null, ebitda:null, pat:null } };

    const sales = await fetchWithFallback('sales', [src.sales_page, src.sales_pdf]);
    if (sales) {
      fs.writeFileSync(path.join(TEXT_DIR, `sales_${fy}.txt`), sales.text);
      extracted[fy].sales = parseSales(sales.text);
      console.log(`  sales parsed:`, extracted[fy].sales);
    }
    const fin = await fetchWithFallback('financials', [src.financials_page, src.financials_pdf]);
    if (fin) {
      fs.writeFileSync(path.join(TEXT_DIR, `financials_${fy}.txt`), fin.text);
      extracted[fy].fin = parseFinancials(fin.text);
      console.log(`  financials parsed:`, extracted[fy].fin);
    }
  }

  /* ---------- raw extracts (audit trail) ---------- */
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  raw._notes = raw._notes ||
    'Raw values fetched from public sources before any calculation. ' +
    'Each entry: { value, unit, source, source_url, last_updated }. ' +
    'placeholder_data.json carries only the calculated dashboard cells; ' +
    'this file is the audit trail.';
  raw.Maruti = raw.Maruti || {};

  for (const fy of ['FY24', 'FY25']) {
    const e = extracted[fy];
    raw.Maruti[fy] = raw.Maruti[fy] || {};
    const sUrl = e.src.sales_page;
    const fUrl = e.src.financials_page;
    const sLabel = 'Maruti monthly sales press release';
    const fLabel = 'Maruti FY financial results press release';

    if (e.sales.total    != null) raw.Maruti[fy].sales_volume_total    = pack(e.sales.total,    'units', sLabel, sUrl);
    if (e.sales.domestic != null) raw.Maruti[fy].sales_volume_domestic = pack(e.sales.domestic, 'units', sLabel, sUrl);
    if (e.sales.export   != null) raw.Maruti[fy].sales_volume_export   = pack(e.sales.export,   'units', sLabel, sUrl);
    if (e.fin.net_sales  != null) raw.Maruti[fy].net_sales_cr          = pack(e.fin.net_sales,  '₹ Cr',  fLabel, fUrl);
    if (e.fin.revenue    != null) raw.Maruti[fy].revenue_cr            = pack(e.fin.revenue,    '₹ Cr',  fLabel, fUrl);
    if (e.fin.ebitda     != null) raw.Maruti[fy].ebitda_cr             = pack(e.fin.ebitda,     '₹ Cr',  fLabel, fUrl);
    if (e.fin.pat        != null) raw.Maruti[fy].pat_cr                = pack(e.fin.pat,        '₹ Cr',  fLabel, fUrl);
  }

  /* ---------- calculations ---------- */
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const updates = [];
  const SALES_LABEL = 'Maruti monthly sales press release';
  const FIN_LABEL   = 'Maruti FY financial results press release';

  /* Volume Growth % — FY25 vs FY24 total */
  if (extracted.FY25.sales.total && extracted.FY24.sales.total) {
    const g = +((extracted.FY25.sales.total / extracted.FY24.sales.total - 1) * 100).toFixed(1);
    const r = writeRow(data, 'FY25', 'Volume Growth %', g, SALES_LABEL, SOURCES.FY25.sales_page);
    if (r) updates.push(`FY25 Volume Growth %: ${r.before} → ${r.after}%`);
  }

  /* Export Volume % per FY */
  for (const fy of ['FY24', 'FY25']) {
    const s = extracted[fy].sales;
    if (s.total && s.export) {
      const pct = +((s.export / s.total) * 100).toFixed(1);
      const r = writeRow(data, fy, 'Export Volume %', pct, SALES_LABEL, SOURCES[fy].sales_page);
      if (r) updates.push(`${fy} Export Volume %: ${r.before} → ${r.after}%`);
    }
  }

  /* Realisation = revenue / total volume; growth = FY25/FY24.
     Realisation values themselves aren't a dashboard row, but the
     growth is. */
  function realisation(fy) {
    const e = extracted[fy];
    const revCr = e.fin.revenue ?? e.fin.net_sales;
    if (revCr && e.sales.total) {
      return (revCr * 1e7) / e.sales.total;  // ₹ per unit
    }
    return null;
  }
  const r25 = realisation('FY25');
  const r24 = realisation('FY24');
  if (r25 && r24) {
    const g = +((r25 / r24 - 1) * 100).toFixed(1);
    const r = writeRow(data, 'FY25', 'Realisation Growth %', g,
      'Maruti FY financial results PR + monthly sales PR',
      SOURCES.FY25.financials_page);
    if (r) updates.push(`FY25 Realisation Growth %: ${r.before} → ${r.after}% (₹${r24.toFixed(0)}/u → ₹${r25.toFixed(0)}/u)`);
    console.log(`  realisation FY24 ₹${r24.toFixed(0)}/u, FY25 ₹${r25.toFixed(0)}/u`);
  }

  /* Revenue Growth % from PR (overrides Yahoo if different) */
  const rev24 = extracted.FY24.fin.revenue ?? extracted.FY24.fin.net_sales;
  const rev25 = extracted.FY25.fin.revenue ?? extracted.FY25.fin.net_sales;
  if (rev24 && rev25) {
    const g = +((rev25 / rev24 - 1) * 100).toFixed(1);
    const r = writeRow(data, 'FY25', 'Revenue Growth %', g, FIN_LABEL, SOURCES.FY25.financials_page);
    if (r) updates.push(`FY25 Revenue Growth %: ${r.before} → ${r.after}%`);
  }

  /* EBITDA Margin % — only when explicitly reported in the PR */
  for (const fy of ['FY24', 'FY25']) {
    const e = extracted[fy];
    const rev = e.fin.revenue ?? e.fin.net_sales;
    if (e.fin.ebitda && rev) {
      const m = +((e.fin.ebitda / rev) * 100).toFixed(1);
      const r = writeRow(data, fy, 'EBITDA Margin %', m, FIN_LABEL, SOURCES[fy].financials_page);
      if (r) updates.push(`${fy} EBITDA Margin %: ${r.before} → ${r.after}%`);
    }
  }

  /* ---------- summary table ---------- */
  console.log('\n=== Output table ===');
  const fmt = v => v == null ? '—' : v.toLocaleString('en-IN');
  console.log('Metric                         | FY25            | FY24            | Source');
  console.log('-------------------------------+-----------------+-----------------+-----------------------');
  console.log(`Total Sales (units)            | ${fmt(extracted.FY25.sales.total)} | ${fmt(extracted.FY24.sales.total)} | sales PR`);
  console.log(`Domestic Sales (units)         | ${fmt(extracted.FY25.sales.domestic)} | ${fmt(extracted.FY24.sales.domestic)} | sales PR`);
  console.log(`Export Sales (units)           | ${fmt(extracted.FY25.sales.export)} | ${fmt(extracted.FY24.sales.export)} | sales PR`);
  console.log(`Net Sales (₹ Cr)               | ${fmt(extracted.FY25.fin.net_sales)} | ${fmt(extracted.FY24.fin.net_sales)} | financial PR`);
  console.log(`Revenue from Ops (₹ Cr)        | ${fmt(extracted.FY25.fin.revenue)} | ${fmt(extracted.FY24.fin.revenue)} | financial PR`);
  console.log(`EBITDA (₹ Cr)                  | ${fmt(extracted.FY25.fin.ebitda)} | ${fmt(extracted.FY24.fin.ebitda)} | financial PR`);
  console.log(`PAT (₹ Cr)                     | ${fmt(extracted.FY25.fin.pat)} | ${fmt(extracted.FY24.fin.pat)} | financial PR`);

  console.log(`\n[fetch-maruti-press] ${updates.length} dashboard cell(s) to update:`);
  updates.forEach(u => console.log('  ' + u));

  if (DRY_RUN) {
    console.log('[fetch-maruti-press] --dry-run: not writing files.');
    return;
  }
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
  if (updates.length) fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[fetch-maruti-press] wrote raw → ${RAW_PATH}`);
  if (updates.length) console.log(`[fetch-maruti-press] wrote ${updates.length} update(s) → ${DATA_PATH}`);
}

main().catch(err => {
  console.error('[fetch-maruti-press] fatal:', err);
  process.exit(1);
});
