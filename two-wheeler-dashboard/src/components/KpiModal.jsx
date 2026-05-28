import React, { useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid } from 'recharts'
import { FY } from '../data.js'
import { LineTooltip, TOOLTIP_WRAPPER_STYLE } from './ChartTooltip.jsx'

const AXIS_TICK = { fontSize: 10.5, fill: '#64748B' }
const GRID = '#F1F5F9'

const fmtVal = (v, fmt) => {
  if (typeof v !== 'number') return '—'
  if (fmt === 'pp') return `${v.toFixed(1)}%`
  return v.toFixed(1)
}

function signalFor(latest, prev) {
  if (typeof latest !== 'number' || typeof prev !== 'number') return { label: 'Neutral', cls: 'read-pill neutral' }
  const d = latest - prev
  if (d > 1) return { label: 'Positive', cls: 'read-pill positive' }
  if (d < -1) return { label: 'Negative', cls: 'read-pill negative' }
  return { label: 'Neutral', cls: 'read-pill neutral' }
}

const StatTile = ({ label, value, variant }) => {
  const styles = {
    amber: { background: 'linear-gradient(135deg, #FEF3C7, #FFFFFF)', borderColor: '#FCD34D' },
    blue: { background: 'linear-gradient(135deg, #EAF2FF, #FFFFFF)', borderColor: '#93B4F4' },
    default: {},
  }[variant || 'default']
  return (
    <div
      className="rounded-xl border border-[#E5EAF1] bg-white px-3.5 py-3 shadow-card"
      style={styles}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</div>
      <div className="text-[19px] font-semibold text-[#0B1F33] mt-0.5 leading-tight tabular-nums">{value}</div>
    </div>
  )
}

export default function KpiModal({ open, kpi, company, onClose }) {
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

  if (!open || !kpi) return null

  const series = kpi.series || []
  const fy25Idx = FY.indexOf('FY25')
  const tenYearWindow = series
    .map((v, i) => ({ i, v }))
    .filter((p) => p.i <= fy25Idx && typeof p.v === 'number' && p.i >= fy25Idx - 9)

  const nums = tenYearWindow.map((p) => p.v)
  const current = nums.length ? nums[nums.length - 1] : null
  const prev = nums.length > 1 ? nums[nums.length - 2] : null
  const tenHigh = nums.length ? Math.max(...nums) : null
  const tenLow = nums.length ? Math.min(...nums) : null
  const latestYoY = typeof current === 'number' && typeof prev === 'number'
    ? Number((current - prev).toFixed(1))
    : null
  const sig = signalFor(current, prev)

  const rows = FY.map((fy, i) => ({ fy, v: series[i] }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#061321]/45 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-[980px] max-h-[92vh] overflow-hidden border border-[#E5EAF1] flex flex-col shadow-modal">
        <div
          className="px-7 py-5 border-b border-[#EEF1F5] flex items-start justify-between gap-4"
          style={{ background: 'linear-gradient(180deg, #EAF2FF 0%, #EEF4FB 100%)' }}
        >
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{kpi.label}</div>
            <h3 className="text-[20px] font-semibold text-[#0B1F33] tracking-tight leading-tight mt-1">
              {kpi.label} <span className="text-[#94A3B8] font-normal">|</span> {company.name} <span className="text-[#94A3B8] font-normal">|</span> 10-Year Trend
            </h3>
            <div className="text-[12.5px] text-[#334E68] mt-1">FY16–FY25 trend</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg text-[#475569] hover:bg-white text-2xl leading-none flex items-center justify-center">×</button>
        </div>

        <div className="px-7 py-6 overflow-y-auto space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatTile label="Current FY25" value={fmtVal(current, kpi.fmt)} />
            <StatTile label="10Y High" value={fmtVal(tenHigh, kpi.fmt)} variant="blue" />
            <StatTile label="10Y Low" value={fmtVal(tenLow, kpi.fmt)} variant="amber" />
            <StatTile
              label="Latest YoY"
              value={latestYoY === null ? '—' : `${latestYoY > 0 ? '+' : ''}${latestYoY.toFixed(1)}${kpi.fmt === 'pp' ? 'pp' : ''}`}
            />
            <div className="rounded-xl border border-[#E5EAF1] bg-white px-3.5 py-3 shadow-card flex flex-col justify-center">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Signal</div>
              <div className="mt-1.5"><span className={sig.cls}>{sig.label}</span></div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#E5EAF1] p-5">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="fy" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={48}
                    tickFormatter={(v) => (kpi.fmt === 'pp' ? `${v}%` : `${v}`)} />
                  <Tooltip
                    content={<LineTooltip unit={kpi.fmt === 'pp' ? '%' : undefined} />}
                    wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                    allowEscapeViewBox={{ x: false, y: false }}
                    offset={14}
                  />
                  <ReferenceLine x="FY25" stroke="#CBD5E1" strokeDasharray="3 3" />
                  <Line
                    type="monotone"
                    dataKey="v"
                    name={kpi.label}
                    stroke="#6D28D9"
                    strokeWidth={2.8}
                    dot={{ r: 3, fill: '#6D28D9' }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                    isAnimationActive={false}
                    strokeLinecap="round"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10.5px] text-[#6B7280] mt-3 pt-3 border-t border-[#F1F5F9]">{company.modelSource}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
