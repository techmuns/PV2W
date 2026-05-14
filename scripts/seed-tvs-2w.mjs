#!/usr/bin/env node
/**
 * seed-tvs-2w.mjs
 *
 * One-off seed of TVS Motor Company FY24/FY25/FY26 numbers into
 * placeholder_data.json → segment_metrics, in the schema that
 * segments_config.json._dataSchema documents and that the rest of
 * the 2W fetchers (scripts/fetch-2w-press.mjs, fetch-2w-stock.mjs)
 * write to:
 *
 *   { segment_id:"2W", company:"TVS", fiscal_year, metric, value,
 *     source, source_url, last_updated }
 *
 * Numbers below are transcribed verbatim from TVS Motor's official
 * full-year press releases:
 *
 *   FY24 + FY25 — "TVS Motor records highest ever Sales, EBITDA
 *     margin and Profits in FY 2024-25" (28 Apr 2025).
 *     https://www.tvsmotor.com/media/press-release/tvs-motor-records-highest-ever-sales
 *
 *   FY26       — "TVS Motor Records 30% Growth in Revenue and 40%
 *     Growth in Operating PBT in FY 2025-26" (14 May 2026).
 *     https://www.tvsmotor.com/media-centre/press-releases
 *
 * The unified fetcher (fetch-2w-press.mjs) is the right long-term
 * home for these numbers — once TVS publishes a stable PDF URL per
 * year, those will land via the regex parser. Until then, this seed
 * keeps the dashboard tiles "Live" rather than "Pending".
 *
 * Idempotent. Skips any metric whose inputs are null.
 *
 * Usage:
 *   node scripts/seed-tvs-2w.mjs
 *   node scripts/seed-tvs-2w.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);

const COMPANY = 'TVS';
const SRC_25  = 'TVS Motor Company FY 2024-25 annual press release (28 Apr 2025)';
const URL_25  = 'https://www.tvsmotor.com/media/press-release/tvs-motor-records-highest-ever-sales';
const SRC_26  = 'TVS Motor Company FY 2025-26 annual press release (14 May 2026)';
const URL_26  = 'https://www.tvsmotor.com/media-centre/press-releases';

/* Volumes are in absolute units (the press release prints them in
   "Lakh units" — we multiply by 1e5 here). Financials are in ₹ Cr.
   Margins are in percent. Nulls are deliberate where TVS does not
   disclose the field at full-year cadence. */
