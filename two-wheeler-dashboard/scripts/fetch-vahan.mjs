#!/usr/bin/env node
// Fetch 2W EV / total registrations from the Vahan public analytics endpoint
// and emit a structured JSON.
//
// Caveat: analytics.parivahan.gov.in is a JSP/JSF app, not a public API. The
// 'PublicReport' endpoint accepts POST forms with hidden ViewState tokens that
// rotate. This script attempts the simple GET path first; if that returns a
// usable JSON payload it parses it, otherwise it writes a 'pending' JSON with
// a clear failure note so the dashboard can keep rendering.
//
// To extend this script, capture a successful network call from your browser
// (Vahan dashboard → Vehicle Class 2WN/2WIC/2WT → fuel type filter) and
// translate the request payload here.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'src', 'data', 'industry', 'vahan-fetched.json')

const ROOT = 'https://analytics.parivahan.gov.in/analytics/'
const UA = 'Mozilla/5.0 (compatible; 2W-Dashboard-Bot/1.0; +https://github.com/techmuns/two-wheeler-dashboard)'

const writeJson = (data) => {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n')
}

async function main() {
  process.stdout.write(`GET ${ROOT} ... `)
  let status = null
  try {
    const res = await fetch(ROOT, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } })
    status = res.status
    console.log(`HTTP ${res.status}`)
  } catch (err) {
    console.error('FAILED:', err.message)
  }

  // The dashboard is JS-rendered behind a JSF ViewState — we can't get the
  // numbers via a single GET. Surface this honestly so the workflow doesn't
  // pretend to have fetched data when it hasn't.
  writeJson({
    source: 'Vahan public analytics dashboard',
    sourceUrl: ROOT,
    lastUpdated: new Date().toISOString(),
    fetchStatus: 'requires_browser_session',
    notes: [
      'Vahan public reports require a JSF ViewState session token. A simple GET cannot extract the registration breakdown.',
      'Recommended approaches: (1) Capture a real network request from analytics.parivahan.gov.in via DevTools, save the payload, and replay it here. (2) Use the Government Open Data Platform (data.gov.in) Vahan dataset where available. (3) Use a Playwright-based fetcher (heavier; needs browser deps in CI).',
      'Until then, 2w-ev-share.json carries the verified Vahan annual figures from SIAM cross-checks and analyst notes.',
    ],
    rawStatus: status,
  })
  console.log(`  wrote ${OUT} (status: requires_browser_session)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
