#!/usr/bin/env node
/**
 * scripts/fetch-2w-press.mjs
 *
 * Unified 2W segment press-release fetcher. One file covers all six
 * listed two-wheeler OEMs:
 *
 *   TVS Motor       — tvsmotor.com investor relations
 *   Bajaj Auto      — bajajauto.com investor relations
 *   Eicher Motors   — eicher.in investor relations (Royal Enfield)
 *   Hero MotoCorp   — heromotocorp.com investor relations
 *   Ola Electric    — olaelectric.com investor relations  (FY25+ only)
 *   Ather Energy    — atherenergy.com investor relations  (FY25+ only)
 *
 * Pattern mirrors scripts/fetch-maruti-press.mjs:
 *
 *   1. For each OEM × FY, fetch the monthly sales PR + annual results PR
 *      using fetchAsText (handles PDF and HTML uniformly).
 *   2. Dump raw text to data/config/press_text/2w/<oem>/ for audit.
 *   3. Run generic regex patterns to pull Total Sales / Domestic /
 *      Exports / Net Sales / Revenue / EBITDA / PAT.
 *   4. Compute derived metrics — Volume Growth %, Export Volume %,
 *      Revenue Growth %, Realisation Growth %, EBITDA Margin %.
 *   5. Upsert into placeholder_data.json → segment_metrics array using
 *      the 2W schema:
 *        { segment_id:"2W", company, fiscal_year, metric, value,
 *          source_url, source, last_updated }
 *
 * HARD RULES (per spec):
 *   • Skip any metric whose inputs are null. No guessing.
 *   • Each OEM block wrapped in try/catch — one failure never kills
 *     the rest. continue-on-error in the workflow already covers the
 *     whole script too.
 *   • Idempotent — only writes when value or source-tag changes.
 *   • Brand-source disclosure stays generic ("external sites or
 *     Munshot database"), no Screener / Moneycontrol references.
 *
 * Maintenance: when an IR URL changes (Indian OEMs reshuffle their
 * investor-relations sites every 1-2 years), update the SOURCES map
 * below. Everything else is per-OEM agnostic.
 *
 * Usage:
 *   node scripts/fetch-2w-press.mjs            # fetch + write
 *   node scripts/fetch-2w-press.mjs --dry-run  # fetch, log, don't write
 *
 * Wired into .github/workflows/refresh-data.yml as a single step
 * (id: press_2w) with continue-on-error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAsText, parseIndianInt, parseIndianFloat } from './lib/fetch-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const TEXT_ROOT = path.join(__dirname, '..', 'data', 'config', 'press_text', '2w');
const DRY_RUN   = process.argv.includes('--dry-run');
const today     = () => new Date().toISOString().slice(0, 10);

/* ============================================================
   SOURCES — best-known investor-relations URLs per OEM × FY.
   ============================================================
   Each block has up to four URL slots:
     sales_pdf        direct PDF of monthly/FY sales press release
     sales_page       HTML page that hosts/links the sales PR
     financials_pdf   direct PDF of FY financial results PR
     financials_page  HTML page that hosts/links the financials PR

   The fetcher tries `*_pdf` first then falls back to `*_page` (which
   often carries the same headline numbers in body copy). Missing
   slots are skipped silently.

   If a URL 404s on a run, the fetcher logs it and moves on — find
   the replacement on the OEM's IR site and edit the entry here.
   Nothing else needs to change.
*/
const SOURCES = {
  "TVS": {
    home: "https://www.tvsmotor.com/investors",
    FY24: {
      sales_page:      "https://www.tvsmotor.com/media-centre/press-releases",
      financials_page: "https://www.tvsmotor.com/investors/financial-results",
    },
    FY25: {
      sales_page:      "https://www.tvsmotor.com/media-centre/press-releases",
      financials_page: "https://www.tvsmotor.com/investors/financial-results",
    },
  },
  "Bajaj Auto": {
    home: "https://www.bajajauto.com/investors",
    FY24: {
      sales_page:      "https://www.bajajauto.com/investors/financial-information/monthly-sales",
      financials_page: "https://www.bajajauto.com/investors/financial-information/quarterly-results",
    },
    FY25: {
      sales_page:      "https://www.bajajauto.com/investors/financial-information/monthly-sales",
      financials_page: "https://www.bajajauto.com/investors/financial-information/quarterly-results",
    },
  },
  "Eicher Motors": {
    home: "https://www.eicher.in/financials",
    FY24: {
      sales_page:      "https://www.royalenfield.com/in/en/news/",
      financials_page: "https://www.eicher.in/financials/financial-results",
    },
    FY25: {
      sales_page:      "https://www.royalenfield.com/in/en/news/",
      financials_page: "https://www.eicher.in/financials/financial-results",
    },
  },
  "Hero MotoCorp": {
    home: "https://www.heromotocorp.com/en-in/investors.html",
    FY24: {
      sales_page:      "https://www.heromotocorp.com/en-in/media-room/press-releases.html",
      financials_page: "https://www.heromotocorp.com/en-in/investors/financial-results.html",
    },
    FY25: {
      sales_page:      "https://www.heromotocorp.com/en-in/media-room/press-releases.html",
      financials_page: "https://www.heromotocorp.com/en-in/investors/financial-results.html",
    },
  },
  "Ola Electric": {
    home: "https://olaelectric.com/investor-relations",
    /* Ola listed Aug 2024 → only FY25 has a full-year baseline. */
    FY25: {
      sales_page:      "https://olaelectric.com/investor-relations",
      financials_page: "https://olaelectric.com/investor-relations",
    },
  },
  "Ather Energy": {
    home: "https://www.atherenergy.com/investors",
    /* Ather listed 2024 → only FY25 onwards. */
    FY25: {
      sales_page:      "https://www.atherenergy.com/investors",
      financials_page: "https://www.atherenergy.com/investors",
    },
  },
};

