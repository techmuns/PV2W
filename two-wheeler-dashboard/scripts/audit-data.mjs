// Per-company data audit. Reads every src/data/companies/<id>.json,
// runs cross-checks (margin = EBITDA/Revenue, FCF = CFO − Capex, etc.),
// and emits AUDIT_REPORT.md with:
//   - coverage matrix (per OEM × per FY × per block)
//   - cross-check results (PASS / DELTA / N/A)
//   - source provenance summary
//   - anomaly flags

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mapScreenerToCompany } from '../src/data/mapScreenerToCompany.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FY = ['FY16','FY17','FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25']
const OEMS = ['tvs','bajaj','hero','eicher','ola']

const readJson = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const pct = (a, b) => (isNum(a) && isNum(b) && b !== 0) ? (a / b) * 100 : null
const round = (x, d = 2) => isNum(x) ? Number(x.toFixed(d)) : null

// Coerce a per-FY value into a 10-element array.
//   - Array (length 10): as-is.
//   - Object { FY16: ..., FY17: ... }: project onto FY axis.
//   - Anything else: all-null.
const arr = (a) => {
  if (Array.isArray(a)) {
    if (a.length >= 10) return a.slice(0, 10)
    return [...a, ...new Array(10 - a.length).fill(null)]
  }
  if (a && typeof a === 'object') return FY.map(fy => isNum(a[fy]) ? a[fy] : null)
  return new Array(10).fill(null)
}

// Normalise a per-FY block (pl / bs / cf / ops) into a block whose keys are
// arrays of length 10. Drops non-series scalars (e.g. motorcyclesFy25, notes,
// sourcesByFy) which aren't yearly series.
const normaliseBlock = (block) => {
  if (!block || typeof block !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(block)) {
    if (Array.isArray(v)) out[k] = arr(v)
    else if (v && typeof v === 'object' && Object.keys(v).some(kk => /^FY\d{2}$/.test(kk))) out[k] = arr(v)
    // else: scalar / metadata, skip
  }
  return out
}

const blockCells = (block) => {
  const norm = normaliseBlock(block)
  let total = 0, populated = 0
  for (const v of Object.values(norm)) {
    total += v.length
    populated += v.filter(isNum).length
  }
  return { total, populated }
}

const fyCoverage = (block, fyIdx) => {
  const norm = normaliseBlock(block)
  const keys = Object.keys(norm)
  if (!keys.length) return null
  const total = keys.length
  const populated = keys.filter(k => isNum(norm[k][fyIdx])).length
  return { populated, total, pct: total ? Math.round((populated/total)*100) : 0 }
}

