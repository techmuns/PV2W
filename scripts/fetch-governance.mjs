#!/usr/bin/env node
/**
 * fetch-governance.mjs
 *
 * Refreshes the Governance & Network panel for all OEMs in
 * data/config/placeholder_data.json's `company_info` block.
 *
 * Two-tier strategy:
 *
 *   (1) CURATED SEED — KMP names (CEO / CFO / COO) live in this
 *       file with the leadership-page URL as the source. People
 *       don't change often; when one does, edit the seed and the
 *       provenance updates with it.
 *
 *   (2) LIVE FETCH — Credit rating, dealer count, and employee
 *       count are pulled from public sources every refresh:
 *         - Credit rating  : CRISIL rating-rationale page
 *         - Dealers / Emp. : latest annual-report PDF on the
 *                            OEM's IR page (where reachable)
 *
 *   The seed values back-stop every live fetch — if the network
 *   call fails or the parser can't find the field, the seed
 *   number is preserved (with the seed's source URL) instead of
 *   blanking the cell.
 *
 * Output:
 *   - Updates company_info FY25 rows for Maruti / Hyundai / M&M /
 *     Tata Motors PV in placeholder_data.json.
 *   - Each row's Source field is rebuilt as a single sourced
 *     line covering KMP + rating + AR.
 *
 * Usage:
 *   node scripts/fetch-governance.mjs
 *   node scripts/fetch-governance.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAsText } from './lib/fetch-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'config', 'placeholder_data.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const TODAY     = new Date().toISOString().slice(0, 10);
const FY        = 'FY25';

/* ──────────────────────────────────────────────────────────────────
   CURATED SEED
   Verified against each OEM's public Leadership / Board-management
   page as of the data-refresh date. Update when a KMP changes.
   '—' means the role isn't a standard disclosed title at that OEM
   (e.g. Maruti uses 'Senior Executive Officer' rather than COO;
   Tata Motors PV is a sub-unit and inherits Group CFO).
   ────────────────────────────────────────────────────────────────── */

const SEED = {
  Maruti: {
    CEO: "Hisashi Takeuchi",
    CEO_Title: "MD & CEO",
    CFO: "Arnab Roy",
    CFO_Title: "Senior Executive Officer (Finance)",
    COO: "—",
    COO_Note: "Maruti uses Senior Executive Officer titles in lieu of a single COO role.",
    Credit_Rating: "CRISIL AAA / Stable",
    Dealers: 4235,
    Employees: 20171,
    Leadership_URL: "https://www.marutisuzuki.com/corporate/about-us/board-of-directors-management",
    Crisil_URL:     "https://www.crisilratings.com/en/home/our-businesses/ratings/company-factsheet.MARUTI.html",
    AR_URL:         "https://www.marutisuzuki.com/corporate/investors/financial-and-other-information/annual-reports",
  },
  Hyundai: {
    CEO: "Unsoo Kim",
    CEO_Title: "MD",
    CFO: "Wangdo Hur",
    CFO_Title: "Chief Financial Officer",
    COO: "Tarun Garg",
    COO_Title: "COO & Whole-time Director",
    Credit_Rating: "CRISIL AAA / Stable; CRISIL A1+",
    Dealers: 1419,
    Employees: 9000,
    Leadership_URL: "https://www.hyundai.com/in/en/about-us/our-leaders",
    Crisil_URL:     "https://www.crisilratings.com/en/home/our-businesses/ratings/company-factsheet.HYUNDAIMOTORINDIA.html",
    AR_URL:         "https://www.hyundai.com/in/en/about-us/investor-relations/annual-report",
  },
  "M&M": {
    CEO: "Dr. Anish Shah",
    CEO_Title: "MD & CEO (Group)",
    CFO: "Amarjyoti Barua",
    CFO_Title: "Group CFO",
    COO: "Rajesh Jejurikar",
    COO_Title: "Executive Director — Auto & Farm Sectors",
    Credit_Rating: "CRISIL AAA / Stable",
    Dealers: 1500,
    Employees: 24500,
    Leadership_URL: "https://www.mahindra.com/about-us/management",
    Crisil_URL:     "https://www.crisilratings.com/en/home/our-businesses/ratings/company-factsheet.MAHINDRAANDMAHINDRA.html",
    AR_URL:         "https://www.mahindra.com/investor-relations/annual-reports",
  },
  "Tata Motors PV": {
    CEO: "Shailesh Chandra",
    CEO_Title: "MD — Tata Motors Passenger Vehicles & Tata Passenger Electric Mobility",
    CFO: "P B Balaji",
    CFO_Title: "Group CFO, Tata Motors",
    COO: "—",
    COO_Note: "Tata Motors PV is a sub-unit; COO role not separately disclosed.",
    Credit_Rating: "CRISIL AA+ / Positive",
    Dealers: 1500,
    Employees: 5500,
    Leadership_URL: "https://www.tatamotors.com/board-management/",
    Crisil_URL:     "https://www.crisilratings.com/en/home/our-businesses/ratings/company-factsheet.TATAMOTORS.html",
    AR_URL:         "https://www.tatamotors.com/investors/annual-reports/",
  },
};

