#!/usr/bin/env node
// Fetch the latest monthly retail-data tables from FADA and emit a structured
// JSON. Designed for GitHub Actions (sandbox blocks fada.in).
//
// Usage:
//   node scripts/fetch-fada.mjs
//
// What it does:
//   1. Hits FADA's monthly press-release index page.
//   2. Picks the most recent monthly release URL.
//   3. Parses the 2W rows (segment-wise) into rows {month, segment, ytd, mom, yoy}.
//   4. Writes src/data/industry/fada-monthly-retail.json — schema-stable so the
//      dashboard can read partial data without crashing.
//
// FADA's HTML layout changes occasionally — this script logs a clear failure
// and writes a fallback JSON if any selector misses.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cheerio from 'cheerio'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'src', 'data', 'industry', 'fada-monthly-retail.json')

const INDEX_URL = 'https://fada.in/research-monthly-vehicle.php'
const UA = 'Mozilla/5.0 (compatible; 2W-Dashboard-Bot/1.0; +https://github.com/techmuns/two-wheeler-dashboard)'

const writeJson = (data) => {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n')
}

async function main() {
  process.stdout.write(`GET ${INDEX_URL} ... `)
  let html = ''
  let status = null
  try {
    const res = await fetch(INDEX_URL, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.7' },
    })
    status = res.status
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = await res.text()
    console.log(`HTTP ${res.status}`)
  } catch (err) {
    console.error('FAILED:', err.message)
    writeJson({
      source: 'FADA monthly retail press releases',
      sourceUrl: INDEX_URL,
      lastUpdated: null,
      fetchStatus: 'error',
      error: err.message,
      months: [],
    })
    process.exit(1)
  }

  const $ = cheerio.load(html)

  // The index page has tables of monthly press releases. We pick the most
  // recent one and follow its link.
  const releaseLinks = []
  $('a[href*="research-monthly-vehicle-details"]').each((_, a) => {
    const href = $(a).attr('href')
    const label = $(a).text().trim()
    if (href && label) releaseLinks.push({ href: new URL(href, INDEX_URL).toString(), label })
  })

  if (!releaseLinks.length) {
    writeJson({
      source: 'FADA monthly retail press releases',
      sourceUrl: INDEX_URL,
      lastUpdated: null,
      fetchStatus: 'parse_failed',
      error: 'No monthly release links found on index page',
      months: [],
    })
    console.error('No release links found.')
    process.exit(1)
  }

  // Fetch the latest release page and extract 2W table rows.
  const latest = releaseLinks[0]
  process.stdout.write(`GET ${latest.href} ... `)
  const detailRes = await fetch(latest.href, { headers: { 'User-Agent': UA } })
  console.log(`HTTP ${detailRes.status}`)
  const detailHtml = await detailRes.text()
  const $$ = cheerio.load(detailHtml)

  const months = []
  // Look for any table cell containing "2W" or "Two Wheeler".
  $$('table').each((_, table) => {
    const $rows = $$(table).find('tr')
    $rows.each((_, tr) => {
      const cells = $$(tr).find('td').toArray().map((td) => $$(td).text().trim())
      if (!cells.length) return
      const first = cells[0].toLowerCase()
      if (first.startsWith('2w') || first.includes('two wheeler') || first.includes('2 wheeler')) {
        months.push({ rowLabel: cells[0], values: cells.slice(1) })
      }
    })
  })

  writeJson({
    source: 'FADA monthly retail press releases',
    sourceUrl: latest.href,
    indexUrl: INDEX_URL,
    lastUpdated: new Date().toISOString(),
    fetchStatus: months.length ? 'ok' : 'partial',
    latestReleaseLabel: latest.label,
    months,
    notes: 'months[].values are raw cell strings from the FADA monthly press release. Schema is intentionally loose because FADA updates its table layout periodically.',
  })
  console.log(`  wrote ${OUT}`)
  console.log(`  release: ${latest.label}`)
  console.log(`  2W rows: ${months.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