// ---- Cross-checks ----------------------------------------------------------
function crossChecks(co) {
  const pl = co.pl || {}
  const bs = co.bs || {}
  const cf = co.cf || {}
  const ops = co.ops || {}
  const metrics = co.metrics || {}

  const rev = arr(pl.revenue), ebitda = arr(pl.ebitda), pat = arr(pl.pat)
  const ebit = arr(pl.ebit), pbt = arr(pl.pbt), dep = arr(pl.depreciation), interest = arr(pl.interest)
  const td = arr(bs.totalDebt), cash = arr(bs.cashAndInv), nd = arr(bs.netDebt), nw = arr(bs.netWorth)
  const cfo = arr(cf.cfo), capex = arr(cf.capex), fcf = arr(cf.fcf)
  const mc = arr(ops.motorcyclesByFy), sc = arr(ops.scootersByFy), mo = arr(ops.mopedsByFy)
  const tw = arr(ops.threeWheelersByFy), ev = arr(ops.evByFy), tot = arr(ops.totalVolume)
  const ebitdaM = arr(metrics.ebitdaMargin), patM = arr(metrics.patMargin), ebitM = arr(metrics.ebitMargin)
  const de = arr(metrics.debtEquity), nde = arr(metrics.netDebtEquity)

  const checks = []
  const TOL = 1.0   // ±1 percentage point or 1% relative
  const TOLREL = 0.02

  FY.forEach((fy, i) => {
    // EBITDA margin
    if (isNum(ebitda[i]) && isNum(rev[i]) && isNum(ebitdaM[i])) {
      const calc = pct(ebitda[i], rev[i])
      const delta = Math.abs(calc - ebitdaM[i])
      checks.push({ fy, name: 'ebitdaMargin = ebitda/revenue', calc: round(calc), stored: ebitdaM[i], delta: round(delta), pass: delta <= TOL })
    }
    if (isNum(pat[i]) && isNum(rev[i]) && isNum(patM[i])) {
      const calc = pct(pat[i], rev[i])
      const delta = Math.abs(calc - patM[i])
      checks.push({ fy, name: 'patMargin = pat/revenue', calc: round(calc), stored: patM[i], delta: round(delta), pass: delta <= TOL })
    }
    if (isNum(ebit[i]) && isNum(rev[i]) && isNum(ebitM[i])) {
      const calc = pct(ebit[i], rev[i])
      const delta = Math.abs(calc - ebitM[i])
      checks.push({ fy, name: 'ebitMargin = ebit/revenue', calc: round(calc), stored: ebitM[i], delta: round(delta), pass: delta <= TOL })
    }
    // EBIT = EBITDA - D&A
    if (isNum(ebitda[i]) && isNum(dep[i]) && isNum(ebit[i])) {
      const calc = ebitda[i] - dep[i]
      const delta = Math.abs(calc - ebit[i])
      const rel = ebit[i] !== 0 ? delta/Math.abs(ebit[i]) : 0
      checks.push({ fy, name: 'EBIT = EBITDA − D&A', calc: round(calc), stored: ebit[i], delta: round(delta), pass: rel <= TOLREL })
    }
    // PBT reconciliation. Two valid conventions:
    //   A. EBIT excludes OtherIncome → PBT = EBIT − Interest + OtherIncome
    //   B. EBIT already includes OtherIncome → PBT = EBIT − Interest
    // Accept whichever matches within 5%.
    if (isNum(ebit[i]) && isNum(interest[i]) && isNum(pbt[i])) {
      const otherInc = isNum(pl.otherIncome?.[i]) ? pl.otherIncome[i] : 0
      const calcA = ebit[i] - interest[i] + otherInc
      const calcB = ebit[i] - interest[i]
      const dA = Math.abs(calcA - pbt[i]) / Math.max(1, Math.abs(pbt[i]))
      const dB = Math.abs(calcB - pbt[i]) / Math.max(1, Math.abs(pbt[i]))
      const best = dA < dB ? { calc: calcA, conv: 'A: EBIT−Int+OI' } : { calc: calcB, conv: 'B: EBIT−Int (OI inside EBITDA)' }
      const rel = Math.min(dA, dB)
      checks.push({ fy, name: `PBT (${best.conv})`, calc: round(best.calc), stored: pbt[i], delta: round(Math.abs(best.calc - pbt[i])), pass: rel <= 0.05 })
    }
    // Net debt = Total debt - Cash
    if (isNum(td[i]) && isNum(cash[i]) && isNum(nd[i])) {
      const calc = td[i] - cash[i]
      const delta = Math.abs(calc - nd[i])
      const rel = nd[i] !== 0 ? delta/Math.abs(nd[i]) : delta/Math.max(1,Math.abs(td[i]))
      checks.push({ fy, name: 'netDebt = totalDebt − cash', calc: round(calc), stored: nd[i], delta: round(delta), pass: rel <= 0.05 })
    }
    // FCF = CFO - Capex
    if (isNum(cfo[i]) && isNum(capex[i]) && isNum(fcf[i])) {
      const calc = cfo[i] - capex[i]
      const delta = Math.abs(calc - fcf[i])
      const rel = fcf[i] !== 0 ? delta/Math.abs(fcf[i]) : 0
      checks.push({ fy, name: 'FCF = CFO − Capex', calc: round(calc), stored: fcf[i], delta: round(delta), pass: rel <= 0.05 })
    }
    // D/E
    if (isNum(td[i]) && isNum(nw[i]) && nw[i] !== 0 && isNum(de[i])) {
      const calc = td[i] / nw[i]
      const delta = Math.abs(calc - de[i])
      checks.push({ fy, name: 'debtEquity = totalDebt / netWorth', calc: round(calc, 3), stored: de[i], delta: round(delta, 3), pass: delta <= 0.05 })
    }
    if (isNum(nd[i]) && isNum(nw[i]) && nw[i] !== 0 && isNum(nde[i])) {
      const calc = nd[i] / nw[i]
      const delta = Math.abs(calc - nde[i])
      checks.push({ fy, name: 'netDebtEquity = netDebt / netWorth', calc: round(calc, 3), stored: nde[i], delta: round(delta, 3), pass: delta <= 0.05 })
    }
    // Volume = sum of segments
    const seg = [mc[i], sc[i], mo[i], tw[i]].filter(isNum)
    if (seg.length && isNum(tot[i])) {
      const calc = seg.reduce((a,b)=>a+b,0)
      const delta = Math.abs(calc - tot[i])
      const rel = tot[i] !== 0 ? delta/tot[i] : 0
      checks.push({ fy, name: 'totalVolume ≈ Σ segments', calc, stored: tot[i], delta, pass: rel <= 0.05 })
    }
  })
  return checks
}

