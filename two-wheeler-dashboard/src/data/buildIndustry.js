// Builds the 'Industry' aggregate company object from per-data-source JSONs.
// Each JSON carries its own source citation; this module is a pure mapper.

import { FY, latestPopulatedIdx } from './_fy.js'
import volumeGrowth from './industry/2w-domestic-volume-growth.json'
import segmentMix from './industry/2w-segment-mix.json'
import evShare from './industry/2w-ev-share.json'
import exports2W from './industry/2w-exports.json'
import marketShare from './industry/2w-market-share.json'

const alignByFy = (fyMap) => FY.map((fy) => (typeof fyMap?.[fy] === 'number' ? fyMap[fy] : null))

const fmtPct = (v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : null)
const fmtPctSigned = (v) => (typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : null)
const fmtPpSigned  = (v) => (typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp` : null)
const fmtUnitsL    = (n) => (typeof n === 'number' ? `${(n / 100000).toFixed(2)} L` : null)

const tone = (d) => (typeof d !== 'number' ? 'flat' : d > 1 ? 'pos' : d < -1 ? 'neg' : 'flat')
const read = (d) => (typeof d !== 'number' ? 'Neutral' : d > 1 ? 'Positive' : d < -1 ? 'Negative' : 'Neutral')

const buildBlock = (columns, fy24, fy25, fmt) => {
  const change = fy25.map((v, i) =>
    typeof fy24[i] === 'number' && typeof v === 'number' ? Number((v - fy24[i]).toFixed(2)) : null,
  )
  const readRow = change.map((c) => (c === null ? 'Neutral' : read(c)))
  return { columns, fy24, fy25, change, read: readRow, fmt }
}

export function buildIndustry(opts = {}) {
  const fy24Idx = FY.indexOf('FY24')
  const fy25Idx = FY.indexOf('FY25')

  // ---- Volume + growth ----
  const totalVolumeByFy = volumeGrowth.underlyingVolumesUnits || {}
  const volumeUnits = FY.map((fy) => (typeof totalVolumeByFy[fy] === 'number' ? totalVolumeByFy[fy] : null))
  const volumeGrowthSeries = alignByFy(volumeGrowth.series)

  // ---- EV share ----
  const evSeries = alignByFy(evShare.series)

  // ---- Exports ----
  const exportVolumes = alignByFy(exports2W.underlyingVolumesUnits || {})
  const exportGrowth = alignByFy(exports2W.growthSeries)
  const exportMixSeries = FY.map((fy, i) => {
    const dom = volumeUnits[i]
    const exp = exportVolumes[i]
    if (typeof dom !== 'number' || typeof exp !== 'number') return null
    return Number(((exp / (dom + exp)) * 100).toFixed(1))
  })

  // ---- Segment mix ----
  const motorcyclesShare = alignByFy(segmentMix.series?.Motorcycles)
  const scootersShare    = alignByFy(segmentMix.series?.Scooters)
  const mopedsShare      = alignByFy(segmentMix.series?.Mopeds)

  // ---- Market share top OEMs ----
  const heroShare    = alignByFy(marketShare.series?.['Hero MotoCorp'])
  const honda        = alignByFy(marketShare.series?.['Honda HMSI'])
  const tvsShare     = alignByFy(marketShare.series?.TVS)
  const bajajShare   = alignByFy(marketShare.series?.['Bajaj Auto'])
  const enfieldShare = alignByFy(marketShare.series?.['Royal Enfield'])
  const suzukiShare  = alignByFy(marketShare.series?.Suzuki)
  const olaShare     = alignByFy(marketShare.series?.['Ola Electric'])

  // Latest reported FY for the industry aggregates, floored at FY25 so the
  // view only ever advances. Today Vahan/FADA volumes end FY25, so this
  // resolves to FY25; it moves to FY26 on its own once the aggregates
  // carry it. (v25/v24 names kept for continuity — they read current/prior.)
  const latestIdx = latestPopulatedIdx([volumeUnits, volumeGrowthSeries, evSeries, exportVolumes])
  const prevIdx   = latestIdx - 1
  const latestFy  = FY[latestIdx]
  const v25 = (s) => s[latestIdx]
  const v24 = (s) => (prevIdx >= 0 ? s[prevIdx] : null)

  // ---- KPI tiles ----
  const kpis = [
    {
      key: 'volGrowth',
      label: 'Volume Growth %',
      value: fmtPctSigned(v25(volumeGrowthSeries)),
      sub: 'FY25 domestic YoY',
      delta: fmtPpSigned(typeof v25(volumeGrowthSeries) === 'number' && typeof v24(volumeGrowthSeries) === 'number' ? v25(volumeGrowthSeries) - v24(volumeGrowthSeries) : null),
      tone: tone(typeof v25(volumeGrowthSeries) === 'number' && typeof v24(volumeGrowthSeries) === 'number' ? v25(volumeGrowthSeries) - v24(volumeGrowthSeries) : null),
      fmt: 'pp',
      series: volumeGrowthSeries,
      source: volumeGrowth.source,
    },
    {
      key: 'totalVolume',
      label: 'Domestic Volume',
      value: fmtUnitsL(v25(volumeUnits)),
      sub: 'FY25 units',
      delta: fmtPctSigned(typeof v25(volumeUnits) === 'number' && typeof v24(volumeUnits) === 'number' && v24(volumeUnits) ? ((v25(volumeUnits) - v24(volumeUnits)) / v24(volumeUnits)) * 100 : null),
      tone: tone(v25(volumeGrowthSeries)),
      fmt: 'pct',
      series: volumeUnits.map((v) => (typeof v === 'number' ? v / 100000 : null)),
      source: volumeGrowth.source,
    },
    {
      key: 'exportMix',
      label: 'Export Mix %',
      value: fmtPct(v25(exportMixSeries)),
      sub: 'FY25 of total',
      delta: fmtPpSigned(typeof v25(exportMixSeries) === 'number' && typeof v24(exportMixSeries) === 'number' ? v25(exportMixSeries) - v24(exportMixSeries) : null),
      tone: tone(typeof v25(exportMixSeries) === 'number' && typeof v24(exportMixSeries) === 'number' ? v25(exportMixSeries) - v24(exportMixSeries) : null),
      fmt: 'pp',
      series: exportMixSeries,
      source: exports2W.source,
    },
    {
      key: 'evMix',
      label: 'EV Mix %',
      value: fmtPct(v25(evSeries)),
      sub: 'FY25 of 2W',
      delta: fmtPpSigned(typeof v25(evSeries) === 'number' && typeof v24(evSeries) === 'number' ? v25(evSeries) - v24(evSeries) : null),
      tone: tone(typeof v25(evSeries) === 'number' && typeof v24(evSeries) === 'number' ? v25(evSeries) - v24(evSeries) : null),
      fmt: 'pp',
      series: evSeries,
      source: evShare.source,
    },
    {
      key: 'scooterMix',
      label: 'Scooter Mix %',
      value: fmtPct(v25(scootersShare)),
      sub: 'FY25 of 2W',
      delta: fmtPpSigned(typeof v25(scootersShare) === 'number' && typeof v24(scootersShare) === 'number' ? v25(scootersShare) - v24(scootersShare) : null),
      tone: tone(typeof v25(scootersShare) === 'number' && typeof v24(scootersShare) === 'number' ? v25(scootersShare) - v24(scootersShare) : null),
      fmt: 'pp',
      series: scootersShare,
      source: segmentMix.source,
    },
    {
      key: 'top3',
      label: 'Top-3 OEM Share %',
      value: fmtPct(
        typeof v25(heroShare) === 'number' && typeof v25(honda) === 'number' && typeof v25(tvsShare) === 'number'
          ? v25(heroShare) + v25(honda) + v25(tvsShare)
          : null,
      ),
      sub: 'Hero · Honda · TVS · FY25',
      delta: null,
      tone: 'flat',
      fmt: 'pp',
      series: FY.map((fy, i) => {
        const h = heroShare[i]; const ho = honda[i]; const t = tvsShare[i]
        return typeof h === 'number' && typeof ho === 'number' && typeof t === 'number' ? Number((h + ho + t).toFixed(1)) : null
      }),
      source: marketShare.source,
    },
  ]

  // ---- Performance: growth (industry only, no benchmark) + segment mix bars ----
  const performance = {
    growth: {
      oem:      volumeGrowthSeries,
      industry: volumeGrowthSeries.slice(),  // same series — industry view
    },
    mix: [],
    mixRich: {
      totalByFy: Object.fromEntries(FY.map((fy, i) => [fy, volumeUnits[i]])),
      productByFy: Object.fromEntries(
        FY.map((fy, i) => {
          const total = volumeUnits[i]
          if (typeof total !== 'number') return [fy, null]
          const m = motorcyclesShare[i]
          const s = scootersShare[i]
          const mo = mopedsShare[i]
          if ([m, s, mo].every((v) => typeof v !== 'number')) return [fy, null]
          const segs = []
          if (typeof m === 'number')  segs.push({ name: 'Motorcycles',  volume: Math.round(total * m / 100),  color: '#2563EB' })
          if (typeof s === 'number')  segs.push({ name: 'Scooters',     volume: Math.round(total * s / 100),  color: '#0EA5E9' })
          if (typeof mo === 'number') segs.push({ name: 'Mopeds',       volume: Math.round(total * mo / 100), color: '#10B981' })
          return [fy, segs]
        }).filter(([, v]) => v),
      ),
      powertrainByFy: Object.fromEntries(
        FY.map((fy, i) => {
          const total = volumeUnits[i]
          const ev = evSeries[i]
          if (typeof total !== 'number' || typeof ev !== 'number') return [fy, null]
          const evUnits = Math.round(total * ev / 100)
          const iceUnits = total - evUnits
          return [fy, [
            { name: 'ICE', volume: iceUnits, color: '#475569' },
            { name: 'EV',  volume: evUnits,  color: '#10B981' },
          ]]
        }).filter(([, v]) => v),
      ),
      geographyByFy: Object.fromEntries(
        FY.map((fy, i) => {
          const dom = volumeUnits[i]
          const exp = exportVolumes[i]
          if (typeof dom !== 'number' || typeof exp !== 'number') return [fy, null]
          return [fy, [
            { name: 'Domestic', volume: dom, color: '#2563EB' },
            { name: 'Exports',  volume: exp, color: '#0EA5E9' },
          ]]
        }).filter(([, v]) => v),
      ),
    },
  }

  // ---- Product-Level Drivers — segment volumes for FY25 ----
  const fy25Total = v25(volumeUnits)
  const drivers = (() => {
    const segVol = (sharePct) => (typeof sharePct === 'number' && typeof fy25Total === 'number'
      ? Math.round((sharePct / 100) * fy25Total)
      : null)
    const segGrowth = (segShareSeries) => {
      const a = v24(segShareSeries); const b = v25(segShareSeries)
      const ta = v24(volumeUnits);   const tb = v25(volumeUnits)
      if ([a, b, ta, tb].some((x) => typeof x !== 'number')) return null
      const vol24 = (a / 100) * ta
      const vol25 = (b / 100) * tb
      return vol24 ? ((vol25 - vol24) / vol24) * 100 : null
    }
    const motoVol = segVol(v25(motorcyclesShare))
    const scoVol  = segVol(v25(scootersShare))
    const mopVol  = segVol(v25(mopedsShare))
    const evVol25 = typeof fy25Total === 'number' && typeof v25(evSeries) === 'number' ? Math.round((v25(evSeries) / 100) * fy25Total) : null
    const expVol  = v25(exportVolumes)
    return [
      { name: 'Motorcycles',     segment: 'Domestic',     value: fmtUnitsL(motoVol), sub: 'FY25 units', growth: fmtPctSigned(segGrowth(motorcyclesShare)), tag: 'Gain' },
      { name: 'Scooters',        segment: 'Domestic',     value: fmtUnitsL(scoVol),  sub: 'FY25 units', growth: fmtPctSigned(segGrowth(scootersShare)),    tag: 'Gain' },
      { name: 'Mopeds',          segment: 'Domestic',     value: fmtUnitsL(mopVol),  sub: 'FY25 units', growth: fmtPctSigned(segGrowth(mopedsShare)),      tag: 'Stable' },
      { name: 'EV Two-Wheelers', segment: 'Registrations', value: fmtUnitsL(evVol25), sub: 'FY25 (Vahan)', growth: fmtPpSigned(typeof v25(evSeries) === 'number' && typeof v24(evSeries) === 'number' ? v25(evSeries) - v24(evSeries) : null), tag: 'Gain' },
      { name: 'Exports',         segment: 'All segments', value: fmtUnitsL(expVol),  sub: 'FY25 units', growth: fmtPctSigned(v25(exportGrowth)),           tag: typeof v25(exportGrowth) === 'number' && v25(exportGrowth) > 0 ? 'Gain' : 'Stable' },
      { name: 'Total 2W',        segment: 'Domestic',     value: fmtUnitsL(fy25Total), sub: 'FY25 units', growth: fmtPctSigned(v25(volumeGrowthSeries)),    tag: 'Gain' },
    ].map((d) => (d.value === null ? { ...d, value: '—', tag: 'Pending' } : d))
  })()

  // ---- Supporting Data blocks ----
  const supporting = {
    Growth: buildBlock(
      ['Volume Growth %', 'Export Growth %'],
      [v24(volumeGrowthSeries), v24(exportGrowth)],
      [v25(volumeGrowthSeries), v25(exportGrowth)],
      ['pp', 'pp'],
    ),
    Margins: buildBlock(['Gross Margin %', 'EBITDA Margin %'], [null, null], [null, null], ['pp', 'pp']),
    'Balance Sheet': buildBlock(['Net Debt / Equity', 'ROCE %', 'WC Days'], [null, null, null], [null, null, null], ['abs', 'pp', 'abs']),
    'Cash Flow': buildBlock(['OCF (₹ Cr)', 'FCF (₹ Cr)', 'Capex (₹ Cr)'], [null, null, null], [null, null, null], ['pct', 'pct', 'pct']),
    'Product Mix': buildBlock(
      ['Motorcycles %', 'Scooters %', 'Mopeds %', 'EV %'],
      [v24(motorcyclesShare), v24(scootersShare), v24(mopedsShare), v24(evSeries)],
      [v25(motorcyclesShare), v25(scootersShare), v25(mopedsShare), v25(evSeries)],
      ['pp', 'pp', 'pp', 'pp'],
    ),
    'Market Share': buildBlock(
      ['Hero %', 'Honda %', 'TVS %', 'Bajaj %', 'Royal Enfield %', 'Ola %'],
      [v24(heroShare), v24(honda), v24(tvsShare), v24(bajajShare), v24(enfieldShare), v24(olaShare)],
      [v25(heroShare), v25(honda), v25(tvsShare), v25(bajajShare), v25(enfieldShare), v25(olaShare)],
      ['pp', 'pp', 'pp', 'pp', 'pp', 'pp'],
    ),
  }

  // ---- Chart series ----
  const C_DARK = '#1f2937', C_BLUE = '#3b82f6', C_GREEN = '#10b981', C_AMBER = '#f59e0b', C_RED = '#dc2626', C_INDIGO = '#4f46e5'
  const charts = {
    Growth: [
      { name: 'Volume Growth %', color: C_DARK, values: volumeGrowthSeries },
      { name: 'Export Growth %', color: C_BLUE, values: exportGrowth },
    ],
    Margins: [
      { name: 'Industry-wide margin series — not aggregated centrally', color: C_DARK, values: new Array(FY.length).fill(null) },
    ],
    'Balance Sheet': [
      { name: 'Industry-wide balance-sheet series — not aggregated centrally', color: C_DARK, values: new Array(FY.length).fill(null) },
    ],
    'Cash Flow': [
      { name: 'Industry-wide cash-flow series — not aggregated centrally', color: C_DARK, values: new Array(FY.length).fill(null) },
    ],
    'Product Mix': [
      { name: 'Motorcycles %', color: C_DARK,  values: motorcyclesShare },
      { name: 'Scooters %',    color: C_BLUE,  values: scootersShare },
      { name: 'Mopeds %',      color: C_GREEN, values: mopedsShare },
      { name: 'EV %',          color: C_AMBER, values: evSeries },
    ],
    'Market Share': [
      { name: 'Hero %',           color: C_RED,    values: heroShare },
      { name: 'Honda %',          color: C_DARK,   values: honda },
      { name: 'TVS %',            color: C_BLUE,   values: tvsShare },
      { name: 'Bajaj %',          color: C_INDIGO, values: bajajShare },
      { name: 'Royal Enfield %',  color: '#b45309', values: enfieldShare },
      { name: 'Ola %',            color: C_GREEN,  values: olaShare },
    ],
  }

  return {
    id: 'industry',
    name: 'Industry',
    publicName: 'Industry',
    shortName: '2W Industry',
    brandText: '2W INDUSTRY',
    brandColor: '#6D28D9',
    dotColor: '#6b7280',
    signal: 'Neutral',
    updated: volumeGrowth.lastUpdated || '—',
    dataFresh: 'Live',
    hero: {
      title: 'Indian Two-Wheeler Industry Cockpit',
      subtitle: 'Two-wheeler industry snapshot',
      fy: latestFy,
    },
    latestFy,
    kpis,
    performance,
    productDrivers: drivers,
    supportingData: supporting,
    charts,
    modelSource: 'Source: SIAM · Vahan',
    sourceCitations: {
      'Total 2W volume / growth':  volumeGrowth.source,
      'Segment mix (M / S / Mo)':  segmentMix.source,
      'EV share':                  evShare.source,
      'Exports':                   exports2W.source,
      'OEM market share':          marketShare.source,
    },
    ...opts,
  }
}
