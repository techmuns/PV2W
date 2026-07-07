import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts'
import { FY, SUPPORT_BLOCKS } from '../data.js'
import { getSupportingData, getSupportingChartData } from '../data/supportingTvs.js'
import { LineTooltip, TOOLTIP_WRAPPER_STYLE } from './ChartTooltip.jsx'

const AXIS_TICK = { fontSize: 10.5, fill: '#64748B' }
const GRID = '#F1F5F9'

const fmtCell = (v, fmt) => {
  if (typeof v !== 'number') return v ?? '—'
  if (fmt === 'pp')  return `${v.toFixed(1)}%`
  if (fmt === 'abs') return v.toLocaleString('en-IN', { maximumFractionDigits: 1 })
  if (fmt === 'pct') return `${v.toFixed(1)}%`
  return v.toFixed(2)
}

const fmtChange = (v, fmt) => {
  if (typeof v !== 'number') return '—'
  const sign = v > 0 ? '+' : ''
  if (fmt === 'pp')  return `${sign}${v.toFixed(1)}pp`
  if (fmt === 'pct') return `${sign}${v.toFixed(1)}%`
  return `${sign}${v.toFixed(2)}`
}

const readClass = {
  Positive: 'read-pill positive',
  Negative: 'read-pill negative',
  Neutral:  'read-pill neutral',
}

