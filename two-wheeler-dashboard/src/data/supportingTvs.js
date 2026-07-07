// TVS Supporting Data — 8 dropdown groups, ~40 metrics. Every metric carries
// its real source + verification. Metrics the audited workbook doesn't
// disclose are kept in the group definitions but marked as 'Unavailable'
// with a one-line reason, so the user can see at a glance what TVS actually
// publishes vs what would need an external dataset.

import { FY } from './_fy.js'
import tvsRaw from './companies/tvs.json'
import marketShare from './industry/2w-market-share.json'

const TVS_AX = tvsRaw.fyAxis || []
const AUDITED_SRC = tvsRaw.sources?.primary || 'TVS Motor standalone audited annual reports + Q4 result packages'
const SIAM_SRC = marketShare.source

// Align a workbook series (indexed by tvsRaw.fyAxis) onto the dashboard FY axis.
const align = (arr) => FY.map((fy) => {
  const i = TVS_AX.indexOf(fy)
  return i >= 0 && typeof arr?.[i] === 'number' ? arr[i] : null
})

// EV share is a single-point series — FY16-FY24 disclosed as 0, FY25 = 5.88.
const evShareSeries = align(tvsRaw.metrics?.evShare)

// Motorcycle / scooter / moped / 3W mix — only FY25 disclosed in the workbook.
const buildSinglePoint = (fy25Value) => {
  const arr = new Array(FY.length).fill(null)
  if (typeof fy25Value === 'number') arr[FY.indexOf('FY25')] = fy25Value
  return arr
}

const motorcycleMixSeries  = buildSinglePoint(tvsRaw.metrics?.motorcycleMixFy25)
const scooterMixSeries     = buildSinglePoint(tvsRaw.metrics?.scooterMixFy25)
const mopedMixSeries       = buildSinglePoint(tvsRaw.metrics?.mopedMixFy25)
const threeWheelerMixSeries = buildSinglePoint(tvsRaw.metrics?.threeWheelerMixFy25)

// TVS market share, from SIAM industry file (approximate, FY16-FY25).
const tvsMarketShareSeries = FY.map((fy) => {
  const v = marketShare.series?.TVS?.[fy]
  return typeof v === 'number' ? v : null
})

// Standard 'Unavailable' metric stub.
const UNAVAILABLE = (label, fmt, reason, key) => ({
  key, label, fmt,
  series: new Array(FY.length).fill(null),
  verification: 'pending',
  source: null,
  unavailable: true,
  reason,
})

const AVAILABLE = (key, label, fmt, series, verification, source, note) => ({
  key, label, fmt, series, verification, source, note: note || null, unavailable: false,
})

const NA_STANDALONE = 'Not disclosed in standalone audited statements; would require company KMP filings / investor handout extraction.'
const NA_CC_SLAB    = 'CC-slab (75–110 / 110–125 / 125–150 / 150–200 / 200–250 / 250–350 / >350) splits are not in TVS standalone audited disclosures. Available in SIAM "Engine Capacity-Wise" annual bulletin; requires upload.'
const NA_MIX_HIST   = 'TVS does not disclose this mix line consistently across FY16–FY25 in the standalone audited statements. Only FY25 value disclosed where available.'
const NA_REV_MIX    = 'TVS does not disclose segment-level revenue split (EV / Motorcycle / Export revenue %) in standalone audited statements.'
const NA_LAUNCHES   = 'Launch counts not published in audited financials; would need investor-presentation extraction across 10 annual decks.'
const NA_PROFILE    = 'Company profile field (KMP / dealer count / employee count / credit rating / stock price) not in the uploaded workbook. Public sources: TVS investor portal, CRISIL Ratings, BSE/NSE price archive.'

