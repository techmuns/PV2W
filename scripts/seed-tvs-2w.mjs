#!/usr/bin/env node
/**
 * seed-tvs-2w.mjs
 *
 * Historical seed of TVS Motor Company (standalone India 2W + 3W
 * business) numbers into placeholder_data.json → segment_metrics,
 * in the schema documented at segments_config.json._dataSchema and
 * shared with the rest of the 2W fetchers (fetch-2w-press.mjs,
 * fetch-2w-stock.mjs):
 *
 *   { segment_id:"2W", company:"TVS", fiscal_year, metric, value,
 *     source, source_url, last_updated }
 *
 * Each fiscal year's row is transcribed from the TVS Motor full-year
 * press release that closed that year (or — for FY16/FY17 — picked
 * up from a subsequent year's comparative column when the original
 * PR URL is no longer reachable). All figures are STANDALONE TVS
 * Motor India — that's the basis TVS itself markets in its annual
 * press releases and the right basis for an India 2W-segment
 * cockpit. Consolidated revenue/PAT (which include Norton, TVS
 * Singapore, electric subsidiary etc.) are intentionally NOT used.
 *
 * Press-release URL trail:
 *   FY16: TVS PR — "revenue growth of 12% in FY 2015-16"
 *   FY17: TVS PR — "revenue grows by 9.6% and PAT by 14.1% in FY 2016-17"
 *   FY18: cited via FY19 PR comparative
 *   FY19: TVS PR — "revenue grew by 19.3% … in FY 2018-19"
 *   FY20: cited via FY21 PR comparative
 *   FY21: TVS PR — "Operating EBITDA increases to 8.5%"
 *   FY22: TVS PR — "highest ever turnover and profit during FY 2021-22"
 *   FY23: TVS PR — "Achieves record Revenue and Profit during FY 2022-23"
 *   FY24/FY25: TVS PR — "records highest ever Sales, EBITDA margin
 *               and Profits in FY 2024-25" (28 Apr 2025)
 *   FY26: TVS PR — "30% Growth in Revenue and 40% Growth in
 *               Operating PBT in FY 2025-26" (14 May 2026)
 *
 * Skips any metric whose press release does not state it (no
 * guessing, no consolidated-vs-standalone mixing). Idempotent —
 * re-running only writes when a value or source-tag changes.
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

const COMPANY  = 'TVS';
const SRC_HOME = 'https://www.tvsmotor.com/investors/financial-reports';

/* Per-FY press-release URLs we cite as source. Where the original
   PR URL has rotted out of tvsmotor.com's CMS we cite the IR home
   plus the next year's comparative-column PR that quotes the
   prior-year number verbatim. */
const SRC = {
  FY16: { label: 'TVS Motor FY 2015-16 annual press release',
          url:   'https://www.tvsmotor.com/investors/financial-reports' },
  FY17: { label: 'TVS Motor FY 2016-17 annual press release',
          url:   'https://www.tvsmotor.com/investors/financial-reports' },
  FY18: { label: 'TVS Motor FY 2017-18 results — cited via FY 2018-19 PR comparative column',
          url:   'https://www.tvsmotor.com/media/press-release/tvs-motor-companys-revenue-grew-by-193percent-operating-ebitda-grew-by-22percent-total-sales-grew-by-129percent-in-fy-2018-19' },
  FY19: { label: 'TVS Motor FY 2018-19 annual press release',
          url:   'https://www.tvsmotor.com/media/press-release/tvs-motor-companys-revenue-grew-by-193percent-operating-ebitda-grew-by-22percent-total-sales-grew-by-129percent-in-fy-2018-19' },
  FY20: { label: 'TVS Motor FY 2019-20 results — cited via FY 2020-21 PR comparative column',
          url:   'https://www.tvsmotor.com/investors/financial-reports' },
  FY21: { label: 'TVS Motor FY 2020-21 annual press release',
          url:   'https://www.tvsmotor.com/investors/financial-reports' },
  FY22: { label: 'TVS Motor FY 2021-22 annual press release',
          url:   'https://www.tvsmotor.com/media/press-release/tvs-motor-company-registers-highest-ever-turnover-and-profit-during-fy-2021-22' },
  FY23: { label: 'TVS Motor FY 2022-23 annual press release',
          url:   'https://www.tvsmotor.com/media/press-release/tvs-motor-company-achieves-record-revenue-and-profit-during-fy-2022-23' },
  FY24: { label: 'TVS Motor FY 2024-25 annual press release (FY24 comparative column)',
          url:   'https://www.tvsmotor.com/media/press-release/tvs-motor-records-highest-ever-sales' },
  FY25: { label: 'TVS Motor FY 2024-25 annual press release (28 Apr 2025)',
          url:   'https://www.tvsmotor.com/media/press-release/tvs-motor-records-highest-ever-sales' },
  FY26: { label: 'TVS Motor FY 2025-26 annual press release (14 May 2026)',
          url:   'https://www.tvsmotor.com/media-centre/press-releases' },
};

