import React from 'react'
import { SECTOR_META } from '../data.js'

export default function Footer() {
  return (
    <footer className="pt-2 pb-8 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap">
        <img src="/munshot-logo.png" alt="Munshot" className="h-7" style={{ opacity: 0.55 }} />
        <div className="text-[11px] text-[#6B7280]">{SECTOR_META.footer}</div>
      </div>
      <div className="text-[10.5px] text-[#6B7280] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        Data refreshed 8h ago
      </div>
    </footer>
  )
}
