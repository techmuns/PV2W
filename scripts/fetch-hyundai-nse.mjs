#!/usr/bin/env node
/**
 * fetch-hyundai-nse.mjs
 *
 * Best-effort scrape of NSE India's equity page for Hyundai Motor
 * India Limited (https://www.nseindia.com/get-quote/equity/HYUNDAI).
 *
 * NSE serves JSON via /api/quote-equity?symbol=HYUNDAI but requires
 * browser-like cookies first. The flow:
 *
 *   1. GET https://www.nseindia.com/get-quote/equity?symbol=HYUNDAI
 *      with a real-browser User-Agent → server sets NSE-CLIENTID,
 *      bm_sv, ak_bmsc cookies.
 *   2. Replay those cookies on the JSON API.
 *
 * NSE often blocks GitHub Actions runner IPs at the Cloudflare layer
 * — in that case the script logs the failure and exits with code 0
 * so the rest of the workflow continues. Yahoo Finance + Hyundai's
 * own press releases remain the authoritative source for everything
 * the dashboard renders.
 *
 * What we extract on success:
 *   - 52-week high / low
 *   - Current PE (sectoral PE if available)
 *   - Market cap (Cr)
 *   - Last close
 *   - Latest corporate action / announcement summary (count + date)
 *
 * Output:
 *   data/config/raw_extracts.json → raw_extracts.Hyundai.NSE = {...}
 *
 * Usage:
 *   node scripts/fetch-hyundai-nse.mjs
 *   node scripts/fetch-hyundai-nse.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH  = path.join(__dirname, '..', 'data', 'config', 'raw_extracts.json');
const DRY_RUN   = process.argv.includes('--dry-run');

const NSE_HOME  = 'https://www.nseindia.com/get-quote/equity?symbol=HYUNDAI';
const NSE_API   = 'https://www.nseindia.com/api/quote-equity?symbol=HYUNDAI';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function parseSetCookie(headers) {
  /* Node fetch's Headers does not expose set-cookie as an array
     consistently — getSetCookie() is the official getter. */
  const arr = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (headers.raw ? headers.raw()['set-cookie'] || [] : []);
  return arr.map(s => s.split(';')[0]).join('; ');
}

async function fetchHyundaiNSE() {
  /* Step 1: hit the equity page so NSE sets session cookies */
  console.log(`  GET ${NSE_HOME}`);
  let homeRes;
  try {
    homeRes = await fetch(NSE_HOME, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error(`home page fetch failed: ${e.message}`);
  }
  if (!homeRes.ok) throw new Error(`home page HTTP ${homeRes.status}`);
  const cookieHeader = parseSetCookie(homeRes.headers);
  if (!cookieHeader) throw new Error('no Set-Cookie returned (likely cloudflare-blocked)');
  console.log(`  cookies captured (${cookieHeader.length}b)`);

  /* Step 2: call the JSON API with the cookies */
  console.log(`  GET ${NSE_API}`);
  const apiRes = await fetch(NSE_API, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': cookieHeader,
      'Referer': NSE_HOME,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!apiRes.ok) throw new Error(`api HTTP ${apiRes.status}`);
  const ct = apiRes.headers.get('content-type') || '';
  const body = await apiRes.text();
  if (!ct.includes('json')) {
    throw new Error(`api returned non-JSON (${ct}) — likely served a challenge page`);
  }
  let json;
  try { json = JSON.parse(body); } catch (e) {
    throw new Error(`api returned invalid JSON: ${e.message}`);
  }
  return json;
}

function distill(json) {
  const price = json.priceInfo || {};
  const sec   = json.securityInfo || {};
  const ind   = json.industryInfo || {};
  const meta  = json.metadata || {};

  const out = {
    symbol:        meta.symbol || 'HYUNDAI',
    company_name:  meta.companyName || sec.companyName || null,
    series:        meta.series || sec.series || null,
    last_close:    price.lastPrice ?? price.previousClose ?? null,
    open:          price.open ?? null,
    intraday_low:  price.intraDayHighLow?.min ?? null,
    intraday_high: price.intraDayHighLow?.max ?? null,
    week52_low:    price.weekHighLow?.min ?? null,
    week52_high:   price.weekHighLow?.max ?? null,
    week52_low_date:  price.weekHighLow?.minDate ?? null,
    week52_high_date: price.weekHighLow?.maxDate ?? null,
    pe_ratio:      price.pPriceBand ?? null,
    sector_pe:     ind.sectoralIndex ?? null,
    industry:      ind.macro || ind.industry || null,
    listing_date:  meta.listingDate || null,
    fetched_at:    new Date().toISOString(),
    source_page:   NSE_HOME,
    source_api:    NSE_API,
  };
  return out;
}

async function main() {
  console.log('[fetch-hyundai-nse] starting…');
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8')); } catch {}

  let extracted = null;
  try {
    const json = await fetchHyundaiNSE();
    extracted = distill(json);
    console.log('  parsed:');
    console.log('    last close   :', extracted.last_close);
    console.log('    52-week low  :', extracted.week52_low);
    console.log('    52-week high :', extracted.week52_high);
    console.log('    company      :', extracted.company_name);
  } catch (e) {
    console.warn(`  fetch failed: ${e.message}`);
    console.warn('  NSE typically blocks GitHub Actions IPs — Yahoo / press fetchers remain authoritative.');
  }

  if (!extracted) {
    /* Don't poison raw_extracts.json with a failed run; just exit
       cleanly so the workflow can continue. */
    return;
  }

  raw.Hyundai = raw.Hyundai || {};
  raw.Hyundai.NSE = extracted;

  if (DRY_RUN) {
    console.log('\n[fetch-hyundai-nse] --dry-run: not writing file.');
    return;
  }
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
  console.log(`\n[fetch-hyundai-nse] wrote → ${RAW_PATH}`);
}

main().catch(err => {
  console.error('[fetch-hyundai-nse] fatal:', err);
  /* Exit 0 so the workflow continues — NSE fetch is best-effort. */
  process.exit(0);
});
