import React, { useEffect, useRef, useState } from 'react'
import { SECTOR_META } from '../data.js'
import { verificationsForCompany, rollupStatus, statusLabel } from '../data/verification.js'

const SignalClass = {
  Positive: 'signal-pos',
  Negative: 'signal-neg',
  Neutral: 'signal-neu',
  Fresh: 'signal-pos',
  Stale: 'signal-warn',
  Pending: 'signal-warn',
  Missing: 'signal-neu',
}

const DATA_STATUS_CLASS = {
  audited:     'signal-pos',
  approximate: 'signal-warn',
  pending:     'signal-neu',
}

const Label = ({ children }) => (
  <span className="text-[10px] font-medium uppercase tracking-wider text-white/55">{children}</span>
)

function Caret({ className = '' }) {
  return (
    <svg className={className} width="11" height="11" viewBox="0 0 20 20" fill="none">
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
      <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 17h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Sister dashboards served by the same Worker. The PV dashboard lives at
// the site root; this 2W app is mounted at /2w/. The switcher jumps
// between them by absolute path so it works regardless of the current URL.
const SEGMENTS = [
  { id: 'PV', label: 'Passenger Vehicles',  sub: 'Cars · SUVs · MPVs — Maruti · Hyundai · M&M · Tata',          href: '/',    status: null },
  { id: '2W', label: 'Two Wheelers',         sub: 'Motorcycles · scooters — Hero · Bajaj · TVS · Eicher · Ola',  href: null,   status: 'ACTIVE' },
  { id: 'CV', label: 'Commercial Vehicles',  sub: 'Trucks · buses · LCVs — Tata · M&M · Ashok Leyland · VECV',   href: null,   status: 'SOON' },
]

export default function Header({ company, companies, onSelectCompany, onExport }) {
  const [open, setOpen] = useState(false)
  const [segOpen, setSegOpen] = useState(false)
  const ref = useRef(null)
  const segRef = useRef(null)
  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
      if (segRef.current && !segRef.current.contains(e.target)) setSegOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setSegOpen(false) } }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey) }
  }, [])

  return (
    <div
      className="w-full text-white sticky top-0 z-30 shadow-md"
      style={{ background: 'linear-gradient(95deg, #4F46E5 0%, #6D28D9 55%, #7C3AED 100%)' }}
    >
      <div className="max-w-[1480px] mx-auto px-8 py-4 flex items-center gap-6 flex-wrap">
        {/* Segment switcher (brand pill → dropdown to sister dashboards) */}
        <div className="relative" ref={segRef}>
          <button
            type="button"
            onClick={() => setSegOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={segOpen}
            title="Switch segment"
            className="flex items-center pr-3.5 pl-1.5 py-1.5 rounded-xl text-left transition-colors hover:bg-white/10"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.22)' }}
          >
            <div className="relative w-10 h-10 rounded-md bg-white/95 text-brand-700 font-bold text-[15px] flex items-center justify-center">
              {SECTOR_META.badge}
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#6D28D9]" />
            </div>
            <div className="ml-2.5 leading-tight">
              <div className="flex items-center gap-1 font-semibold text-[16px] tracking-tight">
                {SECTOR_META.title}
                <Caret className={`opacity-80 ml-0.5 transition-transform ${segOpen ? 'rotate-180' : ''}`} />
              </div>
              <div className="text-[11.5px] text-white/65">{SECTOR_META.subtitle}</div>
            </div>
          </button>

          {segOpen && (
            <div
              role="menu"
              className="absolute top-full left-0 mt-2 w-[400px] max-w-[calc(100vw-2rem)] bg-white text-slate-800 rounded-2xl shadow-2xl border border-slate-200/70 overflow-hidden z-40"
            >
              <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-brand-50 to-slate-50">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Switch segment</div>
                <div className="text-[14px] font-semibold text-slate-800 mt-0.5">Indian Auto Coverage</div>
              </div>
              <div className="p-2 space-y-1">
                {SEGMENTS.map((s) => {
                  const active = s.id === '2W'
                  const Tag = s.href ? 'a' : 'button'
                  return (
                    <Tag
                      key={s.id}
                      {...(s.href ? { href: s.href } : { type: 'button', disabled: !s.href })}
                      role="menuitem"
                      onClick={() => setSegOpen(false)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${
                        active ? 'bg-brand-50' : s.href ? 'hover:bg-slate-50 cursor-pointer' : 'opacity-70 cursor-default'
                      }`}
                    >
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-[12px] ${
                        active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {s.id}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-slate-800">{s.label}</span>
                          {s.status === 'ACTIVE' && (
                            <span className="text-[9.5px] font-bold tracking-wider px-1.5 py-0.5 rounded" style={{ background: '#D1FAE5', color: '#065F46' }}>ACTIVE</span>
                          )}
                          {s.status === 'SOON' && (
                            <span className="text-[9.5px] font-bold tracking-wider px-1.5 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>SOON</span>
                          )}
                        </span>
                        <span className="block text-[11px] text-slate-400 mt-0.5">{s.sub}</span>
                      </span>
                      {s.href && (
                        <svg className="text-slate-300 flex-shrink-0" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4" /></svg>
                      )}
                    </Tag>
                  )
                })}
              </div>
              <div className="px-5 py-3 border-t border-slate-100 text-[10.5px] text-slate-400 bg-slate-50/60">
                CV module is under construction. PV &amp; 2W are live.
              </div>
            </div>
          )}
        </div>

        {/* Latest data */}
        <div className="flex items-center gap-2">
          <Label>Latest data</Label>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-white/15 text-white">{company?.latestFy || SECTOR_META.latestFy}</span>
        </div>

        {/* Company selector */}
        <div className="flex items-center gap-2 relative" ref={ref}>
          <Label>Company</Label>
          <div className="relative">
            <span className="hdr-dot" style={{ background: company.dotColor }} />
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="hdr-select company text-left pr-9"
            >
              {company.name}
            </button>
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" width="12" height="12" viewBox="0 0 20 20" fill="none">
              <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {open && (
              <div className="absolute top-full left-0 mt-1 w-[232px] bg-white text-slate-800 rounded-lg shadow-lg border border-slate-100 overflow-hidden z-30">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { onSelectCompany(c.id); setOpen(false) }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 text-[13.5px] hover:bg-brand-50 ${
                      c.id === company.id ? 'bg-brand-50 text-brand-700 font-semibold' : ''
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.dotColor }} />
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Vertical divider + Signal / Updated / Data */}
        <div className="flex items-center gap-4 pl-4 border-l border-white/15">
          <div className="flex items-center gap-2">
            <Label>Signal</Label>
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${SignalClass[company.signal] || 'signal-neu'}`}>
              {company.signal}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Label>Updated</Label>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-white/15 text-white">{company.updated}</span>
          </div>
          <div className="flex items-center gap-2" title="Data verification rollup — see the Data Quality panel for per-source breakdown.">
            <Label>Data</Label>
            {(() => {
              const verifs = verificationsForCompany(company.id)
              const rollup = rollupStatus(verifs)
              return (
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${DATA_STATUS_CLASS[rollup.status] || 'signal-neu'}`}>
                  {statusLabel(rollup.status)}
                </span>
              )
            })()}
          </div>
        </div>

        <div className="ml-auto">
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-md bg-white text-brand-700 hover:bg-brand-50"
          >
            <DownloadIcon />
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
