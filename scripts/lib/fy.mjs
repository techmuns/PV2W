/**
 * fy.mjs — shared Indian fiscal-year helpers.
 *
 * Single source of truth for "which fiscal year should a fetcher be
 * targeting right now", so the whole data pipeline advances to the new
 * FY automatically each April instead of each fetcher hardcoding a
 * literal like "FY25". Mirrors the FY math in scripts/extend-fys.mjs,
 * which auto-extends the dashboard's FY range in company_config.json.
 *
 * Indian FY rule: the year ending 31 March of calendar year Y is named
 * FY(Y mod 100). On or after 1 April we are in a new fiscal year whose
 * year-end is the *next* calendar year — e.g. May 2026 → FY27, ending
 * March 2027.
 *
 * All helpers accept an optional `now` (Date) for testability; they
 * default to the real current date.
 */

/** Calendar year in which the current (in-progress) FY ends.
 *  April-or-later → next calendar year. */
export function currentFyEndYear(now = new Date()) {
  return now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear();
}

/** FY end-year (e.g. 2027) → FY name (e.g. "FY27"). */
export const fyName = (endYear) => "FY" + String(endYear).slice(2);

/** FY name → the calendar year its March falls in. "FY26" → 2026. */
export const fyToMarchYear = (fy) =>
  2000 + parseInt(String(fy).replace(/^FY/i, ""), 10);

/** The current, in-progress fiscal year, e.g. "FY27" in Jul 2026. */
export function currentFY(now = new Date()) {
  return fyName(currentFyEndYear(now));
}

/** The most recent *completed* fiscal year, e.g. "FY26" in Jul 2026.
 *  This is the newest FY for which a full year of data (annual results,
 *  the 31-March closing price, SIAM annual totals …) can exist. */
export function latestCompleteFY(now = new Date()) {
  return fyName(currentFyEndYear(now) - 1);
}

/** Trailing window of `count` fiscal years ending at `endFy`
 *  (inclusive), oldest → newest. Defaults to ending at the latest
 *  completed FY. e.g. recentFYs(4) in Jul 2026 → [FY23,FY24,FY25,FY26]. */
export function recentFYs(count, endFy = latestCompleteFY()) {
  const endY = fyToMarchYear(endFy);
  const out = [];
  for (let y = endY - count + 1; y <= endY; y++) out.push(fyName(y));
  return out;
}

/** Inclusive list of FYs from end-year `startEndYear` through `endFy`,
 *  oldest → newest. e.g. fyRange(2016) in Jul 2026 → [FY16…FY26]. */
export function fyRange(startEndYear, endFy = latestCompleteFY()) {
  const endY = fyToMarchYear(endFy);
  const out = [];
  for (let y = startEndYear; y <= endY; y++) out.push(fyName(y));
  return out;
}
