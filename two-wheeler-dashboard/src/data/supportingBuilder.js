// Generic Supporting Data builder. Produces the 8-group dropdown structure
// from any OEM's audited workbook JSON (same schema as src/data/companies/tvs.json).
//
// - If the workbook is populated, available metrics show real data with audited
//   verification; not-disclosed metrics show Unavailable with a specific reason.
// - If the workbook is a skeleton (no fyAxis / no pl), every metric shows
//   Unavailable with reason "Awaiting <company> workbook upload" so the user
//   can see the structure that's waiting to be filled.

import { FY } from './_fy.js'
import marketShareJson from './industry/2w-market-share.json'

const SERIES_PALETTE = ['#1f2937', '#3b82f6', '#10b981', '#f59e0b', '#6d28d9', '#dc2626', '#0EA5E9']

const NA_REASONS = {
  pending:       (n) => `Awaiting ${n} data.`,
  standalone:    'Not in financial filings.',
  ccSlab:        'CC-slab not disclosed.',
  mixHist:       'Disclosed FY25 only.',
  revMix:        'Segment revenue not disclosed.',
  launches:      'Not in financial filings.',
  profile:       'Not in filings.',
}

const align = (arr, sourceAxis) => FY.map((fy) => {
  const i = sourceAxis?.indexOf?.(fy)
  return i !== undefined && i >= 0 && typeof arr?.[i] === 'number' ? arr[i] : null
})

const buildSinglePoint = (fy25Value) => {
  const arr = new Array(FY.length).fill(null)
  if (typeof fy25Value === 'number') arr[FY.indexOf('FY25')] = fy25Value
  return arr
}

const allNull = (arr) => !arr || arr.every((v) => typeof v !== 'number')

const NA = (label, fmt, reason, key) => ({
  key, label, fmt,
  series: new Array(FY.length).fill(null),
  verification: 'pending',
  source: null,
  unavailable: true,
  reason,
})

const OK = (key, label, fmt, series, verification, source, note) => ({
  key, label, fmt, series, verification, source, note: note || null, unavailable: false,
})

// A metric that exists but is only available behind a paid/licensed source
// (e.g. SIAM engine-capacity bulletin / JATO). Rendered locked, not removed.
const PAID = (label, fmt, key) => ({
  key, label, fmt,
  series: new Array(FY.length).fill(null),
  verification: 'paid',
  source: 'Licensed (SIAM / JATO)',
  unavailable: true,
  paid: true,
  reason: 'Licensed data — SIAM engine-capacity bulletin / JATO.',
})

// Returns a metric object — automatically degrades to Unavailable if the
// resolved series is all-null.
const resolve = (key, label, fmt, series, verification, source, opts = {}) => {
  if (allNull(series)) {
    return NA(label, fmt, opts.naReason, key)
  }
  return OK(key, label, fmt, series, verification, source, opts.note)
}

// Build a 'profile' metric — uses the AR-sourced value when available, else NA.
const profileMetric = (label, fmt, key, value, source) =>
  (value === null || value === undefined || value === '')
    ? NA(label, fmt, source || 'Not disclosed in the uploaded annual report.', key)
    : { key, label, fmt, series: new Array(FY.length).fill(null), fy25: value, verification: 'available', source, unavailable: false }

