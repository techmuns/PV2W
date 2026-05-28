#!/usr/bin/env node
// Add installed-capacity + capacity-utilisation metrics to each OEM JSON.
//
// Capacity (vehicles/year) is from each OEM's annual reports (MD&A / capitals
// snapshot), parsed in data/raw-capacity.json — except TVS, whose capacity is
// not in the AR text available here and is taken from TVS investor/trade-press
// disclosure (~6.8M units/yr across Hosur + Mysuru + Nalagarh + Karawang;
// expanding toward 8.3M) and flagged approximate.
//
// Capacity Utilisation % = total sales volume / installed capacity (approximate
// — sales used as a production proxy). Only computed where both are disclosed.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FY = ['FY16','FY17','FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25']

const raw = JSON.parse(await readFile(join(ROOT, 'data/raw-capacity.json'), 'utf8'))

// Capacity by company by FY (units/year). TVS added from IR/press (approximate):
// current installed base ~6.8M applies to FY24 and FY25 (the +1.5M expansion to
// 8.3M is planned for FY27, so capacity is flat across FY24-FY25).
const CAP = {
  tvs:    { FY24: 6800000, FY25: 6800000 },
  bajaj:  raw.bajaj,
  hero:   raw.hero,
  eicher: raw.eicher,
  ola:    raw.ola,
}

const r1 = (v) => Number(v.toFixed(1))
const compact = (json) =>
  json.replace(/\[[^\[\]{}]*?\]/gs, (m) => m.replace(/\s*\n\s*/g, ' ').replace(/\[\s+/, '[').replace(/\s+\]/, ']'))

for (const id of ['tvs','bajaj','hero','eicher','ola']) {
  const p = join(ROOT, `src/data/companies/${id}.json`)
  const co = JSON.parse(await readFile(p, 'utf8'))
  const capObj = CAP[id] || {}
  const vol = co.ops?.totalVolume || []

  const capacity = FY.map((fy) => (typeof capObj[fy] === 'number' ? capObj[fy] : null))
  const capacityUtilisation = FY.map((fy, i) => {
    const c = capacity[i]
    const v = typeof vol[i] === 'number' ? vol[i] : null
    return (typeof c === 'number' && c > 0 && typeof v === 'number') ? r1((v / c) * 100) : null
  })

  co.metrics = { ...(co.metrics || {}), capacity, capacityUtilisation }
  await writeFile(p, compact(JSON.stringify(co, null, 2)) + '\n', 'utf8')
  console.log(`${id.padEnd(7)} capacity:`, JSON.stringify(capacity))
  console.log(`${' '.repeat(7)} util %  :`, JSON.stringify(capacityUtilisation))
}

console.log('\nwrote capacity + capacityUtilisation into 5 OEM JSONs')
