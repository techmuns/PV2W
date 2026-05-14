#!/usr/bin/env node
/**
 * seed-tvs-2w-governance.mjs
 *
 * Fills the "Corporate & Market" / "Operations & Network" tab tiles
 * for TVS Motor that don't come from the annual press release or
 * Screener — KMP names, credit rating, manufacturing capacity, and
 * domestic 2W market share (sourced from CARE Ratings' published
 * rationale on TVS Motor).
 *
 * Writes into placeholder_data.json → segment_metrics with the same
 * schema used by every other 2W writer:
 *
 *   { segment_id:"2W", company:"TVS", fiscal_year, metric, value,
 *     source, source_url, last_updated }
 *
 * Sources cited per row.
 *
 * Usage:
 *   node scripts/seed-tvs-2w-governance.mjs
 *   node scripts/seed-tvs-2w-governance.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

const COMPANY = 'TVS';

/* Per-FY governance + operating cells. KMP names reflect who held
   the role at the close of each fiscal year (31 Mar). Sudarshan
   Venu became MD in May 2022 (so FY23 onwards) and Chairman in
   Aug 2025 (so FY26 onwards). Ralf Speth chaired until Aug 2025. */
const ROWS = {
  FY23: {
    ceo:           'K N Radhakrishnan',
    cfo:           'K Gopala Desikan',
    chairman:      'Sir Ralf Speth',
    capacity:      6400000,
  },
  FY24: {
    ceo:           'K N Radhakrishnan',
    cfo:           'K Gopala Desikan',
    chairman:      'Sir Ralf Speth',
    capacity:      6400000,
    market_share:  18.9,   // CARE Ratings (June 2025) — domestic 2W
    ev_market_share: 19.3,
  },
  FY25: {
    ceo:           'K N Radhakrishnan',
    cfo:           'K Gopala Desikan',
    chairman:      'Sir Ralf Speth',
    credit_rating: 'CARE AA+ / Stable',
    capacity:      6400000,
    market_share:  19.4,   // CARE Ratings (June 2025) — domestic 2W
    ev_market_share: 20.7,
  },
  FY26: {
    ceo:           'K N Radhakrishnan',
    cfo:           'K Gopala Desikan',
    chairman:      'Sudarshan Venu',           // chair effective 25 Aug 2025
    md:            'Sudarshan Venu',
    capacity:      6800000,                    // Hosur expansion live in FY26
  },
};

/* Per-row source pairings — kept here so the source label travels
   with the cell rather than being a blanket statement at file top. */
const SRC = {
  kmp: {
    label: 'TVS Motor board of directors + KMP filings (CEO disclosures, CFO appointments)',
    url:   'https://www.tvsmotor.com/about-us/board-of-directors',
  },
  chairman_old: {
    label: 'TVS Motor Annual Reports FY23-FY25 — Sir Ralf Speth, Chairman',
    url:   'https://www.tvsmotor.com/annual-report',
  },
  chairman_new: {
    label: 'TVS Motor PR — Sudarshan Venu appointed Chairman effective 25 Aug 2025',
    url:   'https://www.tvsmotor.com/media/press-release/tvs-motor-sudarshan-venu-appointed-chairman-august-2025',
  },
  credit: {
    label: 'CARE Ratings — TVS Motor Company Limited: CARE AA+; Stable / CARE A1+',
    url:   'https://www.careratings.com/upload/CompanyFiles/PR/202506140657_TVS_Motor_Company_Limited.pdf',
  },
  market_share: {
    label: 'CARE Ratings rationale (June 2025) — domestic 2W market share, ICE + EV',
    url:   'https://www.careratings.com/upload/CompanyFiles/PR/202506140657_TVS_Motor_Company_Limited.pdf',
  },
  capacity: {
    label: 'TVS Motor manufacturing capacity — Hosur + Mysore + Nalagarh plants (Indian + Indonesian press coverage of plant expansions)',
    url:   'https://www.autocarindia.com/bike-news/tvs-motor-to-add-15-million-units-of-manufacturing-capacity-in-next-12-months-439728',
  },
};

function upsert(data, row) {
  if (!Array.isArray(data.segment_metrics)) data.segment_metrics = [];
  const i = data.segment_metrics.findIndex(r =>
    r.segment_id  === row.segment_id  &&
    r.company     === row.company     &&
    r.fiscal_year === row.fiscal_year &&
    r.metric      === row.metric
  );
  if (i >= 0) {
    const e = data.segment_metrics[i];
    if (e.value === row.value && e.source_url === row.source_url) return false;
    data.segment_metrics[i] = { ...e, ...row };
    return true;
  }
  data.segment_metrics.push(row);
  return true;
}

function write(data, fy, metric, value, src) {
  if (value == null || value === '') return 0;
  return upsert(data, {
    segment_id:   '2W',
    company:      COMPANY,
    fiscal_year:  fy,
    metric,
    value,
    source:       src.label,
    source_url:   src.url,
    last_updated: TODAY,
  }) ? 1 : 0;
}

function main() {
  console.log('[seed-tvs-2w-governance] starting…');
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let writes = 0;

  for (const [fy, r] of Object.entries(ROWS)) {
    if (r.ceo)              writes += write(data, fy, 'CEO',                 r.ceo,              SRC.kmp);
    if (r.cfo)              writes += write(data, fy, 'CFO',                 r.cfo,              SRC.kmp);
    if (r.md)               writes += write(data, fy, 'MD',                  r.md,               SRC.chairman_new);
    if (r.chairman)         writes += write(data, fy, 'Chairman',            r.chairman,
                              (fy === 'FY26' ? SRC.chairman_new : SRC.chairman_old));
    if (r.credit_rating)    writes += write(data, fy, 'Credit Rating',       r.credit_rating,    SRC.credit);
    if (r.capacity)         writes += write(data, fy, 'Capacity (units)',    r.capacity,         SRC.capacity);
    if (r.market_share)     writes += write(data, fy, 'Market Share %',      r.market_share,     SRC.market_share);
    if (r.ev_market_share)  writes += write(data, fy, 'EV Market Share %',   r.ev_market_share,  SRC.market_share);
  }

  console.log(`[seed-tvs-2w-governance] ${writes} cell(s) written/updated`);

  if (DRY_RUN) {
    console.log('[seed-tvs-2w-governance] --dry-run: not writing.');
    return;
  }
  if (writes === 0) {
    console.log('[seed-tvs-2w-governance] No updates — leaving placeholder_data.json untouched.');
    return;
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[seed-tvs-2w-governance] Wrote ${writes} update(s) to ${path.relative(process.cwd(), DATA_PATH)}`);
}

main();