// ---- Main ------------------------------------------------------------------
async function main() {
  const out = []
  out.push(`# Two-Wheeler Dashboard — Data Audit`)
  out.push(``)
  out.push(`_Generated ${new Date().toISOString()} by \`scripts/audit-data.mjs\`._`)
  out.push(``)
  out.push(`This audit reads every per-OEM JSON, computes coverage, runs accounting cross-checks (e.g. EBITDA margin = EBITDA / Revenue, FCF = CFO − Capex, Net debt = Total debt − Cash) and flags discrepancies > tolerance.`)
  out.push(``)

  // --- Top-level coverage ---
  out.push(`## 1. Coverage summary`)
  out.push(``)
  out.push(`| OEM | Basis | fyAxis | P&L cells | BS cells | CF cells | Ops cells | Metrics cells | Verification |`)
  out.push(`|---|---|---|---|---|---|---|---|---|`)

  const summaries = []
  for (const id of OEMS) {
    let co
    try { co = await readJson(`src/data/companies/${id}.json`) } catch (e) {
      out.push(`| **${id}** | — | _missing JSON_ | — | — | — | — | — | — |`)
      continue
    }
    // Match data.js: if curated JSON is empty, fall through to Screener sidecar.
    const curatedHasData = co?.fyAxis?.length && co?.pl && Object.keys(co.pl).length
    let dataSource = 'curated AR text'
    if (!curatedHasData) {
      try {
        const scr = await readJson(`src/data/companies/_screener/${id}.json`)
        const mapped = mapScreenerToCompany(scr, { name: co.name, shortName: co.shortName })
        if (mapped) { co = mapped; dataSource = 'Screener sidecar' }
      } catch {}
    }
    const pl = blockCells(co.pl), bs = blockCells(co.bs), cf = blockCells(co.cf)
    const ops = blockCells(co.ops), met = blockCells(co.metrics)
    const fyA = co.fyAxis?.length || 0
    const verif = co.verification?.status || '—'
    summaries.push({ id, co, pl, bs, cf, ops, met, dataSource })
    out.push(`| **${id}** | ${co.basis || '—'} | ${fyA} FYs | ${pl.populated}/${pl.total} | ${bs.populated}/${bs.total} | ${cf.populated}/${cf.total} | ${ops.populated}/${ops.total} | ${met.populated}/${met.total} | ${verif} (${dataSource}) |`)
  }
  out.push(``)

  // --- Per-FY coverage heatmap (P&L) ---
  out.push(`## 2. P&L coverage by FY`)
  out.push(``)
  out.push(`| OEM | ${FY.join(' | ')} |`)
  out.push(`|---${FY.map(()=>'|---').join('')}|`)
  for (const s of summaries) {
    const cells = FY.map((_, i) => {
      const c = fyCoverage(s.co.pl, i)
      if (!c) return '·'
      if (c.populated === 0) return '⚪'
      if (c.populated === c.total) return '🟢'
      return `🟡${c.populated}/${c.total}`
    })
    out.push(`| ${s.id} | ${cells.join(' | ')} |`)
  }
  out.push(``)
  out.push(`Legend: 🟢 full · 🟡 partial · ⚪ none · · no block`)
  out.push(``)

  // --- Per-FY coverage (Ops) ---
  out.push(`## 3. Operations coverage by FY`)
  out.push(``)
  out.push(`| OEM | ${FY.join(' | ')} |`)
  out.push(`|---${FY.map(()=>'|---').join('')}|`)
  for (const s of summaries) {
    const ops = s.co.ops || {}
    const segs = ['motorcyclesByFy','scootersByFy','mopedsByFy','threeWheelersByFy','evByFy','exportsByFy']
    // Coerce object-shape series ({FY16:...}) into arrays. Only count segments
    // that have at least one non-null value across the whole timeseries
    // (so Bajaj's all-null scooters/mopeds don't dilute the score).
    const norm = {}
    for (const k of segs) {
      const a = arr(ops[k])
      if (a.some(isNum)) norm[k] = a
    }
    const applicable = Object.keys(norm)
    const cells = FY.map((_, i) => {
      if (!applicable.length) return '·'
      const populated = applicable.filter(k => isNum(norm[k][i])).length
      if (populated === 0) return '⚪'
      if (populated === applicable.length) return '🟢'
      return `🟡${populated}/${applicable.length}`
    })
    out.push(`| ${s.id} | ${cells.join(' | ')} |`)
  }
  out.push(``)

  // --- Cross-checks ---
  out.push(`## 4. Accounting cross-checks`)
  out.push(``)
  for (const s of summaries) {
    const checks = crossChecks(s.co)
    if (!checks.length) continue
    const pass = checks.filter(c => c.pass).length
    const fail = checks.length - pass
    out.push(`### ${s.id} — ${pass} PASS · ${fail} FAIL · ${checks.length} total`)
    if (fail) {
      out.push(``)
      out.push(`| FY | Check | Stored | Calculated | Δ | |`)
      out.push(`|---|---|---|---|---|---|`)
      for (const c of checks) {
        if (c.pass) continue
        out.push(`| ${c.fy} | ${c.name} | ${c.stored} | ${c.calc} | ${c.delta} | ⚠️ |`)
      }
    } else {
      out.push(``)
      out.push(`_All ${pass} computable checks pass within tolerance._`)
    }
    out.push(``)
  }

  // --- Provenance ---
  out.push(`## 5. Source provenance`)
  out.push(``)
  out.push(`| OEM | Primary source | Notes |`)
  out.push(`|---|---|---|`)
  for (const s of summaries) {
    const src = s.co.sources?.primary || s.co.verification?.method || '—'
    const note = (s.co.sources?.notes || '').slice(0, 120)
    out.push(`| ${s.id} | ${src.slice(0,140)} | ${note} |`)
  }
  out.push(``)

  // --- Anomaly flags ---
  out.push(`## 6. Anomaly flags`)
  out.push(``)
  const flags = []
  for (const s of summaries) {
    const rev = arr(s.co.pl?.revenue)
    const pat = arr(s.co.pl?.pat)
    const tot = arr(s.co.ops?.totalVolume)
    rev.forEach((v, i) => {
      if (i === 0 || !isNum(v) || !isNum(rev[i-1])) return
      const g = ((v - rev[i-1]) / rev[i-1]) * 100
      if (Math.abs(g) > 60) flags.push(`- **${s.id}** ${FY[i]} revenue ${g > 0 ? '+' : ''}${g.toFixed(1)}% YoY (verify — large swing)`)
    })
    pat.forEach((v, i) => {
      if (!isNum(v)) return
      if (v < 0 && s.id !== 'ola') flags.push(`- **${s.id}** ${FY[i]} PAT negative (₹${v} Cr) — unusual for a profitable OEM`)
    })
  }
  if (flags.length) out.push(flags.join('\n'))
  else out.push(`_No anomalies flagged._`)
  out.push(``)

  // --- Pending / NA ---
  out.push(`## 7. Pending / not-applicable cells`)
  out.push(``)
  for (const s of summaries) {
    const na = s.co.na || []
    if (!na.length) continue
    out.push(`**${s.id}**`)
    for (const item of na) out.push(`- ${item}`)
    out.push(``)
  }

  // Write file
  const md = out.join('\n')
  await writeFile(join(ROOT, 'AUDIT_REPORT.md'), md, 'utf8')
  console.log(md)
  console.log(`\n[audit-data] wrote ${md.length} bytes -> AUDIT_REPORT.md`)
}

main().catch(e => { console.error(e); process.exit(1) })
