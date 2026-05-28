import React from 'react'

// ============================================================================
// Shared chart tooltip — Maruti reference layout
//   - Compact white card, soft shadow, 14px radius, 16px padding
//   - Title row: FY label (bold)
//   - Subtitle row: label · value (right-aligned, value bold)
//   - Body rows: dot · name · '<value> lakh units' · '(<pct>%)' in grey
//   - max-width 380, pointer-events none, z-index 20
//   - No status pill, no source paragraph — those live outside the card
// ============================================================================
const CARD_STYLE = {
  background: '#FFFFFF',
  border: '1px solid #E5EAF0',
  borderRadius: 14,
  boxShadow: '0 12px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.04)',
  padding: '14px 18px',
  minWidth: 260,
  maxWidth: 380,
  fontSize: 12.5,
  color: '#0F1B2D',
  pointerEvents: 'none',
  lineHeight: 1.45,
}

const ROW_STYLE = {
  display: 'grid',
  gridTemplateColumns: '12px 1fr auto auto',
  alignItems: 'center',
  columnGap: 12,
  padding: '3px 0',
}

const fmtLakh = (v) => (typeof v === 'number' ? `${(v / 100000).toFixed(2)} lakh units` : '—')
const fmtPct = (v) => (typeof v === 'number' ? `(${v.toFixed(1)}%)` : '')

/**
 * Mix-chart tooltip (TVS / Industry / future OEMs).
 * Use as: <Tooltip content={<MixTooltip />} ... />
 * Each row in chartData is expected to expose __total alongside segment keys.
 */
export function MixTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const total = row.__total
  const disclosed = payload.filter((p) => typeof row[p.dataKey] === 'number' && row[p.dataKey] > 0)

  return (
    <div style={CARD_STYLE}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{label}</div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 16,
        fontSize: 12.5, color: '#475569',
        paddingBottom: 10, marginBottom: 8,
        borderBottom: '1px solid #F1F5F9',
      }}>
        <span>Total sales volume</span>
        <span style={{ color: '#0F1B2D', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {fmtLakh(total)}
        </span>
      </div>

      {disclosed.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94A3B8', fontStyle: 'italic' }}>
          Not disclosed.
        </div>
      ) : (
        disclosed.map((p) => {
          const segName = p.dataKey
          const vol = row[segName]
          const pct = total > 0 && typeof vol === 'number' ? (vol / total) * 100 : null
          return (
            <div key={segName} style={ROW_STYLE}>
              <span style={{ width: 10, height: 10, background: p.color, borderRadius: 2 }} />
              <span style={{ color: '#475569' }}>{segName}</span>
              <span style={{ color: '#0F1B2D', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {fmtLakh(vol)}
              </span>
              <span style={{ color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                {fmtPct(pct)}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

/**
 * Generic line / bar tooltip (Growth vs Industry, Supporting Data trends, KPI modal).
 * Uses the same card chrome as MixTooltip so every chart in the dashboard
 * looks identical. Accepts an optional `unit` ('%', 'L', '₹ Cr', etc.).
 */
export function LineTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null

  const fmt = (v) => {
    if (typeof v !== 'number') return '—'
    if (unit === '%')  return `${v.toFixed(1)}%`
    if (unit === 'L')  return `${v.toFixed(2)} lakh units`
    if (unit === 'Cr') return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`
    return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  }

  return (
    <div style={CARD_STYLE}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #F1F5F9' }}>
        {label}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} style={ROW_STYLE}>
          <span style={{ width: 10, height: 10, background: p.color, borderRadius: 2 }} />
          <span style={{ color: '#475569' }}>{p.name || p.dataKey}</span>
          <span style={{ color: '#0F1B2D', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmt(p.value)}
          </span>
          <span />
        </div>
      ))}
    </div>
  )
}

// Shared Recharts wrapperStyle so every <Tooltip> behaves the same way.
export const TOOLTIP_WRAPPER_STYLE = {
  zIndex: 20,
  pointerEvents: 'none',
}
