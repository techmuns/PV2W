import React, { useEffect, useMemo } from 'react'
import {
  AreaChart, Area, Line, ComposedChart,
  XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, ReferenceDot,
} from 'recharts'

const fmtUnitsL = (n) =>
  typeof n === 'number' ? `${(n / 100000).toFixed(2)} L` : '—'

const fmtPct = (n, decimals = 1) =>
  typeof n === 'number' ? `${n.toFixed(decimals)}%` : '—'

const fmtPctSigned = (n) =>
  typeof n === 'number' ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '—'

const signalPill = {
  Gain:    { bg: '#E1F0E2', fg: '#1F5C28' },
  Stable:  { bg: '#EEF1F5', fg: '#475569' },
  Loss:    { bg: '#FBE3E3', fg: '#8E1818' },
  Pending: { bg: '#FBEFDC', fg: '#7C3A07' },
}

const SignalChip = ({ value }) => {
  const s = signalPill[value] || signalPill.Stable
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.fg, opacity: 0.6 }} />
      {value}
    </span>
  )
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value
  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E5EAF0', borderRadius: 10,
      boxShadow: '0 6px 20px rgba(15,23,42,0.10)', padding: '8px 12px',
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, color: '#0F1B2D' }}>{label}</div>
      <div style={{ color: '#475569', marginTop: 2 }}>
        Volume <span style={{ color: '#0F1B2D', fontWeight: 700, marginLeft: 8 }}>{fmtUnitsL(v)}</span>
      </div>
    </div>
  )
}

