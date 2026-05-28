#!/usr/bin/env node
// Scrape public BSE corporate data for a listed company.
// Usage: node scripts/scrape-bse-company.mjs <6-digit-scripCode> <slug>
// Output: data/bse-<slug>.json

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const [, , scrip, slug] = process.argv;
if (!scrip || !/^\d{6}$/.test(scrip) || !slug) {
  console.error('Usage: node scripts/scrape-bse-company.mjs <6-digit-scripCode> <slug>');
  process.exit(2);
}

const WINDOW_DAYS = 90;
const today = new Date();
const from = new Date(today.getTime() - WINDOW_DAYS * 86400_000);
const ymd = (d) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const FROM = ymd(from);
const TO = ymd(today);

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.bseindia.com/',
  Origin: 'https://www.bseindia.com',
};

const ENDPOINTS = {
  announcements: {
    tag: 'confirmed',
    url: `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?pageno=1&strCat=-1&strPrevDate=${FROM}&strScrip=${scrip}&strSearch=P&strToDate=${TO}&strType=C`,
  },
  corpActions: {
    tag: 'confirmed',
    url: `https://api.bseindia.com/BseIndiaAPI/api/DefaultData/w?Fdate=${FROM}&TDate=${TO}&Purposecode=&ddlcategorys=E&ddlindustrys=&scripcode=${scrip}&segment=0&strSearch=S`,
  },
  boardMeetings: {
    tag: 'confirmed',
    url: `https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w?fromdate=${FROM}&todate=${TO}&scripcode=${scrip}`,
  },
  annualReports: {
    tag: 'confirmed',
    url: `https://api.bseindia.com/BseIndiaAPI/api/AnnualReport/w?scripcode=${scrip}`,
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const delays = [0, 1500, 4000, 9000];
  let lastErr;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await sleep(delays[i]);
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 403 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const head = text.trimStart().slice(0, 16).toLowerCase();
      if (head.startsWith('<!doctype') || head.startsWith('<html')) {
        throw new Error('Non-JSON HTML response — wrong endpoint path');
      }
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.Table)) return payload.Table;
  if (payload && Array.isArray(payload.Data)) return payload.Data;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

const results = {};

for (const [key, { url, tag }] of Object.entries(ENDPOINTS)) {
  try {
    const payload = await fetchJson(url);
    const rows = extractRows(payload);
    results[key] = { ok: true, url, count: rows.length, tag, data: rows };
    console.log(`[ok]    ${key.padEnd(15)} ${rows.length} rows  (${tag})`);
  } catch (e) {
    results[key] = { ok: false, url, count: 0, tag, error: String(e.message || e) };
    console.log(`[fail]  ${key.padEnd(15)} ${e.message || e}`);
  }
}

// Derived: results = announcements where CATEGORYNAME matches /result/i
const annRecord = results.announcements;
if (annRecord && annRecord.ok && Array.isArray(annRecord.data)) {
  const filtered = annRecord.data.filter((r) => /result/i.test(String(r.CATEGORYNAME || '')));
  results.results = {
    ok: true,
    url: null,
    count: filtered.length,
    tag: 'derived',
    derivedFrom: 'announcements',
    data: filtered,
  };
  console.log(`[ok]    ${'results'.padEnd(15)} ${filtered.length} rows  (derived)`);
} else {
  results.results = {
    ok: false,
    url: null,
    count: 0,
    tag: 'derived',
    derivedFrom: 'announcements',
    error: 'announcements not available',
  };
  console.log('[fail]  results          announcements not available');
}

const PDF_BASE = 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/';
const announcementPdf = (row) =>
  row && row.ATTACHMENTNAME ? `${PDF_BASE}${row.ATTACHMENTNAME}` : null;

const out = {
  scrip,
  slug,
  fetchedAt: new Date().toISOString(),
  window: { from: FROM, to: TO, days: WINDOW_DAYS },
  pdfBase: PDF_BASE,
  helpers: {
    announcementPdf: '`${pdfBase}${row.ATTACHMENTNAME}`',
  },
  categories: results,
};

if (annRecord && annRecord.ok) {
  out.categories.announcements.data = annRecord.data.map((row) => ({
    ...row,
    _pdfUrl: announcementPdf(row),
  }));
  out.categories.results.data = out.categories.results.data.map((row) => ({
    ...row,
    _pdfUrl: announcementPdf(row),
  }));
}

const outPath = `data/bse-${slug}.json`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`\nwrote ${outPath}`);

// Always exit 0 — partial failure must not red-X CI.
process.exit(0);