/* ============================================================
   Generic parsers — same shape as fetch-maruti-press.mjs but
   broadened to handle the variety of phrasings across 6 OEMs.
   ============================================================ */

/* Sales volumes — total / domestic / export, in units.
   Tries multiple phrasings:
     "Total Sales of 4,67,123 units"
     "Total two-wheeler sales: 14,72,891 vehicles"
     "Domestic sales of 3,42,178 units"
     "Exports of 1,24,945 units"
     "FY25 total sales of 14,72,891 units"
   Returns nulls for misses; never invents. */
function parseSales(text) {
  const out = { total: null, domestic: null, export: null };

  const totalRx = [
    /Total\s+(?:two[\s-]?wheeler\s+)?(?:domestic\s+&\s+international\s+)?sales\s+(?:of|:)\s+([0-9][0-9,]{3,})\s+(?:units?|vehicles?)/i,
    /total\s+sales\s+volume\s+(?:of|:)\s+([0-9][0-9,]{3,})/i,
    /annual\s+sales\s+(?:of|:)\s+([0-9][0-9,]{3,})\s+(?:units?|vehicles?)/i,
    /FY\s*\d{2}\s+total\s+sales\s+(?:of|:)\s+([0-9][0-9,]{3,})/i,
  ];
  for (const rx of totalRx) {
    const m = text.match(rx);
    if (m) { out.total = parseIndianInt(m[1]); break; }
  }

  const domRx = [
    /(?:Highest[-\s]?ever\s+)?(?:annual\s+)?domestic\s+sales\s+(?:of|:)\s+([0-9][0-9,]{3,})\s+(?:units?|vehicles?)/i,
    /domestic\s+two[\s-]?wheeler\s+sales\s+(?:of|:)\s+([0-9][0-9,]{3,})/i,
    /India\s+sales\s+(?:of|:)\s+([0-9][0-9,]{3,})\s+(?:units?|vehicles?)/i,
  ];
  for (const rx of domRx) {
    const m = text.match(rx);
    if (m) { out.domestic = parseIndianInt(m[1]); break; }
  }

  const expRx = [
    /(?:Highest[-\s]?ever\s+)?(?:annual\s+)?exports?\s+(?:of|:)\s+([0-9][0-9,]{3,})\s+(?:units?|vehicles?)/i,
    /(?:record\s+)?total\s+exports?\s+(?:of|:)\s+([0-9][0-9,]{3,})/i,
    /international\s+(?:business\s+)?sales\s+(?:of|:)\s+([0-9][0-9,]{3,})/i,
  ];
  for (const rx of expRx) {
    const m = text.match(rx);
    if (m) { out.export = parseIndianInt(m[1]); break; }
  }

  /* Cross-check: if we got domestic+export but not total, sum them */
  if (out.total == null && out.domestic != null && out.export != null) {
    out.total = out.domestic + out.export;
  }
  return out;
}