export default function ProductDriverModal({ open, driver, allDrivers, company, onClose }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  // Peer ranking — compute regardless of driver, so the order is stable.
  const ranked = useMemo(() => {
    if (!allDrivers) return []
    return [...allDrivers]
      .map((d) => ({ ...d, _rank: typeof d.fy25Raw === 'number' ? d.fy25Raw : -1 }))
      .sort((a, b) => b._rank - a._rank)
      .map((d, i) => ({ ...d, rank: i + 1 }))
  }, [allDrivers])

  if (!open || !driver) return null

  const series = driver.series || []
  const rows = series.map((p) => ({ fy: p.fy, value: p.value }))
  const fy25Row = rows.find((r) => r.fy === 'FY25')
  const oemShort = company?.shortName || company?.publicName || company?.name || 'OEM'
  const oemRankNote = (() => {
    const r = ranked.find((d) => d.key === driver.key)?.rank
    return typeof r === 'number' ? `#${r} of ${ranked.length} drivers` : ''
  })()

  // Source line — short, no raw URLs in the visible UI.
  const updated = company?.updated || '—'
  const sourceLine = `Source: ${driver.source} · Last updated ${updated}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#061321]/45 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-[980px] max-h-[92vh] overflow-hidden border border-[#E5EAF1] flex flex-col shadow-modal">
        {/* ───── Header ───── */}
        <div
          className="px-7 py-5 border-b border-[#EEF1F5] flex items-start gap-4"
          style={{ background: 'linear-gradient(180deg, #EAF2FF 0%, #EEF4FB 100%)' }}
        >
          {/* Image placeholder block (matches Maruti modal) */}
          <div
            className="shrink-0 w-[88px] h-[64px] rounded-xl flex items-center justify-center"
            style={{
              background: '#F4F7FB',
              border: '1px solid #D9E2EC',
              color: '#94A3B8',
            }}
            aria-hidden="true"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="6" cy="17" r="3" />
              <circle cx="18" cy="17" r="3" />
              <path d="M4 17H2v-4l3-7h11l3 4v7h-2" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Product detail</div>
            <h3 className="text-[20px] font-semibold text-[#0B1F33] tracking-tight leading-tight mt-0.5">
              {driver.name} <span className="text-[#94A3B8] font-normal">—</span> {oemShort}
            </h3>
            <div className="text-[12.5px] text-[#334E68] mt-1">
              {driver.category}
              {oemRankNote && <> · <span>{oemRankNote}</span></>}
              {' · Selected FY '}<span className="font-semibold">FY25</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg text-[#475569] hover:bg-white text-2xl leading-none flex items-center justify-center shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* ───── Body ───── */}
        <div className="px-7 py-6 overflow-y-auto space-y-5">
          {/* Volume trend */}
          <div className="rounded-xl border border-[#E5EAF1] bg-white p-5">
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-[14px] font-semibold text-[#0F1B2D]">Volume trend</div>
              <div className="text-[11px] text-[#6B7280]">FY23–FY25 · 3 years</div>
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="fy" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                    tickFormatter={(v) => `${(v / 100000).toFixed(1)} L`}
                  />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#CBD5E1', strokeDasharray: '3 3' }} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#2563EB"
                    strokeWidth={2.25}
                    fill="url(#trend-area)"
                    isAnimationActive={false}
                    dot={({ cx, cy, payload, index }) => {
                      if (typeof payload.value !== 'number') return null
                      const isCurrent = payload.fy === 'FY25'
                      // YoY direction → dot colour for FY24 & FY25
                      const prev = rows[index - 1]?.value
                      let fill = '#2563EB'
                      if (isCurrent) fill = '#F59E0B'
                      else if (typeof prev === 'number') fill = payload.value >= prev ? '#1F7A45' : '#9F1F2E'
                      return (
                        <g key={`d-${payload.fy}`}>
                          {isCurrent && (
                            <circle cx={cx} cy={cy} r={9} fill="#F59E0B" fillOpacity={0.18} />
                          )}
                          <circle cx={cx} cy={cy} r={isCurrent ? 5 : 4} fill={fill} stroke="#FFFFFF" strokeWidth={2} />
                        </g>
                      )
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-[#475569] mt-2">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded" style={{ background: '#2563EB' }} />
                {driver.name} units
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#1F7A45' }} /> YoY up
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#9F1F2E' }} /> YoY down
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#F59E0B' }} /> Current FY
              </span>
            </div>
          </div>

          {/* Metric tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-[#FCD34D] p-3" style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFFFFF)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Volume (FY25)</div>
              <div className="text-[20px] font-semibold text-[#0B1F33] mt-1 tabular-nums">{fmtUnitsL(fy25Row?.value)}</div>
            </div>
            <div className="rounded-xl border border-[#E5EAF1] bg-white p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Latest YoY</div>
              <div className={`text-[20px] font-semibold mt-1 tabular-nums ${
                typeof driver.yoyPct === 'number'
                  ? driver.yoyPct >= 0 ? 'text-[#1F7A45]' : 'text-[#9F1F2E]'
                  : 'text-[#94A3B8]'
              }`}>
                {fmtPctSigned(driver.yoyPct)}
              </div>
            </div>
            <div className="rounded-xl border border-[#E5EAF1] bg-white p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Mix % of total 2W</div>
              <div className="text-[20px] font-semibold text-[#0B1F33] mt-1 tabular-nums">
                {typeof driver.mixOfTotal2WPct === 'number' ? fmtPct(driver.mixOfTotal2WPct) : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-[#E5EAF1] bg-white p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Signal</div>
              <div className="mt-1.5"><SignalChip value={driver.signal || 'Pending'} /></div>
            </div>
          </div>

          {/* Peers table */}
          <div className="rounded-xl border border-[#E5EAF1] bg-white">
            <div className="flex items-baseline justify-between px-4 pt-3 pb-2">
              <div className="text-[14px] font-semibold text-[#0F1B2D]">Driver comparison</div>
              <div className="text-[11px] text-[#6B7280]">By FY25 volume</div>
            </div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  <th className="text-left font-semibold uppercase tracking-wider text-[10.5px] text-[#6B7280] py-2 px-4">Rank</th>
                  <th className="text-left font-semibold uppercase tracking-wider text-[10.5px] text-[#6B7280] py-2 px-4">Driver</th>
                  <th className="text-left font-semibold uppercase tracking-wider text-[10.5px] text-[#6B7280] py-2 px-4">Category</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[10.5px] text-[#6B7280] py-2 px-4">FY25 Volume</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[10.5px] text-[#6B7280] py-2 px-4">YoY</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[10.5px] text-[#6B7280] py-2 px-4">Mix %</th>
                  <th className="text-left font-semibold uppercase tracking-wider text-[10.5px] text-[#6B7280] py-2 px-4">Signal</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((d) => {
                  const isActive = d.key === driver.key
                  return (
                    <tr
                      key={d.key}
                      style={{ background: isActive ? '#EAF2FF' : 'transparent', fontWeight: isActive ? 600 : 400 }}
                      className="border-t border-[#F1F5F9]"
                    >
                      <td className="py-2 px-4 text-[#0F1B2D] tabular-nums">#{d.rank}</td>
                      <td className="py-2 px-4 text-[#0F1B2D]">{d.name}</td>
                      <td className="py-2 px-4 text-[#475569]">{d.category}</td>
                      <td className="py-2 px-4 text-right text-[#0F1B2D] tabular-nums">{fmtUnitsL(d.fy25Raw)}</td>
                      <td className={`py-2 px-4 text-right tabular-nums ${
                        typeof d.yoyPct === 'number'
                          ? d.yoyPct >= 0 ? 'text-[#1F7A45]' : 'text-[#9F1F2E]'
                          : 'text-[#94A3B8]'
                      }`}>
                        {fmtPctSigned(d.yoyPct)}
                      </td>
                      <td className="py-2 px-4 text-right text-[#475569] tabular-nums">{fmtPct(d.mixOfTotal2WPct)}</td>
                      <td className="py-2 px-4"><SignalChip value={d.signal || 'Pending'} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-[#6B7280] pt-1">{sourceLine}</div>
        </div>
      </div>
    </div>
  )
}