// ----------------------------------------------------------------------------
// GROUP DEFINITIONS
// ----------------------------------------------------------------------------
export const TVS_GROUPS = [
  {
    name: 'Growth',
    chartType: 'line',
    metrics: [
      AVAILABLE('revenueGrowth',     'Revenue Growth %',     'pp', align(tvsRaw.metrics?.revenueGrowth),     'audited', AUDITED_SRC),
      AVAILABLE('volumeGrowth',      'Volume Growth %',      'pp', align(tvsRaw.metrics?.volumeGrowth),      'audited', AUDITED_SRC),
      AVAILABLE('realisationGrowth', 'Realisation Growth %', 'pp', align(tvsRaw.metrics?.realisationGrowth), 'audited', AUDITED_SRC),
    ],
    sourceFootnote: `Source: ${AUDITED_SRC}. All three series computed FY-on-FY from disclosed revenue, volume, and revenue/volume realisation.`,
  },

  {
    name: 'Margins',
    chartType: 'line',
    metrics: [
      AVAILABLE('grossMargin',  'Gross Margin %',       'pp',  align(tvsRaw.metrics?.grossMargin),  'audited', AUDITED_SRC),
      AVAILABLE('ebitdaMargin', 'EBITDA Margin %',      'pp',  align(tvsRaw.metrics?.ebitdaMargin), 'audited', AUDITED_SRC),
      AVAILABLE('wcDays',       'Working Capital Days', 'abs', align(tvsRaw.metrics?.wcDays),       'audited', AUDITED_SRC),
    ],
    sourceFootnote: `Source: ${AUDITED_SRC}. Margins derived from disclosed P&L lines; WC Days = (Receivables + Inventory − Payables) / Revenue × 365.`,
  },

  {
    name: 'Capacity & Capex',
    chartType: 'line',
    metrics: [
      UNAVAILABLE('Capacity',               'abs', NA_PROFILE, 'capacity'),
      UNAVAILABLE('Capacity Utilisation %', 'pp',  NA_PROFILE, 'capacityUtilisation'),
      AVAILABLE  ('capex', 'Capex (₹ Cr)',  'abs', align(tvsRaw.cf?.capex), 'audited', AUDITED_SRC),
    ],
    sourceFootnote: `Capex from ${AUDITED_SRC}. Capacity + utilisation %: ${NA_PROFILE}`,
  },

  {
    name: 'Market Share',
    chartType: 'line',
    metrics: [
      AVAILABLE('marketShare', 'Market Share % (overall 2W)', 'pp', tvsMarketShareSeries, 'approximate', SIAM_SRC,
        'Approximate — from SIAM industry file; verify against latest SIAM bulletin.'),
      UNAVAILABLE('75–110CC Market Share',  'pp', NA_CC_SLAB, 'ms_75_110'),
      UNAVAILABLE('110–125CC Market Share', 'pp', NA_CC_SLAB, 'ms_110_125'),
      UNAVAILABLE('125–150CC Market Share', 'pp', NA_CC_SLAB, 'ms_125_150'),
      UNAVAILABLE('150–200CC Market Share', 'pp', NA_CC_SLAB, 'ms_150_200'),
      UNAVAILABLE('200–250CC Market Share', 'pp', NA_CC_SLAB, 'ms_200_250'),
      UNAVAILABLE('250–350CC Market Share', 'pp', NA_CC_SLAB, 'ms_250_350'),
      UNAVAILABLE('>350CC Market Share',    'pp', NA_CC_SLAB, 'ms_350_plus'),
    ],
    sourceFootnote: `Overall 2W share from ${SIAM_SRC} (approximate). CC-slab share: ${NA_CC_SLAB}`,
  },

  {
    name: 'Volume Mix',
    chartType: 'line',
    metrics: [
      UNAVAILABLE('Export Volume %',     'pp', NA_MIX_HIST, 'exportVolume'),
      AVAILABLE  ('evVolume',         'EV Volume %',         'pp', evShareSeries,         'audited', AUDITED_SRC,
        'Disclosed in TVS FY25 AR. Pre-FY25 figures stated as 0 (iQube ramp-up).'),
      AVAILABLE  ('motorcycleVolume', 'Motorcycle Volume %', 'pp', motorcycleMixSeries,   'audited', AUDITED_SRC,
        'Only FY25 disclosed in workbook (46.27%). Earlier-year mix split not disclosed.'),
      AVAILABLE  ('scooterVolume',    'Scooter Volume %',    'pp', scooterMixSeries,      'audited', AUDITED_SRC, 'FY25 only.'),
      AVAILABLE  ('mopedVolume',      'Moped Volume %',      'pp', mopedMixSeries,        'audited', AUDITED_SRC, 'FY25 only.'),
      AVAILABLE  ('threeWheelerVolume','Three-Wheeler Volume %','pp', threeWheelerMixSeries,'audited', AUDITED_SRC, 'FY25 only.'),
      UNAVAILABLE('75–110CC Volume',  'abs', NA_CC_SLAB, 'v_75_110'),
      UNAVAILABLE('110–125CC Volume', 'abs', NA_CC_SLAB, 'v_110_125'),
      UNAVAILABLE('125–150CC Volume', 'abs', NA_CC_SLAB, 'v_125_150'),
      UNAVAILABLE('150–200CC Volume', 'abs', NA_CC_SLAB, 'v_150_200'),
      UNAVAILABLE('200–250CC Volume', 'abs', NA_CC_SLAB, 'v_200_250'),
      UNAVAILABLE('250–350CC Volume', 'abs', NA_CC_SLAB, 'v_250_350'),
      UNAVAILABLE('>350CC Volume',    'abs', NA_CC_SLAB, 'v_350_plus'),
    ],
    sourceFootnote: `EV / Motorcycle / Scooter / Moped / 3W mix from ${AUDITED_SRC} (FY25 only). Export mix and CC-slab volumes: not in workbook.`,
  },

  {
    name: 'Revenue Mix',
    chartType: 'line',
    metrics: [
      UNAVAILABLE('Export Revenue %',     'pp', NA_REV_MIX, 'exportRevenue'),
      UNAVAILABLE('EV Revenue %',         'pp', NA_REV_MIX, 'evRevenue'),
      UNAVAILABLE('Motorcycle Revenue %', 'pp', NA_REV_MIX, 'motorcycleRevenue'),
    ],
    sourceFootnote: NA_REV_MIX,
  },

  {
    name: 'Product / Launches',
    chartType: 'profile',
    metrics: [
      UNAVAILABLE('New Model Launches (Nos.)', 'abs',  NA_LAUNCHES, 'newLaunches'),
      UNAVAILABLE('Facelift Launches (Nos.)',  'abs',  NA_LAUNCHES, 'faceliftLaunches'),
      UNAVAILABLE('Top Selling Model',         'text', NA_LAUNCHES, 'topSellingModel'),
    ],
    sourceFootnote: NA_LAUNCHES,
  },

  {
    name: 'Company Profile',
    chartType: 'profile',
    metrics: [
      UNAVAILABLE('Stock Price as on 31-Mar', 'abs',  NA_PROFILE, 'stockPrice'),
      UNAVAILABLE('No. of Employees',         'abs',  NA_PROFILE, 'employees'),
      UNAVAILABLE('No. of Dealers',           'abs',  NA_PROFILE, 'dealers'),
      UNAVAILABLE('CEO',                      'text', NA_PROFILE, 'ceo'),
      UNAVAILABLE('CFO',                      'text', NA_PROFILE, 'cfo'),
      UNAVAILABLE('COO',                      'text', NA_PROFILE, 'coo'),
      UNAVAILABLE('Credit Rating',            'text', NA_PROFILE, 'creditRating'),
    ],
    sourceFootnote: NA_PROFILE,
  },
]