/* ──────────────────────────────────────────────────────────────────
   LIVE FETCHERS
   Best-effort. Any failure leaves the seed value in place.
   ────────────────────────────────────────────────────────────────── */

/* CRISIL rating page → most-recent long-term rating string. CRISIL's
   rating pages render rating + outlook in a consistent header block
   ("CRISIL AAA/Stable"). We pick the first such pattern in the page
   text. */
async function fetchCrisilRating(url) {
  try {
    const r = await fetchAsText(url);
    if (!r.text || r.text.length < 200) return null;
    /* matches 'CRISIL AAA / Stable', 'CRISIL AA+ / Positive', etc. */
    const m = r.text.match(/CRISIL\s+(AAA|AA\+|AA|AA-|A\+|A|A-|BBB\+|BBB|BBB-)\s*\/\s*(Stable|Positive|Negative|Watch[^\s]*)/i);
    if (!m) return null;
    return `CRISIL ${m[1].toUpperCase()} / ${m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()}`;
  } catch (e) {
    console.warn(`  CRISIL fetch failed: ${e.message}`);
    return null;
  }
}

/* AR-page text → 'Sales / dealer outlets: N,NNN' or 'employees:
   N,NNN'. Patterns are loose because each OEM phrases it
   differently; we fall back to the seed if nothing matches. */
async function fetchArExtract(url) {
  try {
    const r = await fetchAsText(url);
    if (!r.text || r.text.length < 500) return {};
    const text = r.text;
    const out = {};
    const dealerRx =
      /(?:sales|dealer|retail)\s+(?:outlets?|touch[-\s]?points?|network)\s*(?:of|stood at|crossed|reached|to|–|-|:)?\s*([0-9][0-9,]+)/i;
    const empRx =
      /(?:employees|workforce|head[-\s]?count)\s*(?:of|stood at|stood\s+at|reached|to|–|-|:)?\s*([0-9][0-9,]+)/i;
    const dm = text.match(dealerRx);
    const em = text.match(empRx);
    if (dm) out.dealers = parseInt(dm[1].replace(/,/g, ''), 10);
    if (em) out.employees = parseInt(em[1].replace(/,/g, ''), 10);
    return out;
  } catch (e) {
    console.warn(`  AR fetch failed: ${e.message}`);
    return {};
  }
}

/* ──────────────────────────────────────────────────────────────────
   Apply seeded + fetched values to a company_info row.
   ────────────────────────────────────────────────────────────────── */

async function processCompany(data, name, seed) {
  console.log(`\n=== ${name} ===`);
  let row = data.company_info.find(r => r.Company === name && r.FY === FY);
  if (!row) {
    row = { FY, Company: name };
    data.company_info.push(row);
  }

  /* KMP — straight from seed */
  row.CEO = seed.CEO;
  row.CFO = seed.CFO;
  row.COO = seed.COO;
  row.Credit_Rating = seed.Credit_Rating;
  row.Dealers   = seed.Dealers;
  row.Employees = seed.Employees;

  /* Live: credit rating */
  const live = await fetchCrisilRating(seed.Crisil_URL);
  if (live) {
    console.log(`  CRISIL rating live: ${live}`);
    row.Credit_Rating = live;
  } else {
    console.log(`  CRISIL rating: kept seed (${seed.Credit_Rating})`);
  }

  /* Live: dealers / employees from AR */
  const ar = await fetchArExtract(seed.AR_URL);
  if (ar.dealers) {
    console.log(`  Dealers live: ${ar.dealers}`);
    row.Dealers = ar.dealers;
  } else {
    console.log(`  Dealers: kept seed (${seed.Dealers})`);
  }
  if (ar.employees) {
    console.log(`  Employees live: ${ar.employees}`);
    row.Employees = ar.employees;
  } else {
    console.log(`  Employees: kept seed (${seed.Employees})`);
  }

  /* Provenance */
  const sources = [];
  sources.push(`KMP per ${seed.Leadership_URL}`);
  sources.push(`Credit rating per ${seed.Crisil_URL}`);
  if (seed.AR_URL) sources.push(`Dealers / employees per ${seed.AR_URL}`);
  row.Source = sources.join(' · ');
  row.Source_URL = seed.Leadership_URL;
  row.Last_Updated = TODAY;
}

async function main() {
  console.log('[fetch-governance] starting…');
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  for (const [name, seed] of Object.entries(SEED)) {
    await processCompany(data, name, seed);
  }

  if (DRY_RUN) {
    console.log('\n[fetch-governance] --dry-run: not writing file.');
    return;
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n[fetch-governance] wrote → ${DATA_PATH}`);
}

main().catch(err => {
  console.error('[fetch-governance] fatal:', err);
  process.exit(1);
});
