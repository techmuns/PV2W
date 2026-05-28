import React from 'react'

/**
 * Governance & Network — surfaces the company's KMP / dealer footprint /
 * credit rating / employee count directly on the main page (mirrors the
 * Maruti reference). All values pulled from company.profile (sourced from
 * the latest annual report). Missing cells show "—" instead of being
 * silently hidden.
 *
 * Responsive grid: 2 cols mobile → 3 cols tablet → 6 cols desktop.
 */
export default function GovernanceNetwork({ company }) {
  const prof = company?.profile || null
  const asOfFy = prof?.asOfFy || company?.hero?.fy || 'FY25'

  const fmtNumber = (n) =>
    typeof n === 'number' ? n.toLocaleString('en-IN') : (n || null)

  const items = [
    { label: 'CEO',           value: prof?.kmp?.ceo },
    { label: 'CFO',           value: prof?.kmp?.cfo },
    { label: 'COO',           value: prof?.kmp?.coo },
    { label: 'Credit Rating', value: prof?.creditRating?.longTerm },
    { label: 'Sales Outlets', value: fmtNumber(prof?.dealers?.total) },
    { label: 'Employees',     value: fmtNumber(prof?.employees?.permanent) },
  ]

  // Build the short source line. Keep raw URLs out of the visible UI;
  // they live in tvs.json provenance + Supporting Data drawer.
  const source = (() => {
    const parts = []
    if (prof?.source) parts.push(prof.source.replace(/\.$/, ''))
    if (company?.updated && company.updated !== '—') parts.push(`Last updated ${company.updated}`)
    if (!parts.length) parts.push('Source pending — awaiting annual report upload')
    return parts.join(' · ')
  })()

  return (
    <section>
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-[14px] font-semibold text-[#0B1F33]">Governance &amp; Network</h2>
          <span className="text-[11px] text-[#6B7280]">{asOfFy} snapshot</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {items.map(({ label, value }) => (
            <div key={label} className="info-chip" title={value || '—'}>
              <div className="info-chip-label">{label}</div>
              <div className="info-chip-value">{value || '—'}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[10.5px] text-[#6B7280] leading-relaxed">
          Source: {source}
        </p>
      </div>
    </section>
  )
}
