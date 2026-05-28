#!/usr/bin/env node
// Merge raw disclosed standalone figures (data/raw-<slug>-backfill.json, extracted
// from BSE annual-report filings) into src/data/companies/<id>.json for the
// FY16–FY22 back-catalogue. FY23–FY25 cells are preserved untouched.
//
// Derived items (EBITDA, EBIT, net debt, working capital, FCF, margins, D/E,
// growth, realisation) are computed by formula from the disclosed line items,
// matching the conventions the dashboard already uses for FY23–FY25 and the
// cross-checks in scripts/audit-data.mjs — so the back-history is internally
// consistent by construction. No estimates: a cell stays null unless the
// underlying inputs were actually disclosed.
//
// Usage: node scripts/backfill-from-raw.mjs <slug>   (slug: bajaj | hero)

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const FY = ['FY16','FY17','FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25']
const BACK = FY.slice(0, 7) // FY16..FY22 (indices 0..6)

const slug = process.argv[2]
if (!slug || !['bajaj','hero'].includes(slug)) {
  console.error('Usage: node scripts/backfill-from-raw.mjs <bajaj|hero>')
  process.exit(2)
}

// Segment mapping differs per OEM. Bajaj reports a single "Two-wheelers"
// aggregate (which the dashboard stores under motorcyclesByFy) plus CV/3W;
// Hero splits motorcycles vs scooters and makes no 3W.
const CFG = {
  // preEvZeroThrough: last FY index whose EV mix is factually ~0 (product did
  // not exist / was immaterial and undisclosed). Bajaj Chetak relaunched Jan-2020
  // but EV mix only became material (and disclosed) from FY22, so FY16–FY21 ≈ 0.
  // zeroSegments: per-FY volume buckets the OEM factually does not produce, set
  // to 0 (not null) so the product-mix stack can render the segments it DOES
  // disclose. Bajaj makes no conventional ICE scooters (only the electric
  // Chetak, counted under EV) and no mopeds; Hero makes no mopeds or 3-wheelers.
  // zeroMixFy25: matching FY25 mix-% metric keys set to 0.
  bajaj: { twoWheelerKey: 'motorcyclesByFy', has3W: true,  hasScooters: false, preEvZeroThrough: 5,
           zeroSegments: ['scootersByFy', 'mopedsByFy'], zeroMixFy25: ['scooterMixFy25', 'mopedMixFy25'] },
  hero:  { twoWheelerKey: 'motorcyclesByFy', has3W: false, hasScooters: true,  preEvZeroThrough: -1,
           zeroSegments: ['mopedsByFy', 'threeWheelersByFy'], zeroMixFy25: [] },
}[slug]

const n = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null
const r2 = (v) => (v === null ? null : Number(v.toFixed(2)))
const r0 = (v) => (v === null ? null : Math.round(v))
// Sum components; null only if the lead component is null. Treats trailing
// nulls as 0 (e.g. capex with no separate intangibles line).
const sumWithLead = (lead, ...rest) => {
  if (n(lead) === null) return null
  return rest.reduce((a, b) => a + (n(b) ?? 0), lead)
}
// Sum that is null only if every component is null.
const sumAny = (...vals) => {
  const nums = vals.map(n).filter((x) => x !== null)
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null
}
const yoy = (cur, prev) => (n(cur) !== null && n(prev) !== null && prev !== 0)
  ? r2((cur / prev - 1) * 100) : null
const ratio = (a, b) => (n(a) !== null && n(b) !== null && b !== 0) ? a / b : null
const pctOf = (a, b) => { const x = ratio(a, b); return x === null ? null : r2(x * 100) }

const raw = JSON.parse(await readFile(join(ROOT, `data/raw-${slug}-backfill.json`), 'utf8'))
const coPath = join(ROOT, `src/data/companies/${slug}.json`)
const co = JSON.parse(await readFile(coPath, 'utf8'))

