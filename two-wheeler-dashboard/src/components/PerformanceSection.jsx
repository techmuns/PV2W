import React, { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell, ReferenceLine, LabelList,
} from 'recharts'
import { FY } from '../data.js'
import { MixTooltip as SharedMixTooltip, LineTooltip, TOOLTIP_WRAPPER_STYLE } from './ChartTooltip.jsx'
import {
  getTvsGrowthVsIndustry,
  getTvsVolumeMix,
  getIndustryMeta,
  getMixSource,
  yoyForSegment,
  buckedRowsByStatus,
  statusBucket,
  getStatusReason,
} from '../data/performance.js'

const AXIS_TICK = { fontSize: 10.5, fill: '#64748B' }
const GRID = '#F1F5F9'

const MIX_TYPES = [
  { key: 'product',    label: 'Product Mix' },
  { key: 'powertrain', label: 'Powertrain Mix' },
  { key: 'geography',  label: 'Domestic / Export' },
]

const fmtUnitsL = (n) =>
  typeof n === 'number' ? `${(n / 100000).toFixed(2)} L` : '—'

const fmtPct = (v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : '—')
const fmtPctSigned = (v) =>
  typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—'

// ============================================================================
// LEFT: Growth vs Industry (grouped bars)
// ============================================================================
function GrowthChart({ rows, oemKey }) {
  const forecastSet = useMemo(
    () => new Set(rows.filter((r) => r.isForecast).map((r) => r.fy)),
    [rows],
  )
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="fy" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={42} tickFormatter={(v) => `${v}%`} />
        <ReferenceLine y={0} stroke="#CBD5E1" strokeWidth={1} />
        <Tooltip
          content={<LineTooltip unit="%" />}
          wrapperStyle={TOOLTIP_WRAPPER_STYLE}
          allowEscapeViewBox={{ x: false, y: false }}
          offset={14}
          cursor={{ fill: 'rgba(109, 40, 217, 0.05)' }}
        />
        <Bar dataKey="Industry" fill="#CBD5E1" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={`ind-${r.fy}`} fill={r.isForecast ? '#E2E8F0' : '#CBD5E1'} fillOpacity={r.isForecast ? 0.7 : 1} />
          ))}
        </Bar>
        <Bar dataKey={oemKey} fill="#2563EB" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={`oem-${r.fy}`} fill={r.isForecast ? '#93B4F4' : '#2563EB'} fillOpacity={r.isForecast ? 0.8 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ============================================================================
// RIGHT: Volume Mix (stacked 100% bars with internal toggles)
// ============================================================================
function MixChart({ rows, segmentNames, segmentColors, onHoverFy }) {
  // Maruti-style: absolute volumes in lakh units, total label on top, 3 bars max.
  // Stacked but NOT expanded — heights reflect real volumes so YoY growth shows visually.
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        margin={{ top: 24, right: 12, left: 0, bottom: 0 }}
        barCategoryGap="30%"
        onMouseMove={(e) => e?.activeLabel && onHoverFy?.(e.activeLabel)}
        onMouseLeave={() => onHoverFy?.(null)}
      >
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="fy" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={56}
          tickFormatter={(v) => `${(v / 100000).toFixed(0)} L`}
        />
        <Tooltip
          content={<SharedMixTooltip />}
          cursor={{ fill: 'rgba(109, 40, 217, 0.05)' }}
          wrapperStyle={TOOLTIP_WRAPPER_STYLE}
          allowEscapeViewBox={{ x: false, y: false }}
          offset={14}
        />
        {segmentNames.map((name, idx) => {
          const isTop = idx === segmentNames.length - 1
          return (
            <Bar
              key={name}
              dataKey={name}
              stackId="mix"
              fill={segmentColors[name] || '#CBD5E1'}
              radius={isTop ? [4, 4, 0, 0] : 0}
              isAnimationActive={true}
              animationDuration={220}
            >
              {isTop && (
                <LabelList
                  dataKey="__total"
                  position="top"
                  formatter={(v) => (typeof v === 'number' ? `${(v / 100000).toFixed(2)} L` : '')}
                  style={{ fill: '#0F1B2D', fontSize: 11.5, fontWeight: 700 }}
                />
              )}
            </Bar>
          )
        })}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ============================================================================
// Coverage drawer — per-FY status + source, opens on demand
// ============================================================================
function CoverageDrawer({ company, mixType, mixRowsRaw, onClose }) {
  const sourcesKey = mixType === 'product' ? 'productMix' : mixType === 'powertrain' ? 'ev' : 'exports'
  const sourceMap = company.performance?.mixRich?.sourcesByFy?.[sourcesKey] || {}
  const lastUpdated = company.updated || '—'

  const buckets = buckedRowsByStatus(mixRowsRaw)

  return (
    <div className="border-t border-[#E8EDF3] bg-[#FAFBFE] px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10.5px] tracking-wider uppercase text-[#6B7280] font-semibold">Data coverage</div>
          <div className="text-[12.5px] text-[#0F1B2D] font-semibold mt-0.5">
            {mixType === 'product' && 'Product Mix'}
            {mixType === 'powertrain' && 'Powertrain Mix'}
            {mixType === 'geography' && 'Domestic / Export'}
            <span className="text-[#94A3B8] font-normal"> · last updated {lastUpdated}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-[#6B7280] hover:text-[#0F1B2D] text-lg leading-none p-1">×</button>
      </div>

      {/* Bucket summary */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {buckets.map(({ status, fys }) => {
          const b = statusBucket(status)
          return (
            <span
              key={status}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-semibold"
              style={{ background: b.tone.bg, color: b.tone.fg, border: `1px solid ${b.tone.border}` }}
            >
              {b.label} <span className="font-normal opacity-75">· {fys.length}</span>
            </span>
          )
        })}
      </div>

      {/* Per-FY table */}
      <div className="rounded-lg border border-[#E5EAF1] bg-white overflow-hidden">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="bg-[#F4F6FA]">
              <th className="text-left font-semibold uppercase tracking-wider text-[10px] text-[#6B7280] py-2 px-3">FY</th>
              <th className="text-left font-semibold uppercase tracking-wider text-[10px] text-[#6B7280] py-2 px-3">Status</th>
              <th className="text-left font-semibold uppercase tracking-wider text-[10px] text-[#6B7280] py-2 px-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {mixRowsRaw.map((r) => {
              const b = statusBucket(r.status || 'unavailable')
              const reason = getStatusReason(company, r.status || 'unavailable')
              const src = sourceMap[r.fy] || (r.segments.length > 0 ? 'TVS standalone disclosures' : '—')
              return (
                <tr key={r.fy} className="border-t border-[#F1F5F9] align-top">
                  <td className="py-2 px-3 font-semibold text-[#0F1B2D] tabular-nums">{r.fy}</td>
                  <td className="py-2 px-3">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-semibold"
                      style={{ background: b.tone.bg, color: b.tone.fg, border: `1px solid ${b.tone.border}` }}
                    >
                      {b.label}
                    </span>
                    {reason && (
                      <div className="text-[10.5px] text-[#6B7280] mt-1 leading-snug">{reason}</div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-[#475569] leading-snug">{src}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ============================================================================
// SECTION
// ============================================================================
export default function PerformanceSection({ company }) {
  const performance = company.performance
  if (!performance) return null

  const [mixType, setMixType] = useState('product')
  const [hoveredFy, setHoveredFy] = useState(null)
  const [coverageOpen, setCoverageOpen] = useState(false)

  const oemKey = company.shortName || company.name
  const industryMeta = getIndustryMeta()

  // ---- Left chart data ----
  const growthRows = useMemo(
    () => getTvsGrowthVsIndustry(performance.growth?.oem, oemKey),
    [performance.growth?.oem, oemKey],
  )
  const growthHasOem = growthRows.some((r) => typeof r[oemKey] === 'number')

  // ---- Right chart data ----
  // Full axis FY18..FY25 — used by the Coverage drawer to show every FY's status.
  const fullMixFyAxis = useMemo(() => {
    const start = FY.indexOf('FY18')
    return FY.slice(start, FY.indexOf('FY25') + 1)
  }, [])

  const fullMixRowsRaw = useMemo(
    () => fullMixFyAxis.map((fy) => getTvsVolumeMix(company, fy, mixType)),
    [company, mixType, fullMixFyAxis],
  )

  // Main chart: show only the latest verified FYs (Maruti style). 3 max.
  // Verified = the row carries actual disclosed segments (not just an
  // Unclassified placeholder, not empty).
  const isVerifiedStatus = (s) =>
    s === 'available' || s === 'available_residual' || s === 'derived'

  const verifiedRows = useMemo(
    () => fullMixRowsRaw.filter(
      (r) => r.segments.length > 0 && isVerifiedStatus(r.status),
    ),
    [fullMixRowsRaw],
  )

  const mixRowsRaw = useMemo(() => verifiedRows.slice(-3), [verifiedRows])
  const mixFyAxis  = useMemo(() => mixRowsRaw.map((r) => r.fy),  [mixRowsRaw])

  // Collect union of segment names across rows so each becomes its own <Bar/>.
  const segmentNames = useMemo(() => {
    const names = []
    mixRowsRaw.forEach((r) => {
      r.segments.forEach((s) => {
        if (!names.includes(s.name)) names.push(s.name)
      })
    })
    // Push 'Unclassified' to the end so it stacks on top.
    const u = names.indexOf('Unclassified')
    if (u > -1) {
      names.splice(u, 1)
      names.push('Unclassified')
    }
    return names
  }, [mixRowsRaw])

  const segmentColors = useMemo(() => {
    const colors = {}
    mixRowsRaw.forEach((r) =>
      r.segments.forEach((s) => {
        if (!colors[s.name]) colors[s.name] = s.color
      }),
    )
    return colors
  }, [mixRowsRaw])

  // Build chart rows: one per FY, keys = segmentNames mapped to raw volume.
  // Plus __total and __yoy for the tooltip.
  const previousMix = useMemo(() => {
    const byMixType = (
      mixType === 'product' ? company.performance?.mixRich?.productByFy :
      mixType === 'powertrain' ? company.performance?.mixRich?.powertrainByFy :
      company.performance?.mixRich?.geographyByFy
    ) || {}
    return byMixType
  }, [company.performance?.mixRich, mixType])

  const chartRows = useMemo(() => {
    return mixRowsRaw.map((r, idx) => {
      const row = { fy: r.fy, __total: r.total }
      // Years with no disclosed segments leave all keys absent — Recharts
      // renders no bar for them, so empty space = honest 'not disclosed'.
      segmentNames.forEach((n) => { row[n] = null })
      r.segments.forEach((s) => { row[s.name] = s.volume })
      // YoY change per segment (vs previous FY in this rolling axis).
      const prevFy = idx > 0 ? mixRowsRaw[idx - 1].fy : null
      if (prevFy) {
        row.__yoy = {}
        segmentNames.forEach((n) => {
          const yoy = yoyForSegment(previousMix, r.fy, prevFy, n)
          if (typeof yoy === 'number') row.__yoy[n] = yoy
        })
      }
      return row
    })
  }, [mixRowsRaw, segmentNames, previousMix])

  // Coverage breakdown by dataStatus (available / pending PDF / unavailable / paid).
  const statusBuckets = useMemo(() => buckedRowsByStatus(mixRowsRaw), [mixRowsRaw])
  const disclosedFyCount = mixRowsRaw.filter((r) => r.segments.length > 0).length

  // ---- Selected-FY meta ----
  const lastVerifiedFy = mixRowsRaw.length ? mixRowsRaw[mixRowsRaw.length - 1].fy : 'FY25'
  const activeFy = hoveredFy || lastVerifiedFy

  // Use the full per-FY map so YoY can reach back to a FY that isn't on the chart.
  const fullByFy = useMemo(
    () => Object.fromEntries(fullMixRowsRaw.map((r) => [r.fy, r])),
    [fullMixRowsRaw],
  )
  const activeTotal = fullByFy[activeFy]?.total
  const prevFyOfActive = FY[FY.indexOf(activeFy) - 1]
  const prevTotal = fullByFy[prevFyOfActive]?.total
  const activeYoy =
    typeof activeTotal === 'number' && typeof prevTotal === 'number' && prevTotal > 0
      ? ((activeTotal - prevTotal) / prevTotal) * 100
      : null

  const activeMixLabel = MIX_TYPES.find((m) => m.key === mixType)?.label || ''

  // ---- Legend items for right chart (unique colors) ----
  const legendItems = segmentNames.map((n) => ({ name: n, color: segmentColors[n] || '#CBD5E1' }))

  // ---- Source footnotes ----
  const mixSource = getMixSource(company, mixType)

  return (
    <section>
      <div className="section-head">
        <span className="section-eyebrow">Performance</span>
        <span className="section-hint">Growth · Mix · Composition</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ===== Left — Growth vs Industry ===== */}
        <div className="chart-panel">
          <div className="chart-panel-head">
            <div className="chart-panel-row1">
              <div className="min-w-0">
                <div className="chart-panel-title">{oemKey} growth vs 2W industry</div>
                <div className="chart-panel-sub">Volume Growth % · FY18–FY27 · forecast lighter</div>
              </div>
              <span className="bsr-pill">%</span>
            </div>
            <div className="chart-panel-meta">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: '#2563EB' }} />
                {oemKey}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: '#CBD5E1' }} />
                2W Industry
              </span>
            </div>
          </div>
          <div className="chart-panel-body">
            <div className="chart-canvas">
              {growthHasOem ? (
                <GrowthChart rows={growthRows} oemKey={oemKey} />
              ) : (
                <PendingShell note={`Volume growth not available for ${oemKey}.`} />
              )}
            </div>
            <div className="chart-legend">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: '#2563EB' }} />
                {oemKey} volume growth %
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: '#CBD5E1' }} />
                2W industry domestic volume growth %
              </span>
            </div>
            <div className="chart-source">Source: Annual reports · Vahan · FADA</div>
          </div>
        </div>

        {/* ===== Right — Volume composition with toggles ===== */}
        <div className="chart-panel">
          <div className="chart-panel-head">
            <div className="chart-panel-row1">
              <div className="min-w-0">
                <div className="chart-panel-title">Where {oemKey}'s volume is coming from</div>
                <div className="chart-panel-sub">Total sales volume by selected mix</div>
              </div>
              <span className="bsr-pill">Mix %</span>
            </div>
            <div className="chart-panel-meta items-center" style={{ minHeight: 32 }}>
              <div className="flex gap-1 bg-[#F4F6FA] rounded-md p-0.5 border border-[#E5EAF1]">
                {MIX_TYPES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMixType(m.key)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded transition-colors ${
                      mixType === m.key
                        ? 'bg-white text-[#6D28D9] shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
                        : 'text-[#475569] hover:text-[#0F1B2D]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-[#475569] tabular-nums ml-auto">
                <span className="text-[#94A3B8]">{activeFy}</span>{' · '}
                Total <span className="text-[#0F1B2D] font-semibold">{fmtUnitsL(activeTotal)}</span>{' · '}
                YoY{' '}
                <span
                  className={`font-semibold ${
                    typeof activeYoy === 'number'
                      ? activeYoy >= 0 ? 'text-[#1F7A45]' : 'text-[#9F1F2E]'
                      : 'text-[#94A3B8]'
                  }`}
                >
                  {fmtPctSigned(activeYoy)}
                </span>{' · '}
                <span className="text-[#94A3B8]">{activeMixLabel}</span>
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <div className="text-[10.5px] text-[#6B7280] leading-snug">
                Disclosed years only.
              </div>
              <button
                type="button"
                onClick={() => setCoverageOpen((v) => !v)}
                className="shrink-0 text-[10.5px] font-semibold text-[#6D28D9] hover:text-[#4C1D95] transition-colors flex items-center gap-1 px-2 py-0.5 rounded border border-[#D8CCF7] bg-[#FAF5FF]"
              >
                Coverage
                <svg width="10" height="10" viewBox="0 0 20 20" fill="none" style={{ transform: coverageOpen ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }}>
                  <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
          <div className="chart-panel-body">
            <div className="chart-canvas">
              {mixRowsRaw.length > 0 ? (
                <MixChart
                  rows={chartRows}
                  segmentNames={segmentNames}
                  segmentColors={segmentColors}
                  onHoverFy={setHoveredFy}
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-center h-full">
                  <div className="text-[13px] font-semibold text-[#475569]">No verified years yet</div>
                  <div className="text-[11.5px] text-[#94A3B8] mt-1 max-w-[300px]">
                    Open the Coverage drawer to see which FYs are pending source verification.
                  </div>
                </div>
              )}
            </div>
            <div className="chart-legend" style={{ minHeight: 40 }}>
              {legendItems.map((s) => (
                <span key={s.name} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
            <div className="chart-source">
              {mixSource}
            </div>
          </div>
          {coverageOpen && (
            <CoverageDrawer
              company={company}
              mixType={mixType}
              mixRowsRaw={fullMixRowsRaw}
              onClose={() => setCoverageOpen(false)}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function PendingShell({ note }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 h-full">
      <div className="w-12 h-12 rounded-full bg-[#F4F7FB] border border-[#E5EAF1] flex items-center justify-center text-[#94A3B8]">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <div className="text-[13px] font-semibold text-[#475569] mt-3">Data pending</div>
      <div className="text-[11.5px] text-[#94A3B8] mt-1 max-w-[260px]">
        {note || 'Upload source data to populate this chart.'}
      </div>
    </div>
  )
}
