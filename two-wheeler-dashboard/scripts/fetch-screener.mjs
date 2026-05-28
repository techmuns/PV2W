#!/usr/bin/env node
// Fetch consolidated annual financials from Screener for a given ticker
// and write the parsed tables to src/data/companies/<id>.json.
//
// Usage:
//   node scripts/fetch-screener.mjs TVSMOTOR
//
// Networked only — designed to run in GitHub Actions. Numbers come straight
// from Screener's HTML tables (Profit & Loss, Balance Sheet, Cash Flow,
// Ratios, Quarters). Each output JSON records the source URL + fetch
// timestamp so the dashboard can cite where each cell came from.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cheerio from 'cheerio'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Map Screener tickers → internal company ids used by the dashboard.
const TICKER_MAP = {
  TVSMOTOR:     { id: 'tvs',    name: 'TVS Motor Company Ltd' },
  'BAJAJ-AUTO': { id: 'bajaj',  name: 'Bajaj Auto Ltd' },
  HEROMOTOCO:   { id: 'hero',   name: 'Hero MotoCorp Ltd' },
  EICHERMOT:    { id: 'eicher', name: 'Eicher Motors Ltd' },
  OLAELEC:      { id: 'ola',    name: 'Ola Electric Mobility Ltd' },
}

const SCREENER_URL = (t) => `https://www.screener.in/company/${t}/consolidated/`
const UA = 'Mozilla/5.0 (compatible; 2W-Dashboard-Bot/1.0; +https://github.com/techmuns/two-wheeler-dashboard)'

function parseNumber(text) {
  if (text == null) return null
  let s = String(text).trim().replace(/,/g, '').replace(/ /g, '').replace(/\s+/g, '')
  if (!s || s === '-' || s === '—') return null
  const neg = /^\(([^)]+)\)$/.exec(s)
  if (neg) s = '-' + neg[1]
  s = s.replace(/%$/, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Screener column labels look like "Mar 2025" / "Mar 2024" / "TTM" / "Jun 2024" etc.
// We map annual "Mar YYYY" → "FY{YY%100}". Quarterly labels are returned verbatim.
function parsePeriodAnnual(text) {
  if (!text) return null
  const t = String(text).trim()
  if (/^TTM$/i.test(t)) return 'TTM'
  const m = /^[A-Za-z]{3}\s*(\d{4})$/.exec(t)
  if (m) {
    const yy = Number(m[1]) % 100
    return `FY${String(yy).padStart(2, '0')}`
  }
  return t
}

function parsePeriodQuarterly(text) {
  if (!text) return null
  return String(text).trim()
}

function extractTable($, sectionId, periodFmt = parsePeriodAnnual) {
  const $section = $(`section#${sectionId}, div#${sectionId}`)
  if (!$section.length) return null
  const $table = $section.find('table').first()
  if (!$table.length) return null

  // Headers: first <th> is empty/blank, rest are period labels.
  const headerCells = $table.find('thead th').toArray()
  const periods = headerCells
    .slice(1)
    .map((th) => $(th).text().trim())
    .map(periodFmt)
    .filter(Boolean)

  const rows = {}
  $table.find('tbody tr').each((_, tr) => {
    const $tr = $(tr)
    const $cells = $tr.find('td')
    if ($cells.length < 2) return
    let metric = $cells.eq(0).text().trim()
    metric = metric.replace(/\s+/g, ' ').replace(/\+$/, '').replace(/ /g, ' ').trim()
    if (!metric || /^click/i.test(metric)) return
    const values = $cells.slice(1).toArray().map((td) => parseNumber($(td).text()))
    if (values.every((v) => v === null)) return
    rows[metric] = values
  })

  return { periods, rows }
}

async function fetchTicker(ticker) {
  const url = SCREENER_URL(ticker)
  process.stdout.write(`GET ${url} ... `)
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.7',
    },
    redirect: 'follow',
  })
  console.log(`HTTP ${res.status}`)
  if (!res.ok) throw new Error(`Screener returned HTTP ${res.status} for ${ticker}`)
  const html = await res.text()
  const $ = cheerio.load(html)

  const meta = TICKER_MAP[ticker] || { id: ticker.toLowerCase(), name: ticker }

  const profitLoss   = extractTable($, 'profit-loss')   || { periods: [], rows: {} }
  const balanceSheet = extractTable($, 'balance-sheet') || { periods: [], rows: {} }
  const cashFlow     = extractTable($, 'cash-flow')     || { periods: [], rows: {} }
  const ratios       = extractTable($, 'ratios')        || { periods: [], rows: {} }
  const quarters     = extractTable($, 'quarters', parsePeriodQuarterly) || { periods: [], rows: {} }

  // Sanity check: P&L must have at least Sales / Revenue.
  const hasSales = !!(profitLoss.rows['Sales'] || profitLoss.rows['Revenue'])
  if (!hasSales) {
    console.warn(`WARN: no Sales row found for ${ticker}. Screener may have changed its layout.`)
  }

  return {
    ticker,
    id: meta.id,
    name: meta.name,
    sources: {
      screener:    url,
      profitLoss:  `${url}#profit-loss`,
      balanceSheet: `${url}#balance-sheet`,
      cashFlow:    `${url}#cash-flow`,
      ratios:      `${url}#ratios`,
      quarters:    `${url}#quarters`,
    },
    fetchedAt: new Date().toISOString(),
    profitLoss,
    balanceSheet,
    cashFlow,
    ratios,
    quarters,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const tickers = args.length ? args : ['TVSMOTOR']

  const outDir = resolve(__dirname, '..', 'src', 'data', 'companies')
  mkdirSync(outDir, { recursive: true })
  // Sidecar directory so the Screener fetch NEVER clobbers manually-curated
  // company JSONs (which carry AR-extracted volume splits, KMP, profile,
  // logo config, etc. that Screener does not provide).
  const screenerDir = resolve(outDir, '_screener')
  mkdirSync(screenerDir, { recursive: true })

  for (const t of tickers) {
    try {
      const data = await fetchTicker(t)
      // Always write to the sidecar — never overwrite the curated companies/*.json
      // files, which carry dashboard-shape data (volumes / KMP / logo / etc.).
      // The dashboard layer reads this sidecar and merges Screener financials
      // into the per-company object only where the curated file is missing data.
      const file = resolve(screenerDir, `${data.id}.json`)
      writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
      const periods = data.profitLoss.periods
      console.log(`  wrote ${file}`)
      console.log(`  periods: [${periods.join(', ')}]`)
      console.log(`  rows: P&L=${Object.keys(data.profitLoss.rows).length}, BS=${Object.keys(data.balanceSheet.rows).length}, CF=${Object.keys(data.cashFlow.rows).length}, R=${Object.keys(data.ratios.rows).length}`)
    } catch (e) {
      console.error(`FAILED for ${t}:`, e.message)
      process.exitCode = 1
    }
  }
}

main()
