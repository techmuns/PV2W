// Performance-section helpers.
// Pure functions over the company shape produced by buildFromActuals + the
// industry JSON. Used only by PerformanceSection.jsx — no other consumers.

import { FY } from './_fy.js'
import industryGrowth from './industry/2w-domestic-volume-growth.json'

const UNCLASSIFIED_COLOR = '#CBD5E1'

// Returns a series of industry growth % aligned to the dashboard FY axis.
// Missing years are null (rendered as gaps, never fake zero).
export function getIndustryGrowthSeries() {
  return FY.map((fy) => industryGrowth.series?.[fy] ?? null)
}

export function getIndustryMeta() {
  return {
    source: industryGrowth.source,
    sourceUrl: industryGrowth.sourceUrl,
    lastUpdated: industryGrowth.lastUpdated,
    forecastYears: industryGrowth.forecastYears || [],
    hasData: FY.some((fy) => typeof industryGrowth.series?.[fy] === 'number'),
  }
}

// Build a row-per-FY dataset for the left "growth vs industry" chart.
// shortName goes in as the OEM series key so the chart legend reads naturally.
export function getTvsGrowthVsIndustry(oemSeries, shortName) {
  const industry = getIndustryGrowthSeries()
  const meta = getIndustryMeta()
  const startIdx = FY.indexOf('FY18')
  return FY.slice(startIdx).map((fy, i) => ({
    fy,
    [shortName]: oemSeries?.[startIdx + i] ?? null,
    Industry: industry[startIdx + i],
    isForecast: meta.forecastYears.includes(fy),
  }))
}

// Allocate residual share to 'Unclassified' so segments sum to exactly 100%.
// IMPORTANT: if zero segments are disclosed for a year, return an empty array
// — the chart then renders no bar for that year, which is honest. A full-
// height 'Unclassified' bar would look like data when it isn't.
export function normalizeMixTo100(segments, total) {
  if (!total) return []
  if (!segments?.length) return []   // nothing disclosed → no bar
  const known = segments.reduce((acc, s) => acc + (typeof s.volume === 'number' ? s.volume : 0), 0)
  const remaining = Math.max(0, total - known)
  const out = segments.map((s) => ({
    ...s,
    percent: total > 0 ? (s.volume / total) * 100 : 0,
  }))
  if (remaining > 0.5 && known > 0) {
    out.push({
      name: 'Unclassified',
      volume: remaining,
      color: UNCLASSIFIED_COLOR,
      percent: total > 0 ? (remaining / total) * 100 : 0,
      isUnclassified: true,
    })
  }
  // Validation: sum must not exceed 100% by more than rounding tolerance.
  const sum = out.reduce((a, b) => a + b.percent, 0)
  if (sum > 100.5) {
    // eslint-disable-next-line no-console
    console.warn(
      `[normalizeMixTo100] Segments sum to ${sum.toFixed(2)}% — > 100%. Refusing to silently normalize. ` +
      `Segments: ${out.map((s) => `${s.name}=${s.percent.toFixed(1)}%`).join(', ')}`
    )
    return out
  }
  // Rounding correction so disclosed bars sum exactly to 100.
  if (sum !== 100 && out.length) {
    out[out.length - 1].percent += (100 - sum)
  }
  return out
}

// Map dashboard mix-type key → dataStatus block key.
const MIX_STATUS_KEY = {
  product:    'productMix',
  powertrain: 'powertrainMix',
  geography:  'domesticExportMix',
}

// Resolve the per-FY mix for a given mixType.
// Returns: { fy, total, segments[], status }
export function getTvsVolumeMix(company, fy, mixType) {
  const mix = company.performance?.mixRich || company.performance?.mix
  const total = mix?.totalByFy?.[fy] ?? null
  const status = mix?.dataStatus?.[MIX_STATUS_KEY[mixType]]?.[fy] || null

  if (!total) return { fy, total: null, segments: [], status: status || 'unavailable' }

  const key = (
    mixType === 'product'    ? 'productByFy' :
    mixType === 'powertrain' ? 'powertrainByFy' :
                                'geographyByFy'
  )
  const segments = mix?.[key]?.[fy]
  return { fy, total, segments: normalizeMixTo100(segments, total), status }
}

// Bucket statuses for the coverage banner.
export const STATUS_BUCKETS = {
  available:                  { label: 'Available',                   tone: { bg: '#E1F0E2', fg: '#1F5C28', border: '#A8D8AE' } },
  available_residual:         { label: 'Available (residual)',        tone: { bg: '#E1F0E2', fg: '#1F5C28', border: '#A8D8AE' } },
  derived:                    { label: 'Derived',                     tone: { bg: '#DBEAFE', fg: '#1E40AF', border: '#93B4F4' } },
  pending_pdf_parse:          { label: 'Pending PDF parse',           tone: { bg: '#FBEFDC', fg: '#7C3A07', border: '#F5C97A' } },
  pending_pdf_parse_explicit: { label: 'Pending PDF parse (explicit)', tone: { bg: '#FBEFDC', fg: '#7C3A07', border: '#F5C97A' } },
  pending_pdf_parse_residual: { label: 'Pending PDF parse (residual)', tone: { bg: '#FBEFDC', fg: '#7C3A07', border: '#F5C97A' } },
  unavailable:                { label: 'Unavailable',                 tone: { bg: '#EEF1F5', fg: '#475569', border: '#CBD5E1' } },
  unavailable_pre_ev:         { label: 'N/A (pre-EV)',                tone: { bg: '#EEF1F5', fg: '#475569', border: '#CBD5E1' } },
  unavailable_minimal_ev:     { label: 'N/A (minimal EV)',            tone: { bg: '#EEF1F5', fg: '#475569', border: '#CBD5E1' } },
  paid_source_required:       { label: 'Paid source required',        tone: { bg: '#EFE9FE', fg: '#5B21B6', border: '#C4B5FD' } },
}

export function statusBucket(status) {
  return STATUS_BUCKETS[status] || STATUS_BUCKETS.unavailable
}

// Roll up rows for the coverage banner: [{status, fys: ['FY25', 'FY24', ...]}, ...]
export function buckedRowsByStatus(rows) {
  const map = new Map()
  rows.forEach((r) => {
    const s = r.status || 'unavailable'
    if (!map.has(s)) map.set(s, [])
    map.get(s).push(r.fy)
  })
  // Ordered: available first, then pending, then unavailable, then paid
  const order = ['available', 'available_residual', 'derived',
                 'pending_pdf_parse', 'pending_pdf_parse_explicit', 'pending_pdf_parse_residual',
                 'unavailable', 'unavailable_pre_ev', 'unavailable_minimal_ev',
                 'paid_source_required']
  return order
    .filter((s) => map.has(s))
    .map((s) => ({ status: s, fys: map.get(s) }))
}

// Per-mix-type source legend lookup from the JSON's statusLegend block.
export function getStatusReason(company, status) {
  const legend = company.performance?.mixRich?.dataStatus?.statusLegend
  return legend?.[status] || null
}

// Short source label for the mix charts.
export function getMixSource() {
  return 'Source: Annual reports · Vahan'
}

// Volume growth YoY between two FYs, given the per-FY total map. Returns null
// if either side is missing.
export function yoyForSegment(byFy, fy, fyMinus1, segmentName) {
  const a = byFy?.[fyMinus1]?.find((s) => s.name === segmentName)?.volume
  const b = byFy?.[fy]?.find((s) => s.name === segmentName)?.volume
  if (typeof a !== 'number' || typeof b !== 'number' || a === 0) return null
  return ((b - a) / a) * 100
}