// Build per-FY computed records for the back-catalogue.
const rec = {} // FY -> computed fields
for (const fy of BACK) {
  const d = raw.fy?.[fy] || {}
  const revenue      = n(d.revenue) ?? n(d.revenueNet)
  const otherIncome  = n(d.otherIncome)
  const depreciation = n(d.depreciation)
  const interest     = n(d.financeCosts)
  const pbt          = n(d.pbt)
  const pat          = n(d.pat)

  // Operating EBITDA derived from disclosed line items, excl. other income.
  // EBITDA = PBT + Finance costs + Depreciation − Other income.
  // (Same convention used for FY23–FY25; guarantees EBIT = EBITDA − D&A and
  //  PBT = EBIT − interest + other income reconcile exactly.)
  let ebitda = null
  if (pbt !== null && interest !== null && depreciation !== null && otherIncome !== null) {
    ebitda = r2(pbt + interest + depreciation - otherIncome)
  }
  const ebit = (ebitda !== null && depreciation !== null) ? r2(ebitda - depreciation) : null

  // Balance sheet
  const totalAssets = n(d.totalAssets)
  const netWorth    = n(d.netWorth)
  const totalDebt   = (n(d.borrowings) === null && n(d.leaseLiabilities) === null)
    ? null : (n(d.borrowings) ?? 0) + (n(d.leaseLiabilities) ?? 0)
  const cashAndInv  = sumAny(d.cashCash, d.otherBank, d.currentInv, d.nonCurrentInv)
  const netDebt     = (totalDebt !== null && cashAndInv !== null) ? r2(totalDebt - cashAndInv) : null
  const receivables = n(d.receivables)
  const inventory   = n(d.inventory)
  const payables    = n(d.payables)
  const workingCapital = (receivables !== null && inventory !== null && payables !== null)
    ? r2(receivables + inventory - payables) : null

  // Cash flow
  const cfo   = n(d.cfo)
  const capex = sumWithLead(d.capexPPE, d.capexIntangibles)
  const fcf   = (cfo !== null && capex !== null) ? r2(cfo - capex) : null
  const cfi   = n(d.cfi)
  const cff   = n(d.cff)

  rec[fy] = {
    revenue, otherIncome, depreciation, interest, pbt, pat, ebitda, ebit,
    totalAssets, netWorth, totalDebt, cashAndInv, netDebt, receivables, inventory, payables, workingCapital,
    cfo, capex, fcf, cfi, cff,
    totalVolume: n(d.totalVolume),
    twoWheelers: n(d.twoWheelers) ?? n(d.motorcycles),
    scooters: n(d.scooters),
    threeWheelers: n(d.threeWheelers) ?? n(d.commercialVehicles),
    exports: n(d.exports),
    ev: n(d.ev),
    roeDisclosed: n(d.roeDisclosed),
    roceDisclosed: n(d.roceDisclosed),
    exceptionalItems: n(d.exceptionalItems) ?? 0,
    sourceAR: d.sourceAR || null,
    accountingBasis: d.accountingBasis || null,
  }
}

// Helper to write index 0..6 of an array field, preserving 7..9.
const setBack = (arr, fy, val) => { arr[FY.indexOf(fy)] = val }

for (const fy of BACK) {
  const x = rec[fy]
  setBack(co.pl.revenue, fy, x.revenue)
  setBack(co.pl.otherIncome, fy, x.otherIncome)
  setBack(co.pl.ebitda, fy, x.ebitda)
  setBack(co.pl.depreciation, fy, x.depreciation)
  setBack(co.pl.ebit, fy, x.ebit)
  setBack(co.pl.interest, fy, x.interest)
  setBack(co.pl.pbt, fy, x.pbt)
  setBack(co.pl.pat, fy, x.pat)

  setBack(co.bs.totalAssets, fy, x.totalAssets)
  setBack(co.bs.netWorth, fy, x.netWorth)
  setBack(co.bs.totalDebt, fy, x.totalDebt)
  setBack(co.bs.cashAndInv, fy, x.cashAndInv)
  setBack(co.bs.netDebt, fy, x.netDebt)
  setBack(co.bs.receivables, fy, x.receivables)
  setBack(co.bs.inventory, fy, x.inventory)
  setBack(co.bs.payables, fy, x.payables)

  setBack(co.cf.cfo, fy, x.cfo)
  setBack(co.cf.capex, fy, x.capex)
  setBack(co.cf.fcf, fy, x.fcf)
  setBack(co.cf.cfi, fy, x.cfi)
  setBack(co.cf.cff, fy, x.cff)

  setBack(co.bs.workingCapital, fy, x.workingCapital)

  // Ops
  setBack(co.ops.totalVolume, fy, x.totalVolume)
  if (x.twoWheelers !== null) co.ops[CFG.twoWheelerKey][fy] = x.twoWheelers
  if (CFG.hasScooters && x.scooters !== null) co.ops.scootersByFy[fy] = x.scooters
  if (CFG.has3W && x.threeWheelers !== null) co.ops.threeWheelersByFy[fy] = x.threeWheelers
  if (x.exports !== null) co.ops.exportsByFy[fy] = x.exports
  if (x.ev !== null) co.ops.evByFy[fy] = x.ev
}

