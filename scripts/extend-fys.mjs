#!/usr/bin/env node
/**
 * extend-fys.mjs
 *
 * Auto-extends the dashboard's FY ranges in company_config.json
 * once a year so a new fiscal year appears in the FY selector,
 * KPI strip, supporting-data tables, and Excel export without
 * any manual edit.
 *
 * Indian FY rule: a fiscal year ending in March of calendar year
 * Y is named FY(Y mod 100). E.g., April 2026 - March 2027 = FY27.
 * On or after April 1st we add the new FY (current year + 1)
 * to the lists since Q1 partials start landing in May.
 *
 * Idempotent. Re-running on the same day is a no-op.
 *
 * Usage:
 *   node scripts/extend-fys.mjs
 *   node scripts/extend-fys.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'config', 'company_config.json');
const DRY_RUN = process.argv.includes('--dry-run');

function currentFyEndYear() {
  const now = new Date();
  /* April or later → we're in a new FY whose year-end is next
     calendar year. E.g., May 2026 → FY27 = year-end 2027. */
  return now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear();
}
const fyName = (y) => "FY" + String(y).slice(2);

function main() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const fyEndY = currentFyEndYear();
  const targetLatest = fyName(fyEndY);

  let touched = 0;

  /* fys_full: FY16 through current FY end. */
  const startY = 2016;
  const fullList = [];
  for (let y = startY; y <= fyEndY; y++) fullList.push(fyName(y));
  if (JSON.stringify(cfg.fys_full) !== JSON.stringify(fullList)) {
    cfg.fys_full = fullList;
    touched++;
  }

  /* fys: trailing 3-year window ending at the current FY. */
  const trailing = [
    fyName(fyEndY - 2),
    fyName(fyEndY - 1),
    fyName(fyEndY),
  ];
  if (JSON.stringify(cfg.fys) !== JSON.stringify(trailing)) {
    cfg.fys = trailing;
    touched++;
  }

  if (touched === 0) {
    console.log(`[extend-fys] already current (latest = ${targetLatest})`);
    return;
  }
  console.log(`[extend-fys] extended FY range to ${targetLatest}`);
  console.log(`  fys      = ${JSON.stringify(cfg.fys)}`);
  console.log(`  fys_full = ${JSON.stringify(cfg.fys_full)}`);
  if (DRY_RUN) { console.log('--dry-run: not writing.'); return; }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`wrote ${CONFIG_PATH}`);
}

main();
