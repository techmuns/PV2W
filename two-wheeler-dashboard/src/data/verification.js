// Per-company verification roll-up. Reads each underlying JSON's `verification`
// block and produces a single status that the UI can show honestly.
//
// Status hierarchy:
//   audited     → primary source seen this build (verifiedAgainstPrimary === true)
//   approximate → values derived from training data / analyst notes; not freshly
//                 fetched. Visible amber pill + reason in the Data Quality panel.
//   pending     → no data at all yet.

import volumeGrowth from './industry/2w-domestic-volume-growth.json'
import segmentMix   from './industry/2w-segment-mix.json'
import evShare      from './industry/2w-ev-share.json'
import exports2W    from './industry/2w-exports.json'
import marketShare  from './industry/2w-market-share.json'
import tvsRaw       from './companies/tvs.json'
import bajajRaw     from './companies/bajaj.json'
import heroRaw      from './companies/hero.json'
import eicherRaw    from './companies/eicher.json'
import olaRaw       from './companies/ola.json'

const RANK = { audited: 3, approximate: 2, pending: 1 }

export const SOURCE_VERIFICATIONS = [
  { key: 'siam-volume',  label: 'SIAM — 2W Domestic Volume Growth', file: 'src/data/industry/2w-domestic-volume-growth.json', meta: volumeGrowth.verification, source: volumeGrowth.source, sourceUrl: volumeGrowth.sourceUrl, scope: 'Industry' },
  { key: 'siam-segment', label: 'SIAM — Body-Type Segment Mix',     file: 'src/data/industry/2w-segment-mix.json',            meta: segmentMix.verification,   source: segmentMix.source,   sourceUrl: segmentMix.sourceUrl,   scope: 'Industry' },
  { key: 'vahan-ev',     label: 'Vahan — EV 2W Share',              file: 'src/data/industry/2w-ev-share.json',               meta: evShare.verification,      source: evShare.source,      sourceUrl: evShare.sourceUrl,      scope: 'Industry' },
  { key: 'siam-exports', label: 'SIAM — 2W Exports',                file: 'src/data/industry/2w-exports.json',                meta: exports2W.verification,    source: exports2W.source,    sourceUrl: exports2W.sourceUrl,    scope: 'Industry' },
  { key: 'siam-share',   label: 'SIAM — OEM Market Share',          file: 'src/data/industry/2w-market-share.json',           meta: marketShare.verification,  source: marketShare.source,  sourceUrl: marketShare.sourceUrl,  scope: 'Industry' },

  { key: 'tvs-actuals',    label: 'TVS Motor — Standalone Audited FY16–FY25',  file: 'src/data/companies/tvs.json',    meta: tvsRaw.verification,    source: tvsRaw.sources?.primary,    sourceUrl: null, scope: 'tvs' },
  { key: 'bajaj-actuals',  label: 'Bajaj Auto — Standalone Audited FY16–FY25', file: 'src/data/companies/bajaj.json',  meta: bajajRaw.verification,  source: bajajRaw.sources?.primary,  sourceUrl: null, scope: 'bajaj' },
  { key: 'hero-actuals',   label: 'Hero MotoCorp — Standalone Audited FY16–FY25', file: 'src/data/companies/hero.json',   meta: heroRaw.verification,   source: heroRaw.sources?.primary,   sourceUrl: null, scope: 'hero' },
  { key: 'eicher-actuals', label: 'Eicher Motors — Standalone Audited FY16–FY25', file: 'src/data/companies/eicher.json', meta: eicherRaw.verification, source: eicherRaw.sources?.primary, sourceUrl: null, scope: 'eicher' },
  { key: 'ola-actuals',    label: 'Ola Electric — Standalone Audited FY22–FY25', file: 'src/data/companies/ola.json',    meta: olaRaw.verification,    source: olaRaw.sources?.primary,    sourceUrl: null, scope: 'ola' },
]

export function verificationsForCompany(companyId) {
  if (companyId === 'industry') {
    return SOURCE_VERIFICATIONS.filter((v) => v.scope === 'Industry')
  }
  // Per-OEM view shows that OEM's workbook entry.
  return SOURCE_VERIFICATIONS.filter((v) => v.scope === companyId)
}

export function rollupStatus(verifications) {
  if (!verifications.length) return { status: 'pending', counts: { audited: 0, approximate: 0, pending: 0 } }
  const counts = { audited: 0, approximate: 0, pending: 0 }
  verifications.forEach((v) => {
    const s = v.meta?.status || 'pending'
    if (counts[s] !== undefined) counts[s]++
  })
  // The worst (lowest) status defines the rollup — be conservative.
  const present = Object.keys(counts).filter((k) => counts[k] > 0).sort((a, b) => RANK[a] - RANK[b])
  const status = present[0] || 'pending'
  return { status, counts }
}

const STATUS_LABEL = {
  audited:     'Audited',
  approximate: 'Approximate',
  pending:     'Pending',
}

const STATUS_TONE = {
  audited:     { bg: '#E1F0E2', fg: '#1F5C28', border: '#A8D8AE' },
  approximate: { bg: '#FBEFDC', fg: '#7C3A07', border: '#F5C97A' },
  pending:     { bg: '#EEF1F5', fg: '#475569', border: '#CBD5E1' },
}

export const statusLabel = (s) => STATUS_LABEL[s] || 'Unknown'
export const statusTone  = (s) => STATUS_TONE[s] || STATUS_TONE.pending
