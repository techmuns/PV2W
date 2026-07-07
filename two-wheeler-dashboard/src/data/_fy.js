export const FY = ['FY16', 'FY17', 'FY18', 'FY19', 'FY20', 'FY21', 'FY22', 'FY23', 'FY24', 'FY25', 'FY26', 'FY27']

// Index into FY of the most recent year for which any of the given
// anchor series carries a real (numeric) value — i.e. the latest FY the
// company has actually reported. Floored at `floorFy` (default FY25) so a
// view can only ever advance to a newer year, never regress below the
// prior hardcoded default. Returns the floor index if nothing is found.
//
// This is what lets each 2W company view auto-advance to FY26 the moment
// its own same-basis data lands, instead of every builder hardcoding
// FY.indexOf('FY25').
export function latestPopulatedIdx(anchorSeriesList, floorFy = 'FY25') {
  const floor = Math.max(0, FY.indexOf(floorFy))
  let idx = floor
  for (const series of anchorSeriesList) {
    if (!Array.isArray(series)) continue
    for (let i = FY.length - 1; i > idx; i--) {
      if (typeof series[i] === 'number') { idx = i; break }
    }
  }
  return idx
}