export function buildSupportingGroups(raw, opts = {}) {
  const {
    shortName,
    publicName,
    marketShareKey,
  } = opts
  const prof = raw?.profile || null

  const isPopulated = !!(raw?.fyAxis?.length && raw?.pl && Object.keys(raw.pl).length > 0)
  const auditedSrc  = raw?.sources?.primary || null
  const ax = raw?.fyAxis || []

  // Pending reason used when the workbook is a skeleton (no data uploaded yet).
  const pendingReason = isPopulated ? NA_REASONS.standalone : NA_REASONS.pending(publicName || shortName || 'OEM')

  // ---------- raw series alignment ----------
  // Segment mix % per FY, computed from disclosed unit volumes (segment / total)
  // so the full history plots — not just the FY25 snapshot. Years without a
  // disclosed split stay null.
  const totalVolAligned = align(raw?.ops?.totalVolume, ax)
  const mixPct = (byFy) => FY.map((fy, i) => {
    const v = byFy?.[fy]
    const t = totalVolAligned[i]
    return (typeof v === 'number' && typeof t === 'number' && t > 0) ? Number(((v / t) * 100).toFixed(1)) : null
  })

  const s = {
    revenueGrowth:     align(raw?.metrics?.revenueGrowth, ax),
    volumeGrowth:      align(raw?.metrics?.volumeGrowth, ax),
    realisationGrowth: align(raw?.metrics?.realisationGrowth, ax),
    grossMargin:       align(raw?.metrics?.grossMargin, ax),
    ebitdaMargin:      align(raw?.metrics?.ebitdaMargin, ax),
    wcDays:            align(raw?.metrics?.wcDays, ax),
    capex:             align(raw?.cf?.capex, ax),
    capacity:            align(raw?.metrics?.capacity, ax),
    capacityUtilisation: align(raw?.metrics?.capacityUtilisation, ax),
    evShare:           align(raw?.metrics?.evShare, ax),
    motorcycleMix:     mixPct(raw?.ops?.motorcyclesByFy),
    scooterMix:        mixPct(raw?.ops?.scootersByFy),
    mopedMix:          mixPct(raw?.ops?.mopedsByFy),
    threeWheelerMix:   mixPct(raw?.ops?.threeWheelersByFy),
  }

  // ---------- market share from industry file ----------
  const msKey = marketShareKey
  const mktShareRow = msKey ? marketShareJson.series?.[msKey] : null
  const mktShareSeries = FY.map((fy) => (typeof mktShareRow?.[fy] === 'number' ? mktShareRow[fy] : null))
  const mktSrc = marketShareJson.source

  // ---------- group definitions ----------
  const groups = [
    {
      name: 'Growth',
      chartType: 'line',
      metrics: [
        resolve('revenueGrowth',     'Revenue Growth %',     'pp', s.revenueGrowth,     'audited', auditedSrc, { naReason: pendingReason }),
        resolve('volumeGrowth',      'Volume Growth %',      'pp', s.volumeGrowth,      'audited', auditedSrc, { naReason: pendingReason }),
        resolve('realisationGrowth', 'Realisation Growth %', 'pp', s.realisationGrowth, 'audited', auditedSrc, { naReason: pendingReason }),
      ],
      sourceFootnote: isPopulated ? 'Source: Annual reports' : pendingReason,
    },

    {
      name: 'Margins',
      chartType: 'line',
      metrics: [
        resolve('grossMargin',  'Gross Margin %',       'pp',  s.grossMargin,  'audited', auditedSrc, { naReason: pendingReason }),
        resolve('ebitdaMargin', 'EBITDA Margin %',      'pp',  s.ebitdaMargin, 'audited', auditedSrc, { naReason: pendingReason }),
        resolve('wcDays',       'Working Capital Days', 'abs', s.wcDays,       'audited', auditedSrc, { naReason: pendingReason }),
      ],
      sourceFootnote: isPopulated ? 'Source: Annual reports' : pendingReason,
    },

    {
      name: 'Capacity & Capex',
      chartType: 'line',
      metrics: [
        resolve('capacity', 'Capacity (units/yr)', 'abs', s.capacity, 'disclosed', auditedSrc,
          { naReason: 'Not stated that year.' }),
        resolve('capacityUtilisation', 'Capacity Utilisation %', 'pp', s.capacityUtilisation, 'derived', auditedSrc,
          { naReason: 'Needs capacity + volume.', note: 'Volume ÷ capacity.' }),
        resolve('capex', 'Capex (₹ Cr)', 'abs', s.capex, 'audited', auditedSrc, { naReason: pendingReason }),
      ],
      sourceFootnote: isPopulated ? 'Source: Annual reports' : pendingReason,
    },

    {
      name: 'Market Share',
      chartType: 'line',
      metrics: [
        resolve('marketShare', `Market Share % (2W)`, 'pp', mktShareSeries, 'approximate', 'Vahan · FADA',
          { naReason: 'Not available.', note: 'Approximate.' }),
        PAID('75–110CC Market Share',  'pp', 'ms_75_110'),
        PAID('110–125CC Market Share', 'pp', 'ms_110_125'),
        PAID('125–150CC Market Share', 'pp', 'ms_125_150'),
        PAID('150–200CC Market Share', 'pp', 'ms_150_200'),
        PAID('200–250CC Market Share', 'pp', 'ms_200_250'),
        PAID('250–350CC Market Share', 'pp', 'ms_250_350'),
        PAID('>350CC Market Share',    'pp', 'ms_350_plus'),
      ],
      sourceFootnote: 'Source: Vahan retail. CC-slab splits: licensed data (SIAM / JATO).',
    },

    {
      name: 'Volume Mix',
      chartType: 'line',
      metrics: [
        NA('Export Volume %',     'pp', NA_REASONS.mixHist, 'exportVolume'),
        resolve('evVolume',         'EV Volume %',          'pp', s.evShare,          'audited', auditedSrc, { naReason: pendingReason }),
        resolve('motorcycleVolume', 'Motorcycle Volume %',  'pp', s.motorcycleMix,    'audited', auditedSrc, { naReason: pendingReason }),
        resolve('scooterVolume',    'Scooter Volume %',     'pp', s.scooterMix,       'audited', auditedSrc, { naReason: pendingReason }),
        resolve('mopedVolume',      'Moped Volume %',       'pp', s.mopedMix,         'audited', auditedSrc, { naReason: pendingReason }),
        resolve('threeWheelerVolume', 'Three-Wheeler Volume %', 'pp', s.threeWheelerMix, 'audited', auditedSrc, { naReason: pendingReason }),
        PAID('75–110CC Volume',  'abs', 'v_75_110'),
        PAID('110–125CC Volume', 'abs', 'v_110_125'),
        PAID('125–150CC Volume', 'abs', 'v_125_150'),
        PAID('150–200CC Volume', 'abs', 'v_150_200'),
        PAID('200–250CC Volume', 'abs', 'v_200_250'),
        PAID('250–350CC Volume', 'abs', 'v_250_350'),
        PAID('>350CC Volume',    'abs', 'v_350_plus'),
      ],
      sourceFootnote: isPopulated ? 'Source: Annual reports · Vahan. CC-slab splits: licensed (SIAM / JATO).' : pendingReason,
    },

    // 'Revenue Mix' group removed — segment-level revenue split (EV / motorcycle
    // / export revenue %) is not disclosed by any OEM and not available even from
    // paid sources, so it would always be empty.

    // NOTE: 'Company Profile' group intentionally removed from this dropdown.
    // KMP / dealers / employees / credit rating / manufacturing all live on
    // the Governance & Network card directly on the main page now, so
    // duplicating them inside Supporting Data was pure clutter.
  ]

  return groups
}

// ----------------------------------------------------------------------------
// Same helpers as supportingTvs (kept here so other companies don't need to
// import the TVS-specific module).
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

export function getSupportingData(group) {
  return group.metrics.map((m) => {
    const fy24 = m.series?.[fy24Idx]
    const fy25 = m.series?.[fy25Idx]
    const change = (typeof fy24 === 'number' && typeof fy25 === 'number') ? Number((fy25 - fy24).toFixed(2)) : null
    const read = m.unavailable ? 'Neutral' : getMetricRead(fy25, fy24, m.fmt)
    return { ...m, fy24, fy25, change, read }
  })
}

export function getSupportingChartData(group) {
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

export function normalizeMixTo100(rows) {
  const sum = rows.reduce((a, b) => a + (typeof b.value === 'number' ? b.value : 0), 0)
  if (sum === 0) return rows.map((r) => ({ ...r, percent: 0 }))
  const out = rows.map((r) => ({ ...r, percent: (r.value / sum) * 100 }))
  const total = out.reduce((a, b) => a + b.percent, 0)
  if (total < 99.5) {
    out.push({ name: 'Unclassified', value: null, percent: 100 - total, isUnclassified: true })
  }
  return out
}
