// Two-Wheeler dashboard data.
//
// TVS is built from the uploaded audited annual-report workbook
// (src/data/companies/tvs.json) — every populated cell is real and cited.
// All other companies are intentionally left blank (no placeholders) until
// their own audited workbook is provided. The UI renders these as 'Pending'
// — same chrome, no synthetic numbers.

import { buildFromActuals } from './data/buildFromActuals.js'
import { buildIndustry } from './data/buildIndustry.js'
import { buildSupportingGroups } from './data/supportingBuilder.js'
import { mapScreenerToCompany } from './data/mapScreenerToCompany.js'
import tvsRaw    from './data/companies/tvs.json'
import bajajRaw  from './data/companies/bajaj.json'
import heroRaw   from './data/companies/hero.json'
import eicherRaw from './data/companies/eicher.json'
import olaRaw    from './data/companies/ola.json'
// Auto-fetched Screener sidecars — used when the curated JSON has no
// financials yet. Eagerly imported so Vite can bundle them; the file
// always exists (the fetch script seeds it). If the workflow hasn't run
// yet the sidecar is the seed shape and mapScreenerToCompany returns null,
// which makes us fall back to the skeleton.
import bajajScr  from './data/companies/_screener/bajaj.json'
import heroScr   from './data/companies/_screener/hero.json'
import eicherScr from './data/companies/_screener/eicher.json'
import olaScr    from './data/companies/_screener/ola.json'

const FY_AXIS = ['FY16', 'FY17', 'FY18', 'FY19', 'FY20', 'FY21', 'FY22', 'FY23', 'FY24', 'FY25', 'FY26', 'FY27']

// ---------- TVS (real, audited) ----------
const tvs = {
  ...buildFromActuals(tvsRaw, {
    id: 'tvs',
    name: 'TVS Motor Company Ltd',
    publicName: 'TVS',
    shortName: 'TVS',
    brandText: 'TVS',
    brandColor: '#0066B3',
    dotColor: '#0ea5e9',
    marketShareKey: 'TVS',
    sourceShort: 'Annual reports',
  }),
  supportingGroups: buildSupportingGroups(tvsRaw, { shortName: 'TVS', publicName: 'TVS', marketShareKey: 'TVS' }),
}

// ---------- Industry (built from SIAM + Vahan + FADA JSONs) ----------
const industry = buildIndustry()

// Per-OEM build helper. Resolves the source JSON in priority order:
//   1. Curated workbook  src/data/companies/<id>.json  (richest — AR-extracted)
//   2. Screener sidecar  src/data/companies/_screener/<id>.json  (financials only)
//   3. Empty skeleton    -> all-Pending state
// The Screener sidecar's flat shape is run through mapScreenerToCompany()
// to produce the same { pl, bs, cf, metrics, ... } shape buildFromActuals
// expects.
const buildOem = (raw, screener, opts) => {
  const curatedHasData = raw?.fyAxis?.length && raw?.pl && Object.keys(raw.pl).length
  let source = raw
  if (!curatedHasData && screener) {
    const mapped = mapScreenerToCompany(screener, { name: opts.name, shortName: opts.shortName })
    if (mapped) {
      source = mapped
      // Overlay curated operational data on top of the Screener financials.
      // Screener carries P&L / BS / CF only — no volumes — so when the curated
      // <id>.json supplies an `ops` block (AR-sourced unit volumes / segment
      // splits / exports) or a `profile`, merge it in so the performance and
      // mix charts render while the audited Screener financials are preserved.
      const hasOps = raw?.ops && Object.keys(raw.ops).length
      const hasProfile = raw?.profile && Object.keys(raw.profile).length
      if (hasOps || hasProfile) {
        source = {
          ...mapped,
          ops: hasOps ? { ...mapped.ops, ...raw.ops } : mapped.ops,
          metrics: { ...mapped.metrics, ...(raw.metrics || {}) },
          dataStatus: { ...(mapped.dataStatus || {}), ...(raw.dataStatus || {}) },
          profile: hasProfile ? raw.profile : mapped.profile,
          na: raw.na?.length ? raw.na : mapped.na,
          sources: {
            ...mapped.sources,
            ...(raw.sources?.primary ? { primary: raw.sources.primary } : {}),
            notes: raw.sources?.notes || mapped.sources?.notes,
            perFY: { ...(mapped.sources?.perFY || {}), ...(raw.sources?.perFY || {}) },
          },
        }
      }
    }
  }
  return {
    ...buildFromActuals(source, opts),
    supportingGroups: buildSupportingGroups(source, {
      shortName: opts.shortName,
      publicName: opts.publicName,
      marketShareKey: opts.marketShareKey,
    }),
  }
}

const bajaj = buildOem(bajajRaw, bajajScr, {
  id: 'bajaj',
  name: 'Bajaj Auto Ltd',
  publicName: 'Bajaj Auto',
  shortName: 'Bajaj',
  brandText: 'BAJAJ',
  brandColor: '#003DA5',
  dotColor: '#1d4ed8',
  marketShareKey: 'Bajaj Auto',
  sourceShort: 'Annual reports',
  logo: { path: '/logos/bajaj-auto.svg', fallbackPath: '/logos/bajaj-auto.png' },
})

const hero = buildOem(heroRaw, heroScr, {
  id: 'hero',
  name: 'Hero MotoCorp Ltd',
  publicName: 'Hero MotoCorp',
  shortName: 'Hero',
  brandText: 'HERO',
  brandColor: '#E11D48',
  dotColor: '#dc2626',
  marketShareKey: 'Hero MotoCorp',
  sourceShort: 'Annual reports',
  logo: { path: '/logos/hero-motocorp.svg', fallbackPath: '/logos/hero-motocorp.png' },
})

const eicher = buildOem(eicherRaw, eicherScr, {
  id: 'eicher',
  name: 'Eicher Motors / Royal Enfield',
  publicName: 'Eicher / Royal Enfield',
  shortName: 'Royal Enfield',
  brandText: 'ROYAL ENFIELD',
  brandColor: '#7B3F00',
  dotColor: '#b45309',
  marketShareKey: 'Royal Enfield',
  sourceShort: 'Annual reports · Exchange filings',
  logo: { path: '/logos/royal-enfield.svg', fallbackPath: '/logos/eicher.svg' },
})

const ola = buildOem(olaRaw, olaScr, {
  id: 'ola',
  name: 'Ola Electric Mobility Ltd',
  publicName: 'Ola Electric',
  shortName: 'Ola',
  brandText: 'OLA',
  brandColor: '#16A34A',
  dotColor: '#16a34a',
  marketShareKey: 'Ola Electric',
  sourceShort: 'Annual reports · Exchange filings',
  logo: { path: '/logos/ola-electric.svg', fallbackPath: '/logos/ola-electric.png' },
})

export const FY = FY_AXIS
export const COMPANIES = [industry, tvs, bajaj, hero, eicher, ola]
export const SUPPORT_BLOCKS = ['Growth', 'Margins', 'Balance Sheet', 'Cash Flow', 'Product Mix', 'Market Share']

export const SECTOR_META = {
  title: 'Two-Wheeler Industry Cockpit',
  subtitle: 'Auto sector research · segment switcher',
  badge: '2W',
  latestFy: 'FY25',
  footer: 'Source: Annual reports · Exchange filings · Vahan · FADA',
}