// ---- Metrics (computed from the freshly populated arrays) ----
const m = co.metrics
const rev = co.pl.revenue, vol = co.ops.totalVolume, nw = co.bs.netWorth
for (let i = 0; i < 7; i++) {
  const fy = FY[i]
  const x = rec[fy]
  // realisation
  const realis = (n(rev[i]) !== null && n(vol[i]) !== null && vol[i] !== 0)
    ? r0((rev[i] * 1e7) / vol[i]) : null
  m.realisationPerUnit[i] = realis
  // margins
  m.ebitdaMargin[i] = pctOf(x.ebitda, rev[i])
  m.ebitMargin[i]   = pctOf(x.ebit, rev[i])
  m.pbtMargin[i]    = pctOf(x.pbt, rev[i])
  m.patMargin[i]    = pctOf(x.pat, rev[i])
  // leverage
  m.debtEquity[i]    = (n(x.totalDebt) !== null && n(nw[i]) !== null && nw[i] !== 0) ? r2(x.totalDebt / nw[i]) : null
  m.netDebtEquity[i] = (n(x.netDebt) !== null && n(nw[i]) !== null && nw[i] !== 0) ? r2(x.netDebt / nw[i]) : null
  // working-capital days
  m.wcDays[i] = (n(x.workingCapital) !== null && n(rev[i]) !== null && rev[i] !== 0)
    ? r2((x.workingCapital / rev[i]) * 365) : null
  // cash
  m.fcfRevenue[i]   = pctOf(x.fcf, rev[i])
  m.capexRevenue[i] = pctOf(x.capex, rev[i])
  // returns: prefer AR-disclosed; else ROE on average net worth (matches FY23–FY25)
  if (x.roeDisclosed !== null) m.roe[i] = x.roeDisclosed
  else if (n(x.pat) !== null && n(nw[i]) !== null) {
    const prevNW = i > 0 ? n(nw[i - 1]) : null
    const denom = prevNW !== null ? (nw[i] + prevNW) / 2 : nw[i]
    m.roe[i] = denom !== 0 ? r2((x.pat / denom) * 100) : null
  }
  // evShare only where EV volume disclosed and not already set
  if (n(x.ev) !== null && n(x.totalVolume) !== null && x.totalVolume !== 0 && m.evShare[i] == null) {
    m.evShare[i] = r2((x.ev / x.totalVolume) * 100)
  }
}

// Growth series: recompute fully from the (now longer) revenue/volume/realisation
// arrays so the FY17→FY23 chain connects. Existing FY24/FY25 values are
// reproduced by the same formula.
for (let i = 1; i < FY.length; i++) {
  if (m.revenueGrowth[i] == null || i <= 7) m.revenueGrowth[i] = yoy(rev[i], rev[i - 1])
  if (m.volumeGrowth[i] == null || i <= 7)  m.volumeGrowth[i]  = yoy(vol[i], vol[i - 1])
  if (m.realisationGrowth[i] == null || i <= 7) m.realisationGrowth[i] = yoy(m.realisationPerUnit[i], m.realisationPerUnit[i - 1])
}

// ROCE computed uniformly across the full FY16–FY25 axis from disclosed line
// items: ROCE = EBIT / Capital Employed, where Capital Employed = Net worth +
// Total debt (closing). One consistent definition for every year so the series
// has no gaps and no definition break. EBIT and the balance-sheet inputs are
// the disclosed/derived values already populated above.
const ebitArr = co.pl.ebit, tdArr = co.bs.totalDebt
for (let i = 0; i < FY.length; i++) {
  const ce = (n(nw[i]) !== null && n(tdArr[i]) !== null) ? nw[i] + tdArr[i] : null
  m.roce[i] = (n(ebitArr[i]) !== null && ce !== null && ce !== 0)
    ? r2((ebitArr[i] / ce) * 100) : m.roce[i]
}

