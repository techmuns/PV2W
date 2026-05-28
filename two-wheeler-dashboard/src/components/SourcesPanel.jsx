import React from 'react'

// Compact source strip — short chips, no paragraphs.
export default function SourcesPanel({ company }) {
  const raw = (company.modelSource || '').replace(/^Source:\s*/i, '').trim()
  const chips = raw ? raw.split(/\s*·\s*/).filter(Boolean) : []
  if (!chips.length) return null

  return (
    <section>
      <div className="section-head">
        <span className="section-eyebrow">Sources</span>
        <span className="section-hint">FY16–FY25</span>
      </div>
      <div className="card p-4 flex items-center flex-wrap gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Source</span>
        {chips.map((c) => (
          <span
            key={c}
            className="text-[11.5px] font-medium text-[#334E68] bg-[#F4F7FB] border border-[#E5EAF1] rounded-full px-2.5 py-1"
          >
            {c}
          </span>
        ))}
      </div>
    </section>
  )
}