/* Financials — Net Sales / Revenue / EBITDA / PAT in ₹ Cr.
   Indian PRs print figures in INR Million OR INR Crore — we
   normalise to ₹ Cr (divide by 10 for million).
   Returns nulls for misses; never invents. */
function parseFinancials(text) {
  const out = { net_sales: null, revenue: null, ebitda: null, ebitda_margin: null, pat: null };

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
        if (v != null && v > 100) return v;
      }
    }
    return null;
  }

  out.net_sales = pullCr(
    [/Net\s+Sales\s+of\s+(?:Rs\.?|INR|₹)\s+([0-9,]+)\s+million/i],
    [/Net\s+Sales\D{0,30}(?:Rs\.?|INR|₹)?\s*([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i]
  );
  out.revenue = pullCr(
    [/(?:Total\s+Revenue|Revenue\s+from\s+Operations|Operating\s+Revenue|Total\s+Income)\s+(?:of\s+)?(?:Rs\.?|INR|₹)\s+([0-9,]+)\s+million/i],
    [/(?:Total\s+Revenue|Revenue\s+from\s+Operations|Operating\s+Revenue|Total\s+Income)\D{0,30}(?:Rs\.?|INR|₹)?\s*([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i]
  );
  out.ebitda = pullCr(
    [/EBITDA\s+of\s+(?:Rs\.?|INR|₹)\s+([0-9,]+)\s+million/i],
    [/EBITDA\D{0,30}(?:Rs\.?|INR|₹)?\s*([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i]
  );
  out.pat = pullCr(
    [/(?:Net\s+Profit|Profit\s+After\s+Tax|PAT)\s+(?:of\s+)?(?:Rs\.?|INR|₹)\s+([0-9,]+)\s+million/i],
    [/(?:Net\s+Profit|Profit\s+After\s+Tax|PAT)\D{0,30}(?:Rs\.?|INR|₹)?\s*([0-9,]{4,})\s*(?:crore|Cr\.?|cr\.?)/i]
  );

  /* EBITDA margin is sometimes stated directly: "EBITDA margin of 11.4%" */
  const emRx = [
    /EBITDA\s+margin\s+(?:of|at|:)\s+([0-9]+(?:\.[0-9]+)?)\s*%/i,
    /Operating\s+margin\s+(?:of|at|:)\s+([0-9]+(?:\.[0-9]+)?)\s*%/i,
  ];
  for (const rx of emRx) {
    const m = text.match(rx);
    if (m) { out.ebitda_margin = parseIndianFloat(m[1]); break; }
  }
  /* Or derive from absolute EBITDA / Revenue when both present */
  if (out.ebitda_margin == null && out.ebitda != null && (out.revenue || out.net_sales)) {
    const denom = out.revenue || out.net_sales;
    if (denom > 0) {
      out.ebitda_margin = +((out.ebitda / denom) * 100).toFixed(1);
    }
  }

  return out;
}

/* ============================================================
   Fetch helper — try PDF first then HTML page fallback.
   Mirrors fetch-maruti-press.mjs's fetchWithFallback.
   ============================================================ */
async function fetchWithFallback(label, urls) {
  for (const url of urls) {
    if (!url) continue;
    try {
      const r = await fetchAsText(url);
      if (r.text && r.text.length > 800) {
        console.log(`    ${label}: sourced from ${url} (${r.kind}, ${r.bytes}b)`);
        return { text: r.text, url, kind: r.kind };
      }
      console.log(`    ${label}: ${url} returned only ${r.text?.length || 0}c — too thin, trying next`);
    } catch (e) {
      console.warn(`    ${label}: ${url} → ${e.message}`);
    }
  }
  return null;
}

/* ============================================================
   Upsert into segment_metrics array.
   ============================================================ */
function upsertRow(data, row) {
  if (!Array.isArray(data.segment_metrics)) data.segment_metrics = [];
  const existing = data.segment_metrics.find(r =>
    r.segment_id  === row.segment_id  &&
    r.company     === row.company     &&
    r.fiscal_year === row.fiscal_year &&
    r.metric      === row.metric
  );
  if (existing) {
    const same = existing.value === row.value && existing.source_url === row.source_url;
    if (same) return false;
    Object.assign(existing, row);
    return true;
  }
  data.segment_metrics.push(row);
  return true;
}

/* ============================================================
   Per-OEM run — wrapped in try/catch by caller.
   ============================================================ */
async function runOem(company, sources, data) {
  console.log(`\n=== ${company} ===`);
  const dir = path.join(TEXT_ROOT, company.toLowerCase().replace(/[^\w]+/g, '_'));
  fs.mkdirSync(dir, { recursive: true });

  const extracted = {};
  for (const fy of Object.keys(sources).filter(k => k.startsWith('FY'))) {
    const src = sources[fy];
    console.log(`  ${fy}`);
    extracted[fy] = {
      src,
      sales: { total: null, domestic: null, export: null },
      fin:   { net_sales: null, revenue: null, ebitda: null, ebitda_margin: null, pat: null },
    };

    const sales = await fetchWithFallback('sales',
      [src.sales_pdf, src.sales_page].filter(Boolean));
    if (sales) {
      fs.writeFileSync(path.join(dir, `sales_${fy}.txt`), sales.text);
      extracted[fy].sales = parseSales(sales.text);
      console.log(`      parsed:`, extracted[fy].sales);
    }

    const fin = await fetchWithFallback('financials',
      [src.financials_pdf, src.financials_page].filter(Boolean));
    if (fin) {
      fs.writeFileSync(path.join(dir, `financials_${fy}.txt`), fin.text);
      extracted[fy].fin = parseFinancials(fin.text);
      console.log(`      parsed:`, extracted[fy].fin);
    }
  }

  /* ---- write the per-FY absolute cells we extracted ---- */
  const SRC_LABEL = `${company} investor relations`;
  let writes = 0;
  const fys = Object.keys(extracted);

  function write(fy, metric, value, sourceUrl) {
    if (value == null) return;
    const row = {
      segment_id:  "2W",
      company,
      fiscal_year: fy,
      metric,
      value,
      source:       SRC_LABEL,
      source_url:   sourceUrl,
      last_updated: today(),
    };
    if (upsertRow(data, row)) writes++;
  }

  for (const fy of fys) {
    const e = extracted[fy];
    const sUrl = e.src.sales_page || e.src.sales_pdf;
    const fUrl = e.src.financials_page || e.src.financials_pdf;

    if (e.sales.total != null)         write(fy, "Total Sales Volume", e.sales.total, sUrl);
    if (e.sales.domestic != null)      write(fy, "Domestic Volume",    e.sales.domestic, sUrl);
    if (e.sales.export != null)        write(fy, "Export Volume",      e.sales.export, sUrl);
    if (e.fin.net_sales != null)       write(fy, "Net Sales (Rs Cr)",  e.fin.net_sales, fUrl);
    if (e.fin.revenue != null)         write(fy, "Revenue (Rs Cr)",    e.fin.revenue, fUrl);
    if (e.fin.ebitda != null)          write(fy, "EBITDA (Rs Cr)",     e.fin.ebitda, fUrl);
    if (e.fin.pat != null)             write(fy, "PAT (Rs Cr)",        e.fin.pat, fUrl);
    if (e.fin.ebitda_margin != null)   write(fy, "EBITDA Margin %",    e.fin.ebitda_margin, fUrl);

    /* Export Volume % = export / total */
    if (e.sales.total && e.sales.export) {
      const v = +((e.sales.export / e.sales.total) * 100).toFixed(1);
      write(fy, "Export Volume %", v, sUrl);
    }
  }

  /* ---- YoY derived metrics — only when consecutive FYs both extracted ---- */
  for (let i = 1; i < fys.length; i++) {
    const cur = fys[i], prev = fys[i - 1];
    const ec = extracted[cur], ep = extracted[prev];
    const sUrl = ec.src.sales_page || ec.src.sales_pdf;
    const fUrl = ec.src.financials_page || ec.src.financials_pdf;

    if (ec.sales.total && ep.sales.total) {
      const g = +((ec.sales.total / ep.sales.total - 1) * 100).toFixed(1);
      write(cur, "Volume Growth %", g, sUrl);
    }
    const curRev  = ec.fin.revenue || ec.fin.net_sales;
    const prevRev = ep.fin.revenue || ep.fin.net_sales;
    if (curRev && prevRev) {
      const g = +((curRev / prevRev - 1) * 100).toFixed(1);
      write(cur, "Revenue Growth %", g, fUrl);
    }
    if (curRev && prevRev && ec.sales.total && ep.sales.total) {
      const curReal  = curRev  / ec.sales.total;
      const prevReal = prevRev / ep.sales.total;
      const g = +((curReal / prevReal - 1) * 100).toFixed(1);
      write(cur, "Realisation Growth %", g, fUrl);
    }
  }

  console.log(`  ${company}: ${writes} cell(s) written/updated`);
  return { extracted, writes };
}

/* ============================================================
   Main — iterate, isolating failures per OEM.
   ============================================================ */
async function main() {
  console.log('[fetch-2w-press] starting…');
  fs.mkdirSync(TEXT_ROOT, { recursive: true });

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  const summary = [];
  for (const [company, sources] of Object.entries(SOURCES)) {
    try {
      const r = await runOem(company, sources, data);
      summary.push({ company, writes: r.writes, ok: true });
    } catch (e) {
      console.error(`[fetch-2w-press] ${company} failed:`, e.message);
      summary.push({ company, writes: 0, ok: false, error: e.message });
    }
    /* polite pacing between OEMs */
    await new Promise(r => setTimeout(r, 400));
  }

  /* ---- raw extracts audit trail ---- */
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}
  raw._2w_press_last_run = {
    at: new Date().toISOString(),
    summary,
  };

  console.log('\n[fetch-2w-press] summary:');
  for (const s of summary) {
    console.log(`  ${s.ok ? '✓' : '✗'} ${s.company}: ${s.writes} writes ${s.error ? '(' + s.error + ')' : ''}`);
  }

  if (DRY_RUN) {
    console.log('[fetch-2w-press] --dry-run: not writing.');
    return;
  }
  const totalWrites = summary.reduce((a, s) => a + s.writes, 0);
  if (totalWrites === 0) {
    console.log('[fetch-2w-press] No updates — leaving files untouched.');
    return;
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(RAW_PATH,  JSON.stringify(raw,  null, 2) + '\n');
  console.log(`[fetch-2w-press] Wrote ${totalWrites} update(s) across ${summary.filter(s => s.writes > 0).length} OEM(s)`);
}

main().catch(err => {
  console.error('[fetch-2w-press] fatal:', err);
  process.exit(1);
});