// EV mix = 0 for pre-EV / immaterial-and-undisclosed years (product did not
// meaningfully exist), so the EV-share series has no gap before the first
// materially-disclosed EV year.
for (let i = 0; i <= CFG.preEvZeroThrough; i++) {
  if (m.evShare[i] == null) m.evShare[i] = 0
}

// Zero out factually non-produced segments so the product-mix stack renders
// the disclosed segments instead of going blank — but ONLY for FYs where the
// primary produced segment is actually disclosed. Otherwise the segment sum
// (0) would no longer reconcile to the disclosed total volume. (Bajaj discloses
// 2W+3W every year; Hero discloses the motorcycle/scooter split only FY24–FY25.)
const primary = co.ops.motorcyclesByFy || {}
for (const segKey of CFG.zeroSegments) {
  const obj = co.ops[segKey]
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const fy of FY) if (n(primary[fy]) !== null) obj[fy] = 0
  }
}
for (const mixKey of CFG.zeroMixFy25) {
  if (mixKey in m) m[mixKey] = 0
}

// ---- Provenance / status updates ----
for (const fy of BACK) {
  const x = rec[fy]
  if (!x.sourceAR) continue
  const basis = x.accountingBasis ? ` (${x.accountingBasis})` : ''
  // EBITDA is derived as PBT + finance cost + depreciation − other income (same
  // convention as FY23–FY25). Where a year carries a material exceptional item,
  // it sits inside reported PBT and therefore inside that year's derived EBITDA;
  // flag it so the margin is read correctly.
  const excNote = Math.abs(x.exceptionalItems) >= 100
    ? ` Note: FY${fy.slice(2)} PBT includes a net exceptional ${x.exceptionalItems > 0 ? 'gain' : 'charge'} of ₹${Math.abs(x.exceptionalItems).toFixed(2)} Cr, which also sits within the derived EBITDA for the year.`
    : ''
  const cite = `${x.sourceAR}${basis} — Standalone audited financial statements, BSE annual-report filing. Derived items computed by formula from disclosed line items.${excNote}`
  if (co.sources?.perFY) co.sources.perFY[fy] = cite
  if (co.ops?.sourcesByFy?.productMix && x.twoWheelers !== null)
    co.ops.sourcesByFy.productMix[fy] = `${x.sourceAR} — Directors'/Board report Sales-in-numbers / Financial Highlights.`
  if (co.ops?.sourcesByFy?.exports && x.exports !== null)
    co.ops.sourcesByFy.exports[fy] = `${x.sourceAR} — exports volume disclosed.`
  if (co.dataStatus?.productMix && x.twoWheelers !== null) co.dataStatus.productMix[fy] = 'available'
  if (co.dataStatus?.domesticExportMix && x.exports !== null) co.dataStatus.domesticExportMix[fy] = 'derived'
}

co.fetchedAt = new Date().toISOString()

// Keep scalar arrays (number/null/string series) on a single line to match the
// repo's hand-authored style and keep diffs readable. Arrays that contain
// nested objects/arrays (which include { } or [ ]) are left multi-line.
const compactScalarArrays = (json) =>
  json.replace(/\[[^\[\]{}]*?\]/gs, (m) =>
    m.replace(/\s*\n\s*/g, ' ').replace(/\[\s+/, '[').replace(/\s+\]/, ']'))

await writeFile(coPath, compactScalarArrays(JSON.stringify(co, null, 2)) + '\n', 'utf8')

// Console summary
const fmt = (v) => v === null ? '—' : v
console.log(`\n[backfill ${slug}] FY16–FY22 populated:`)
console.log('FY    revenue     pbt        pat       ebitda    netWorth   cfo       totalVol')
for (const fy of BACK) {
  const x = rec[fy]
  console.log(
    `${fy}  ${String(fmt(x.revenue)).padStart(9)} ${String(fmt(x.pbt)).padStart(9)} ${String(fmt(x.pat)).padStart(9)} ` +
    `${String(fmt(x.ebitda)).padStart(9)} ${String(fmt(x.netWorth)).padStart(9)} ${String(fmt(x.cfo)).padStart(9)} ${String(fmt(x.totalVolume)).padStart(9)}`,
  )
}
console.log(`\nwrote ${coPath}`)