const ROWS = {
  FY24: {
    /* Sourced from the FY25 release's prior-year comparative column. */
    total_volume:        4191000,   // 41.91 lakh — 2W + 3W combined
    twowheeler_volume:   3851000,   // 38.51 lakh — 2W only
    motorcycle_volume:   1990000,   // 19.90 lakh
    scooter_volume:      1570000,   // 15.70 lakh
    ev_volume:           194000,    // 1.94 lakh — electric 2W (within scooter mix)
    export_volume:       1013000,   // 10.13 lakh — exports (2W + 3W combined)
    revenue_cr:          31776,
    ebitda_margin_pct:   11.1,
    src:                 SRC_25,
    url:                 URL_25,
  },
  FY25: {
    total_volume:        4744000,   // 47.44 lakh — 2W + 3W combined
    twowheeler_volume:   4330000,   // 43.30 lakh
    motorcycle_volume:   2195000,   // 21.95 lakh
    scooter_volume:      1904000,   // 19.04 lakh
    ev_volume:           279000,    // 2.79 lakh
    export_volume:       1195000,   // 11.95 lakh
    revenue_cr:          36251,
    ebitda_margin_pct:   12.3,
    operating_pbt_cr:    3563,
    src:                 SRC_25,
    url:                 URL_25,
  },
  FY26: {
    total_volume:        5889000,   // 58.89 lakh — 2W + 3W combined
    motorcycle_volume:   2713000,   // 27.13 lakh
    scooter_volume:      2413000,   // 24.13 lakh
    ev_volume:           371000,    // 3.71 lakh
    threewheeler_volume: 219000,    // 2.19 lakh (only disclosed in FY26 PR)
    /* TVS FY26 press release does not break out a clean 2W-only
       total. Skipping twowheeler_volume avoids derived-metric drift. */
    revenue_cr:          47270,
    ebitda_margin_pct:   12.9,
    operating_pbt_cr:    4975,
    src:                 SRC_26,
    url:                 URL_26,
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

function write(data, fy, metric, value, srcLabel, srcUrl) {
  if (value == null) return 0;
  return upsert(data, {
    segment_id:   '2W',
    company:      COMPANY,
    fiscal_year:  fy,
    metric,
    value,
    source:       srcLabel,
    source_url:   srcUrl,
    last_updated: TODAY,
  }) ? 1 : 0;
}

function round1(x) { return Math.round(x * 10) / 10; }

function main() {
  console.log('[seed-tvs-2w] starting…');
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let writes = 0;

  for (const [fy, r] of Object.entries(ROWS)) {
    /* Absolute cells — same metric names as fetch-2w-press.mjs. */
    writes += write(data, fy, 'Total Sales Volume',  r.total_volume,        r.src, r.url);
    writes += write(data, fy, 'Two-Wheeler Volume',  r.twowheeler_volume,   r.src, r.url);
    writes += write(data, fy, 'Motorcycle Volume',   r.motorcycle_volume,   r.src, r.url);
    writes += write(data, fy, 'Scooter Volume',      r.scooter_volume,      r.src, r.url);
    writes += write(data, fy, 'EV Volume',           r.ev_volume,           r.src, r.url);
    writes += write(data, fy, 'Three-Wheeler Volume',r.threewheeler_volume, r.src, r.url);
    writes += write(data, fy, 'Export Volume',       r.export_volume,       r.src, r.url);
    if (r.total_volume != null && r.export_volume != null) {
      const dom = r.total_volume - r.export_volume;
      writes += write(data, fy, 'Domestic Volume',   dom,                   r.src, r.url);
    }
    writes += write(data, fy, 'Revenue (Rs Cr)',     r.revenue_cr,          r.src, r.url);
    writes += write(data, fy, 'EBITDA Margin %',     r.ebitda_margin_pct,   r.src, r.url);
    writes += write(data, fy, 'Operating PBT (Rs Cr)', r.operating_pbt_cr,  r.src, r.url);

    /* Mix cells expressed as % — denominators per segments_config. */
    if (r.export_volume != null && r.total_volume) {
      writes += write(data, fy, 'Export Volume %',
        round1((r.export_volume / r.total_volume) * 100), r.src, r.url);
    }
    if (r.motorcycle_volume != null && r.twowheeler_volume) {
      writes += write(data, fy, 'Motorcycle Volume %',
        round1((r.motorcycle_volume / r.twowheeler_volume) * 100), r.src, r.url);
    }
    if (r.ev_volume != null && r.twowheeler_volume) {
      const v = round1((r.ev_volume / r.twowheeler_volume) * 100);
      writes += write(data, fy, 'EV Mix %',     v, r.src, r.url);
      writes += write(data, fy, 'EV Volume %',  v, r.src, r.url);
    }
  }

  /* YoY derived metrics — only across consecutive FYs we hold. */
  const fys = Object.keys(ROWS);
  for (let i = 1; i < fys.length; i++) {
    const cur = fys[i], prev = fys[i - 1];
    const ec = ROWS[cur], ep = ROWS[prev];

    if (ec.total_volume && ep.total_volume) {
      writes += write(data, cur, 'Volume Growth %',
        round1((ec.total_volume / ep.total_volume - 1) * 100),
        ec.src, ec.url);
    }
    if (ec.revenue_cr && ep.revenue_cr) {
      writes += write(data, cur, 'Revenue Growth %',
        round1((ec.revenue_cr / ep.revenue_cr - 1) * 100),
        ec.src, ec.url);
    }
    if (ec.revenue_cr && ep.revenue_cr && ec.total_volume && ep.total_volume) {
      const curReal  = ec.revenue_cr / ec.total_volume;
      const prevReal = ep.revenue_cr / ep.total_volume;
      writes += write(data, cur, 'Realisation Growth %',
        round1((curReal / prevReal - 1) * 100),
        ec.src, ec.url);
    }
  }

  console.log(`[seed-tvs-2w] ${writes} cell(s) written/updated`);

  if (DRY_RUN) {
    console.log('[seed-tvs-2w] --dry-run: not writing.');
    return;
  }
  if (writes === 0) {
    console.log('[seed-tvs-2w] No updates — leaving placeholder_data.json untouched.');
    return;
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`[seed-tvs-2w] Wrote ${writes} update(s) to ${path.relative(process.cwd(), DATA_PATH)}`);
}

main();
