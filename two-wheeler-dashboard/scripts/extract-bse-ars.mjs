#!/usr/bin/env node
// Download AR PDFs listed in data/bse-<slug>.json and extract text into
// src/data/source-text/<OEM>_<YYYY>.txt using pdftotext (poppler).
// Usage: node scripts/extract-bse-ars.mjs [--slug=<slug>] [--years=2016-2022|all]
// Defaults: gap years per OEM (bajaj/hero 2016-2022, eicher 2016, ola-electric all).

import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

// OEM → uppercase short name used in src/data/source-text/<SHORT>_<YYYY>.txt
const SHORT = {
  tvs: 'TVS',
  bajaj: 'BAJAJ',
  hero: 'HERO',
  eicher: 'EICHER',
  'ola-electric': 'OLA',
};

// Default gap years per OEM — drawn from AUDIT_REPORT.md.
const DEFAULT_YEARS = {
  tvs: [], // back-catalogue extracted; AR doesn't disclose installed capacity (gap is real)
  bajaj: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
  hero: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
  // Eicher: pull the full back-catalogue so Royal Enfield / VECV volumes can be
  // parsed for every disclosed FY (only FY16 had been extracted before).
  eicher: 'all',
  'ola-electric': 'all', // only the post-IPO ARs (FY24/FY25) are on BSE
};

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/pdf,*/*',
  Referer: 'https://www.bseindia.com/',
  Origin: 'https://www.bseindia.com',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// BSE serves annual-report PDFs from different paths depending on vintage:
// older filings use a numeric name under /bseplus/AnnualReport/<scrip>/, while
// recent filings carry a GUID name (often double ".pdf.pdf") that lives under
// the corpfiling attachment store. Build every plausible URL and let the
// downloader try each until one returns a real PDF.
function arUrlCandidates(scrip, cleanFile) {
  const base = 'https://www.bseindia.com';
  const single = cleanFile.replace(/\.pdf\.pdf$/i, '.pdf');
  return [...new Set([
    `${base}/bseplus/AnnualReport/${scrip}/${cleanFile}`,
    `${base}/bseplus/AnnualReport/${scrip}/${single}`,
    `${base}/xml-data/corpfiling/AttachHis/${cleanFile}`,
    `${base}/xml-data/corpfiling/AttachHis/${single}`,
    `${base}/xml-data/corpfiling/AttachLive/${cleanFile}`,
    `${base}/xml-data/corpfiling/AttachLive/${single}`,
  ])];
}

// Try each candidate URL; light retry per URL for transient 403/429, but move
// on to the next candidate on a 404 / wrong-content. Returns { bytes, url }.
async function downloadPdf(urls, outPath) {
  let lastErr;
  for (const url of urls) {
    const delays = [0, 1500, 4000];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await sleep(delays[i]);
      try {
        const res = await fetch(url, { headers: HEADERS });
        if (res.status === 403 || res.status === 429) {
          lastErr = new Error(`${url} -> HTTP ${res.status}`);
          continue; // transient — retry the same URL
        }
        if (!res.ok) {
          lastErr = new Error(`${url} -> HTTP ${res.status}`);
          break; // 404 etc. — try the next candidate
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1024) { lastErr = new Error(`${url} -> too small (${buf.length}b)`); break; }
        if (buf.slice(0, 4).toString() !== '%PDF') { lastErr = new Error(`${url} -> not a PDF`); break; }
        await writeFile(outPath, buf);
        return { bytes: buf.length, url };
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr;
}

function pdfToText(pdfPath, txtPath) {
  const r = spawnSync('pdftotext', ['-layout', pdfPath, txtPath], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`pdftotext exit=${r.status} stderr=${(r.stderr || '').slice(0, 300)}`);
  }
}

function pickYears(slug, override) {
  if (override === 'all') return 'all';
  if (override) {
    const m = override.match(/^(\d{4})-(\d{4})$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      return Array.from({ length: b - a + 1 }, (_, i) => a + i);
    }
    return override.split(',').map((y) => Number(y.trim()));
  }
  return DEFAULT_YEARS[slug] ?? 'all';
}

const slugFilter = args.slug;
const yearsOverride = args.years;
const manifest = [];

for (const [slug, short] of Object.entries(SHORT)) {
  if (slugFilter && slugFilter !== slug) continue;
  const dataPath = `data/bse-${slug}.json`;
  if (!existsSync(dataPath)) {
    console.log(`[skip]  ${slug.padEnd(13)} ${dataPath} missing`);
    continue;
  }
  const file = JSON.parse(await readFile(dataPath, 'utf8'));
  const scrip = file.scrip;
  const ars = file?.categories?.annualReports?.data ?? [];
  const want = pickYears(slug, yearsOverride);

  for (const row of ars) {
    const year = Number(row.year);
    if (!Number.isFinite(year)) continue;
    if (want !== 'all' && !want.includes(year)) continue;

    const cleanFile = String(row.file_name || '').replace(/^\\+/, '').trim();
    if (!cleanFile) continue;

    const txtPath = `src/data/source-text/${short}_${year}.txt`;
    if (await fileExists(txtPath)) {
      console.log(`[skip]  ${short}_${year}  already extracted`);
      manifest.push({ slug, year, txtPath, status: 'already-present' });
      continue;
    }

    const candidates = arUrlCandidates(scrip, cleanFile);
    const pdfPath = `/tmp/${slug}-${year}.pdf`;

    try {
      await mkdir('src/data/source-text', { recursive: true });
      const { bytes, url } = await downloadPdf(candidates, pdfPath);
      pdfToText(pdfPath, txtPath);
      await rm(pdfPath, { force: true });
      const meta = `# Source: BSE Annual Report for scripcode ${scrip}, year ${year}\n# URL: ${url}\n# Extracted: ${new Date().toISOString()}\n`;
      await writeFile(`src/data/source-text/${short}_${year}.meta.txt`, meta, 'utf8');
      console.log(`[ok]    ${short}_${year}  ${Math.round(bytes / 1024)}KB  ${url}`);
      manifest.push({ slug, year, txtPath, status: 'extracted', url, bytes });
      await sleep(2000);
    } catch (e) {
      console.log(`[fail]  ${short}_${year}  ${e.message || e}`);
      manifest.push({ slug, year, status: 'failed', candidates, error: String(e.message || e) });
    }
  }
}

await mkdir('data', { recursive: true });
await writeFile(
  'data/bse-ar-extract-manifest.json',
  JSON.stringify({ ranAt: new Date().toISOString(), entries: manifest }, null, 2) + '\n',
  'utf8',
);
console.log(`\nmanifest: data/bse-ar-extract-manifest.json (${manifest.length} entries)`);
process.exit(0);
