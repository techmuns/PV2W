import React from 'react'

const tagClass = {
  Gain:    'bg-[#E1F0E2] text-[#1F5C28]',
  Stable:  'bg-[#EEF1F5] text-[#475569]',
  Loss:    'bg-[#FBE3E3] text-[#8E1818]',
  Pending: 'bg-[#FBEFDC] text-[#7C3A07]',
}

const growthTone = (g) => {
  if (typeof g !== 'string' || !g) return 'text-[#94A3B8]'
  if (g.startsWith('-')) return 'text-[#9F1F2E]'
  if (g.startsWith('+')) return 'text-[#1F7A45]'
  return 'text-[#94A3B8]'
}

export default function ProductDrivers({ drivers, onCardClick }) {
  return (
    <section>
      <div className="section-head">
        <span className="section-eyebrow">Product-Level Drivers</span>
        <span className="section-hint">Top 6 by latest FY volume / disclosed importance</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-start">
        {drivers.slice(0, 6).map((m, i) => {
          const empty = m.value === '—' || m.value === 'Pending' || !m.value
          const isClickable = !empty && Array.isArray(m.series) && m.series.some((p) => typeof p.value === 'number')
          const Tag = isClickable ? 'button' : 'div'
          return (
            <Tag
              key={m.key || m.name}
              type={isClickable ? 'button' : undefined}
              onClick={isClickable ? () => onCardClick?.(m, i) : undefined}
              className={`veh-card w-full text-left ${isClickable ? 'cursor-pointer' : ''}`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-semibold text-[#0B1F33] text-[13px] leading-tight truncate">{m.name}</div>
                  <div className="text-[10.5px] text-[#6B7280] mt-0.5 truncate">{m.category || m.segment || '—'}</div>
                </div>
                <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${tagClass[m.tag] || tagClass.Stable}`}>
                  {m.tag}
                </span>
              </div>
              <div className={`text-[22px] font-semibold leading-tight tabular-nums ${empty ? 'text-[#94A3B8]' : 'text-[#0B1F33]'}`}>
                {m.value}
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-[10.5px] text-[#6B7280]">{m.sub || ''}</span>
                <span className={`text-[11.5px] font-semibold ${growthTone(m.growth)}`}>{m.growth || ''}</span>
              </div>
            </Tag>
          )
        })}
      </div>
    </section>
  )
}
