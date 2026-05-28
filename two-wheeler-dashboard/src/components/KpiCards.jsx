import React from 'react'

const toneToRead = {
  pos: { label: 'Positive', cls: 'signal-pos' },
  neg: { label: 'Negative', cls: 'signal-neg' },
  flat: { label: 'Neutral',  cls: 'signal-neu' },
}

const deltaClass = {
  pos: 'text-[#1F7A45]',
  neg: 'text-[#9F1F2E]',
  flat: 'text-[#94A3B8]',
}

const KpiIcon = ({ k }) => {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const icons = {
    mktShare: <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
    volGrowth: <svg viewBox="0 0 24 24" {...stroke}><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>,
    revGrowth: <svg viewBox="0 0 24 24" {...stroke}><path d="M12 2v20" /><path d="M17 7H9.5a2.5 2.5 0 100 5h5a2.5 2.5 0 110 5H7" /></svg>,
    ebitda: <svg viewBox="0 0 24 24" {...stroke}><circle cx="7" cy="7" r="2.2" /><circle cx="17" cy="17" r="2.2" /><path d="M5 19L19 5" /></svg>,
    evMix: <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" /></svg>,
    exportMix: <svg viewBox="0 0 24 24" {...stroke}><path d="M4 12h16" /><path d="M14 6l6 6-6 6" /></svg>,
    premium: <svg viewBox="0 0 24 24" {...stroke}><path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z" /></svg>,
  }
  return icons[k] || <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /></svg>
}

export default function KpiCards({ kpis, onKpiClick }) {
  return (
    <section>
      <div className="section-head">
        <span className="section-eyebrow">Key Metrics</span>
        <span className="section-hint">Click any card for the 10-year trend</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.slice(0, 6).map((k) => {
          const read = toneToRead[k.tone] || toneToRead.flat
          const isMissing = !k.value || k.value === '—'
          return (
            <button
              type="button"
              key={k.key || k.label}
              onClick={() => onKpiClick?.(k)}
              className="kpi-card tinted"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="kpi-icon"><KpiIcon k={k.key} /></span>
                <span className={`${isMissing ? 'signal-warn' : read.cls} text-[10.5px] font-semibold px-2 py-0.5 rounded-full`}>
                  {isMissing ? 'Pending' : read.label}
                </span>
              </div>
              <div className="mt-3 kpi-label">{k.label}</div>
              <div className="kpi-value mt-0.5">{isMissing ? '—' : k.value}</div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className={`text-[12px] font-semibold ${deltaClass[k.tone] || deltaClass.flat}`}>
                  {isMissing ? '—' : k.delta}
                </span>
                <span className="text-[10.5px] text-[#94A3B8]">YoY</span>
              </div>
              {isMissing && (
                <div className="text-[10px] text-[#94A3B8] mt-1">Source data pending</div>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