/* Volumes are absolute units (the PR prints in "Lakh units" — we
   multiply by 1e5). Financials are in ₹ Cr. Margins are in percent.
   `null` ⇒ TVS did not disclose the field at full-year cadence in
   the cited PR and we refuse to guess. */
const ROWS = {
  FY16: {
    total_volume:        2568000,   // 25.68 lakh — 2W + 3W combined
    motorcycle_volume:   1017000,   // 10.17 lakh
    scooter_volume:      813000,    // 8.13 lakh
    threewheeler_volume: 111000,    // 1.11 lakh
    export_volume:       454000,    // 4.54 lakh — incl 3W
    twowheeler_volume:   null,      // not split out at this vintage
    ev_volume:           null,
    revenue_cr:          11244,
    ebitda_margin_pct:   null,
    operating_pbt_cr:    null,
    pat_cr:              432,
  },
  FY17: {
    total_volume:        2927000,   // 29.27 lakh
    motorcycle_volume:   null,
    scooter_volume:      null,
    threewheeler_volume: null,
    export_volume:       null,
    twowheeler_volume:   null,
    ev_volume:           null,
    revenue_cr:          13363,
    ebitda_margin_pct:   null,
    operating_pbt_cr:    null,
    pat_cr:              null,      // PR cites "+14.1%" growth, not absolute
  },
  FY18: {
    total_volume:        3466000,   // 2W (33.67L) + 3W (0.99L)
    twowheeler_volume:   3367000,   // 33.67 lakh
    motorcycle_volume:   1356000,   // 13.56 lakh
    scooter_volume:      1135000,   // 11.35 lakh
    threewheeler_volume: 99000,
    export_volume:       null,
    ev_volume:           null,
    revenue_cr:          15274,
    ebitda_margin_pct:   7.7,       // 1,175 / 15,274
    operating_pbt_cr:    null,
    pat_cr:              663,
  },
  FY19: {
    twowheeler_volume:   3757000,   // 37.57 lakh — 2W incl exports
    motorcycle_volume:   1559000,   // 15.59 lakh
    scooter_volume:      1301000,   // 13.01 lakh
    threewheeler_volume: null,
    total_volume:        null,
    export_volume:       null,
    ev_volume:           null,
    revenue_cr:          18218,     // 18,217.5
    ebitda_margin_pct:   7.9,       // 1,433.3 / 18,217.5
    operating_pbt_cr:    null,
    pat_cr:              670,
  },
  FY20: {
    motorcycle_volume:   1364000,   // 13.64 lakh
    scooter_volume:      1075000,   // 10.75 lakh
    threewheeler_volume: 174000,    // 1.74 lakh
    export_volume:       841000,    // 8.41 lakh — total exports
    twowheeler_volume:   null,
    total_volume:        null,
    ev_volume:           null,
    revenue_cr:          16423,
    ebitda_margin_pct:   8.2,
    operating_pbt_cr:    754,
    pat_cr:              592,
  },
  FY21: {
    motorcycle_volume:   1342000,   // 13.42 lakh
    scooter_volume:      961000,    // 9.61 lakh
    threewheeler_volume: 124000,    // 1.24 lakh
    export_volume:       879000,    // 8.79 lakh
    twowheeler_volume:   null,
    total_volume:        null,
    ev_volume:           null,
    revenue_cr:          16751,
    ebitda_margin_pct:   8.5,
    operating_pbt_cr:    826,
    pat_cr:              612,
  },
  FY22: {
    total_volume:        3310000,   // 33.10 lakh — 2W + 3W
    motorcycle_volume:   1732000,   // 17.32 lakh
    scooter_volume:      923000,    // 9.23 lakh
    threewheeler_volume: null,
    export_volume:       1253000,   // 12.53 lakh — total international
    twowheeler_volume:   null,
    ev_volume:           11000,     // 0.11 lakh
    revenue_cr:          20791,
    ebitda_margin_pct:   9.4,
    operating_pbt_cr:    1243,
    pat_cr:              894,
  },
  FY23: {
    total_volume:        3682000,   // 36.82 lakh
    motorcycle_volume:   1733000,
    scooter_volume:      1334000,
    threewheeler_volume: 169000,
    export_volume:       null,
    twowheeler_volume:   null,
    ev_volume:           97000,     // 0.97 lakh
    revenue_cr:          26378,
    ebitda_margin_pct:   10.1,
    operating_pbt_cr:    2003,
    pat_cr:              1491,
  },
  FY24: {
    total_volume:        4191000,   // 41.91 lakh
    twowheeler_volume:   3851000,   // 38.51 lakh
    motorcycle_volume:   1990000,
    scooter_volume:      1570000,
    threewheeler_volume: null,      // not consistently disclosed
    ev_volume:           194000,
    export_volume:       1013000,
    revenue_cr:          31776,
    ebitda_margin_pct:   11.1,
    operating_pbt_cr:    null,
    pat_cr:              2083,
  },
  FY25: {
    total_volume:        4744000,   // 47.44 lakh
    twowheeler_volume:   4330000,   // 43.30 lakh
    motorcycle_volume:   2195000,
    scooter_volume:      1904000,
    threewheeler_volume: 135000,
    ev_volume:           279000,
    export_volume:       1195000,
    revenue_cr:          36251,
    ebitda_margin_pct:   12.3,
    operating_pbt_cr:    3563,
    pat_cr:              2711,
  },
  FY26: {
    total_volume:        5889000,   // 58.89 lakh
    motorcycle_volume:   2713000,
    scooter_volume:      2413000,
    threewheeler_volume: 219000,
    ev_volume:           371000,
    /* FY26 PR doesn't restate a clean 2W-only total — skip. */
    twowheeler_volume:   null,
    /* PR-disclosed FY26 export figure looked inconsistent vs FY25
       (likely a quarterly cut). Skip until the AR confirms. */
    export_volume:       null,
    revenue_cr:          47270,
    ebitda_margin_pct:   12.9,
    operating_pbt_cr:    4975,
    pat_cr:              null,      // PR only gives consolidated PAT
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

const round1 = x => Math.round(x * 10) / 10;

function main() {
  console.log('[seed-tvs-2w] starting…');
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let writes = 0;

  for (const [fy, r] of Object.entries(ROWS)) {
    const s = SRC[fy];
    if (!s) { console.warn(`  no SRC entry for ${fy}, skipping`); continue; }

    /* Absolute cells — metric names align with fetch-2w-press.mjs. */
    writes += write(data, fy, 'Total Sales Volume',     r.total_volume,        s.label, s.url);
    writes += write(data, fy, 'Two-Wheeler Volume',     r.twowheeler_volume,   s.label, s.url);
    writes += write(data, fy, 'Motorcycle Volume',      r.motorcycle_volume,   s.label, s.url);
    writes += write(data, fy, 'Scooter Volume',         r.scooter_volume,      s.label, s.url);
    writes += write(data, fy, 'Three-Wheeler Volume',   r.threewheeler_volume, s.label, s.url);
    writes += write(data, fy, 'EV Volume',              r.ev_volume,           s.label, s.url);
    writes += write(data, fy, 'Export Volume',          r.export_volume,       s.label, s.url);
    if (r.total_volume != null && r.export_volume != null) {
      writes += write(data, fy, 'Domestic Volume',
        r.total_volume - r.export_volume, s.label, s.url);
    }
    writes += write(data, fy, 'Revenue (Rs Cr)',        r.revenue_cr,          s.label, s.url);
    writes += write(data, fy, 'EBITDA Margin %',        r.ebitda_margin_pct,   s.label, s.url);
    writes += write(data, fy, 'Operating PBT (Rs Cr)',  r.operating_pbt_cr,    s.label, s.url);
    writes += write(data, fy, 'PAT (Rs Cr)',            r.pat_cr,              s.label, s.url);

    /* Mix cells expressed as %. Denominator preference:
        Export % → total (2W+3W)
        Motorcycle % → 2W if known else total
        EV % → 2W if known else total. */
    if (r.export_volume != null && r.total_volume) {
      writes += write(data, fy, 'Export Volume %',
        round1((r.export_volume / r.total_volume) * 100), s.label, s.url);
    }
    const mcDenom = r.twowheeler_volume || r.total_volume;
    if (r.motorcycle_volume != null && mcDenom) {
      writes += write(data, fy, 'Motorcycle Volume %',
        round1((r.motorcycle_volume / mcDenom) * 100), s.label, s.url);
    }
    const evDenom = r.twowheeler_volume || r.total_volume;
    if (r.ev_volume != null && evDenom) {
      const v = round1((r.ev_volume / evDenom) * 100);
      writes += write(data, fy, 'EV Mix %',     v, s.label, s.url);
      writes += write(data, fy, 'EV Volume %',  v, s.label, s.url);
    }
  }

  /* YoY derived metrics — only when consecutive FYs both hold data. */
  const fys = Object.keys(ROWS);
  for (let i = 1; i < fys.length; i++) {
    const cur = fys[i], prev = fys[i - 1];
    const ec = ROWS[cur], ep = ROWS[prev];
    const s  = SRC[cur];

    /* Total volume growth — prefer total, fall back to 2W only when
       both years offer it on the same basis. */
    if (ec.total_volume && ep.total_volume) {
      writes += write(data, cur, 'Volume Growth %',
        round1((ec.total_volume / ep.total_volume - 1) * 100),
        s.label, s.url);
    } else if (ec.twowheeler_volume && ep.twowheeler_volume) {
      writes += write(data, cur, 'Volume Growth %',
        round1((ec.twowheeler_volume / ep.twowheeler_volume - 1) * 100),
        s.label, s.url);
    }
    if (ec.revenue_cr && ep.revenue_cr) {
      writes += write(data, cur, 'Revenue Growth %',
        round1((ec.revenue_cr / ep.revenue_cr - 1) * 100),
        s.label, s.url);
    }
    if (ec.pat_cr && ep.pat_cr) {
      writes += write(data, cur, 'PAT Growth %',
        round1((ec.pat_cr / ep.pat_cr - 1) * 100),
        s.label, s.url);
    }
    const curUnits  = ec.total_volume || ec.twowheeler_volume;
    const prevUnits = ep.total_volume || ep.twowheeler_volume;
    if (ec.revenue_cr && ep.revenue_cr && curUnits && prevUnits) {
      const curReal  = ec.revenue_cr / curUnits;
      const prevReal = ep.revenue_cr / prevUnits;
      writes += write(data, cur, 'Realisation Growth %',
        round1((curReal / prevReal - 1) * 100),
        s.label, s.url);
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