// ============================================================================
// Dropdown
// ============================================================================
function Dropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-center justify-between bg-white border border-[#D8CCF7] rounded-lg px-3 py-2 text-[13px] font-semibold text-[#6D28D9] hover:border-[#6D28D9] transition-colors"
      >
        {value}
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
          <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E5EAF1] rounded-lg shadow-lg overflow-hidden z-20 max-h-[300px] overflow-y-auto">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-[13px] hover:bg-[#F4F7FB] ${
                o === value ? 'bg-[#EFEAFE] text-[#6D28D9] font-semibold' : 'text-[#334E68]'
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Right pane — chart renderers
// ============================================================================
function LineChartPanel({ series, fmt }) {
  const rows = FY.map((fy, idx) => {
    const row = { fy }
    series.forEach((s) => { row[s.name] = s.values[idx] })
    return row
  })
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="fy" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={48}
          tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)} />
        <Tooltip
          content={<LineTooltip />}
          wrapperStyle={TOOLTIP_WRAPPER_STYLE}
          allowEscapeViewBox={{ x: false, y: false }}
          offset={14}
        />
        {series.map((s) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2.25}
            dot={{ r: 2.5, fill: s.color }}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
            strokeLinecap="round"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function UnavailablePanel({ metrics, footnote }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 h-full">
      <div className="w-12 h-12 rounded-full bg-[#F4F7FB] border border-[#E5EAF1] flex items-center justify-center text-[#94A3B8]">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </svg>
      </div>
      <div className="text-[13px] font-semibold text-[#475569] mt-3">Data not disclosed</div>
      <div className="text-[11.5px] text-[#94A3B8] mt-1 max-w-[360px] leading-snug">
        {footnote || 'This metric set is not in the uploaded workbook.'}
      </div>
      {metrics?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 justify-center max-w-[420px]">
          {metrics.map((m) => (
            <span key={m.key} className="text-[10.5px] text-[#6B7280] bg-[#F4F7FB] border border-[#E5EAF1] rounded px-2 py-0.5">
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ProfileGrid({ metrics }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 h-full content-start overflow-y-auto">
      {metrics.map((m) => (
        <div key={m.key} className="border border-[#E5EAF1] rounded-lg p-3 bg-[#FAFBFE]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{m.label}</div>
          <div className="text-[13px] font-semibold text-[#475569] mt-1">
            {m.unavailable ? 'Unavailable' : (m.fy25 ?? '—')}
          </div>
          {m.unavailable && m.reason && (
            <div className="text-[10.5px] text-[#94A3B8] mt-1 leading-snug">{m.reason}</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// NEW PATH — groups dropdown (TVS only)
// ============================================================================
function GroupedSupportingData({ company }) {
  const groups = company.supportingGroups
  const [selected, setSelected] = useState(groups[0]?.name || 'Growth')
  const group = useMemo(() => groups.find((g) => g.name === selected) || groups[0], [groups, selected])

  const latestFy = company.latestFy || 'FY25'
  const prevFy = FY[Math.max(0, FY.indexOf(latestFy) - 1)] || 'FY24'
  const tableRows = useMemo(() => getSupportingData(group, latestFy), [group, latestFy])
  const chart = useMemo(() => getSupportingChartData(group), [group])

  const isProfile = group.chartType === 'profile'
  const showUnavailable = !isProfile && (chart.allUnavailable || !chart.hasAny)

  return (
    <section>
      <div className="section-head">
        <span className="section-eyebrow">Supporting Data</span>
        <span className="section-hint">Audited where disclosed</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ─── LEFT: dropdown + metric table ─── */}
        <div className="chart-panel lg:col-span-5">
          <div className="chart-panel-head">
            <div className="chart-panel-row1">
              <div className="min-w-0 flex-1">
                <div className="chart-panel-title">{group.name}</div>
                <div className="chart-panel-sub">{group.metrics.length} metric{group.metrics.length !== 1 ? 's' : ''} · {prevFy} vs {latestFy}</div>
              </div>
              <div className="w-[200px] shrink-0">
                <Dropdown
                  value={selected}
                  options={groups.map((g) => g.name)}
                  onChange={setSelected}
                />
              </div>
            </div>
          </div>

          <div className="chart-panel-body !p-0">
            <div className="max-h-[420px] overflow-y-auto">
              <table className="mtbl-transposed">
                <thead>
                  <tr>
                    <th className="metric-head" style={{ width: '50%' }}>Metric</th>
                    <th>{prevFy}</th>
                    <th>{latestFy}</th>
                    <th>Change</th>
                    <th>Read</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((m) => (
                    <tr key={m.key}>
                      <th style={{ textTransform: 'none', letterSpacing: '0.01em', fontWeight: 500, fontSize: 11, lineHeight: 1.3 }}>
                        <div className="text-[#0B1F33] font-semibold text-[11.5px]">{m.label}</div>
                        {m.unavailable && (
                          <div className="text-[10px] text-[#94A3B8] mt-0.5 leading-snug font-normal">{m.reason}</div>
                        )}
                        {m.note && !m.unavailable && (
                          <div className="text-[10px] text-[#6B7280] mt-0.5 leading-snug font-normal">{m.note}</div>
                        )}
                      </th>
                      <td className={m.unavailable ? 'text-[#CBD5E1]' : 'text-[#94A3B8]'}>{m.unavailable ? '—' : fmtCell(m.fy24, m.fmt)}</td>
                      <td className={m.unavailable ? 'text-[#CBD5E1]' : 'sel font-semibold'}>{m.unavailable ? '—' : fmtCell(m.fy25, m.fmt)}</td>
                      <td className={`font-semibold ${m.unavailable || m.change === null ? 'text-[#CBD5E1]' : m.change > 0 ? 'text-[#1F7A45]' : m.change < 0 ? 'text-[#9F1F2E]' : 'text-[#94A3B8]'}`}>
                        {m.unavailable ? '—' : fmtChange(m.change, m.fmt)}
                      </td>
                      <td>
                        {m.paid ? (
                          <span className="read-pill paid">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" style={{ marginRight: 4 }}>
                              <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" />
                            </svg>
                            Paid data
                          </span>
                        ) : m.unavailable ? (
                          <span className="read-pill watch">Unavailable</span>
                        ) : (
                          <span className={readClass[m.read] || readClass.Neutral}>{m.read}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mtbl-foot">{group.sourceFootnote}</div>
          </div>
        </div>

        {/* ─── RIGHT: chart / profile / unavailable panel ─── */}
        <div className="chart-panel lg:col-span-7 flex flex-col">
          <div className="chart-panel-head">
            <div className="chart-panel-row1">
              <div className="min-w-0">
                <div className="chart-panel-title">{group.name} — trend</div>
                <div className="chart-panel-sub">
                  {isProfile ? 'Profile' : showUnavailable ? 'Not disclosed' : `FY16–${latestFy}`}
                </div>
              </div>
              <span className="bsr-pill">{latestFy}</span>
            </div>
            <div className="chart-panel-meta">
              <span>{group.metrics.length} metrics</span>
              <span>{group.metrics.filter((m) => !m.unavailable).length} available</span>
              {group.metrics.some((m) => m.paid) && (
                <span>{group.metrics.filter((m) => m.paid).length} licensed</span>
              )}
              {group.metrics.some((m) => m.unavailable && !m.paid) && (
                <span>{group.metrics.filter((m) => m.unavailable && !m.paid).length} unavailable</span>
              )}
            </div>
          </div>

          <div className="chart-panel-body">
            <div className="chart-canvas">
              {isProfile ? (
                <ProfileGrid metrics={tableRows} />
              ) : showUnavailable ? (
                <UnavailablePanel metrics={group.metrics} footnote={group.sourceFootnote} />
              ) : (
                <LineChartPanel series={chart.series} />
              )}
            </div>

            {!isProfile && chart.hasAny && (
              <div className="chart-legend">
                {chart.series.map((s) => (
                  <span key={s.name} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
                    {s.name}
                  </span>
                ))}
              </div>
            )}
            <div className="chart-source">{group.sourceFootnote}</div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ============================================================================
// LEGACY PATH — supportingData / charts (non-TVS companies)
// ============================================================================
function LegacySupportingData({ company }) {
  const [block, setBlock] = useState('Growth')
  const data = company.supportingData?.[block]
  const series = company.charts?.[block] || []
  const cols = data?.columns || []
  const blurb = {
    Growth: 'Revenue, volume, and realisation YoY %.',
    Margins: 'Gross margin (proxy) and EBITDA margin %.',
    'Balance Sheet': 'Leverage, ROCE, and working capital.',
    'Cash Flow': 'OCF, FCF, and capex trajectory.',
    'Product Mix': 'Powertrain / segment mix %.',
    'Market Share': 'Overall and segment-level share %.',
  }

  if (!data) return null

  return (
    <section>
      <div className="section-head">
        <span className="section-eyebrow">Supporting Data</span>
        <span className="section-hint">Switch dataset · table left · chart right</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="chart-panel lg:col-span-5">
          <div className="chart-panel-head">
            <div className="chart-panel-row1">
              <div className="min-w-0 flex-1">
                <div className="chart-panel-title">{block}</div>
                <div className="chart-panel-sub">{blurb[block]}</div>
              </div>
              <div className="w-[180px] shrink-0">
                <Dropdown value={block} options={SUPPORT_BLOCKS} onChange={setBlock} />
              </div>
            </div>
            <div className="chart-panel-meta">
              <span>FY24 vs FY25</span>
              <span>Read · Positive / Neutral / Negative</span>
            </div>
          </div>

          <div className="chart-panel-body !p-0">
            <table className="mtbl-transposed">
              <thead>
                <tr>
                  <th className="metric-head">Metric</th>
                  {cols.map((c) => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>FY24</th>
                  {data.fy24.map((v, i) => (
                    <td key={i} className="text-[#94A3B8]">{fmtCell(v, data.fmt[i])}</td>
                  ))}
                </tr>
                <tr>
                  <th>FY25</th>
                  {data.fy25.map((v, i) => (
                    <td key={i} className="sel font-semibold">{fmtCell(v, data.fmt[i])}</td>
                  ))}
                </tr>
                <tr>
                  <th>Change</th>
                  {data.change.map((v, i) => (
                    <td key={i} className={`font-semibold ${
                      v === null ? 'text-[#94A3B8]' : v > 0 ? 'text-[#1F7A45]' : v < 0 ? 'text-[#9F1F2E]' : 'text-[#94A3B8]'
                    }`}>
                      {fmtChange(v, data.fmt[i])}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Read</th>
                  {data.read.map((r, i) => (
                    <td key={i}>
                      <span className={readClass[r] || readClass.Neutral}>{r}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <div className="mtbl-foot">{company.modelSource}</div>
          </div>
        </div>

        <div className="chart-panel lg:col-span-7 flex flex-col">
          <div className="chart-panel-head">
            <div className="chart-panel-row1">
              <div className="min-w-0">
                <div className="chart-panel-title">{block} — 12-year view</div>
                <div className="chart-panel-sub">{blurb[block]} · FY16–FY27</div>
              </div>
              <span className="bsr-pill">FY25</span>
            </div>
          </div>
          <div className="chart-panel-body">
            <div className="chart-canvas">
              <LineChartPanel series={series} />
            </div>
            <div className="chart-legend">
              {series.map((s) => (
                <span key={s.name} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
            <div className="chart-source">{company.modelSource}</div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ============================================================================
// ROUTER
// ============================================================================
export default function SupportingData({ company }) {
  if (company.supportingGroups?.length) {
    return <GroupedSupportingData company={company} />
  }
  return <LegacySupportingData company={company} />
}