export const TVS_GROUP_NAMES = TVS_GROUPS.map((g) => g.name)

// ----------------------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------------------
const fy24Idx = FY.indexOf('FY24')
const fy25Idx = FY.indexOf('FY25')

export function getMetricRead(curr, prev, fmt) {
  if (typeof curr !== 'number' || typeof prev !== 'number') return 'Neutral'
  const d = curr - prev
  if (d > 1) return 'Positive'
  if (d < -1) return 'Negative'
  return 'Neutral'
}

export function getSupportingData(group, latestFy = 'FY25') {
  // Returns the table rows for the left panel: { metric, fy24, fy25, change, read, ... }
  // The fy24/fy25 keys carry the prior / current FY. Current follows the
  // company's latest reported year (floored at FY25 so it never regresses).
  const curIdx = Math.max(fy25Idx, FY.indexOf(latestFy))
  const prevIdx = curIdx - 1
  return group.metrics.map((m) => {
    const fy24 = prevIdx >= 0 ? m.series?.[prevIdx] : null
    const fy25 = m.series?.[curIdx]
    const change = (typeof fy24 === 'number' && typeof fy25 === 'number') ? Number((fy25 - fy24).toFixed(2)) : null
    const read = m.unavailable ? 'Neutral' : getMetricRead(fy25, fy24, m.fmt)
    return { ...m, fy24, fy25, change, read }
  })
}

export function getSupportingChartData(group) {
  // Returns: { type, series, hasAny, allUnavailable }
  const series = group.metrics
    .filter((m) => !m.unavailable && m.series?.some((v) => typeof v === 'number'))
    .map((m, idx) => ({
      name: m.label,
      color: SERIES_PALETTE[idx % SERIES_PALETTE.length],
      values: m.series,
      fmt: m.fmt,
    }))
  return {
    type: group.chartType,
    series,
    hasAny: series.length > 0,
    allUnavailable: group.metrics.every((m) => m.unavailable),
  }
}

const SERIES_PALETTE = ['#1f2937', '#3b82f6', '#10b981', '#f59e0b', '#6d28d9', '#dc2626', '#0EA5E9']

export function normalizeMixTo100(rows) {
  // rows: [{name, value}], returns rows with percent + Unclassified if needed.
  const sum = rows.reduce((a, b) => a + (typeof b.value === 'number' ? b.value : 0), 0)
  if (sum === 0) return rows.map((r) => ({ ...r, percent: 0 }))
  const out = rows.map((r) => ({ ...r, percent: (r.value / sum) * 100 }))
  const total = out.reduce((a, b) => a + b.percent, 0)
  if (total < 99.5) {
    out.push({ name: 'Unclassified', value: null, percent: 100 - total, isUnclassified: true })
  }
  return out
}
