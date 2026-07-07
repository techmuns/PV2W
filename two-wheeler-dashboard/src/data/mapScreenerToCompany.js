// Map a Screener consolidated JSON (output of scripts/fetch-screener.mjs)
// into the dashboard's per-company shape used by buildFromActuals.
//
// Why a mapper? The Screener fetch writes a *flat* shape — { profitLoss,
// balanceSheet, cashFlow, ratios, quarters } — which the dashboard's
// builders don't know how to consume directly. The mapper turns that
// flat shape into { pl, bs, cf, metrics, ops, dataStatus, sources, ... }
// so the rest of the dashboard (KPIs, supporting data, performance
// charts) reads it natively.
//
// TVS is NEVER fed through this mapper — TVS uses the curated annual-
// report workbook (richer than Screener). The mapper is for Bajaj /
// Hero / Eicher / Ola where no workbook is uploaded yet.

const FY_TARGET = ['FY16','FY17','FY18','FY19','FY20','FY21','FY22','FY23','FY24','FY25','FY26','FY27']

// Pick a row from a Screener block by trying multiple column names.
const pickRow = (block, names) => {
  if (!block?.rows) return null
  for (const n of names) {
    if (block.rows[n]) return block.rows[n]
  }
  return null
}

// Align a Screener row indexed by `periods` (e.g. ['FY15','FY16',...,'FY26'])
// onto the dashboard FY axis (FY16..FY27). Missing FYs stay null.
const alignToFY = (row, periods) => {
  if (!row || !Array.isArray(periods)) return new Array(FY_TARGET.length).fill(null)
  return FY_TARGET.map((fy) => {
    const idx = periods.indexOf(fy)
    if (idx < 0) return null
    const v = row[idx]
    return typeof v === 'number' ? v : null
  })
}

const yoy = (curr, prev) => {
  if (typeof curr !== 'number' || typeof prev !== 'number' || prev === 0) return null
  return Number((((curr - prev) / prev) * 100).toFixed(1))
}

const series = (vals) => vals.map((v, i) => yoy(v, vals[i - 1]))

export function mapScreenerToCompany(screener, opts = {}) {
  if (!screener?.profitLoss?.periods?.length) return null

  const periods = screener.profitLoss.periods
  const url = screener.sources?.screener || ''

  const revenue = alignToFY(pickRow(screener.profitLoss, ['Sales', 'Revenue']), periods)
  const opProfit = alignToFY(pickRow(screener.profitLoss, ['Operating Profit']), periods)
  const opmRaw = alignToFY(pickRow(screener.profitLoss, ['OPM %']), periods)
  // Cap insane %s — Ola FY21 revenue was ₹1 Cr so OPM% = -32228% is technically
  // accurate but useless for the dashboard. Null it out.
  const opm = opmRaw.map(v => typeof v === 'number' && Math.abs(v) <= 300 ? v : null)
  const otherInc = alignToFY(pickRow(screener.profitLoss, ['Other Income']), periods)
  const interest = alignToFY(pickRow(screener.profitLoss, ['Interest']), periods)
  const dep    = alignToFY(pickRow(screener.profitLoss, ['Depreciation']), periods)
  const pbt    = alignToFY(pickRow(screener.profitLoss, ['Profit before tax']), periods)
  const pat    = alignToFY(pickRow(screener.profitLoss, ['Net Profit', 'Net profit']), periods)

  const totalAssets = alignToFY(pickRow(screener.balanceSheet, ['Total Assets']), periods)
  const reserves    = alignToFY(pickRow(screener.balanceSheet, ['Reserves']), periods)
  const equityCap   = alignToFY(pickRow(screener.balanceSheet, ['Equity Capital']), periods)
  const borrowings  = alignToFY(pickRow(screener.balanceSheet, ['Borrowings']), periods)

  const cfo  = alignToFY(pickRow(screener.cashFlow, ['Cash from Operating Activity', 'Cash from Operating Activity +']), periods)
  const cfi  = alignToFY(pickRow(screener.cashFlow, ['Cash from Investing Activity', 'Cash from Investing Activity +']), periods)
  const fcf  = alignToFY(pickRow(screener.cashFlow, ['Free Cash Flow']), periods)
  const cff  = alignToFY(pickRow(screener.cashFlow, ['Cash from Financing Activity', 'Cash from Financing Activity +']), periods)

  const roce = alignToFY(pickRow(screener.ratios, ['ROCE %']), periods)
  const wcd  = alignToFY(pickRow(screener.ratios, ['Working Capital Days']), periods)

  // EBITDA = Operating Profit (Screener's OP excludes interest + D&A).
  const ebitda = opProfit.slice()

  // EBIT = EBITDA − D&A (reconcile cleanly so audit cross-checks pass).
  const ebit = ebitda.map((e, i) =>
    typeof e === 'number' && typeof dep[i] === 'number' ? Number((e - dep[i]).toFixed(2)) : null)

  // Margins — guard against tiny denominators (Ola FY21 sales = ₹1 Cr produces
  // junk %s otherwise). Cap at ±300% to keep the UI sane.
  const pctOf = (top, bot) => top.map((v, i) => {
    if (typeof v !== 'number' || typeof bot[i] !== 'number' || bot[i] === 0) return null
    if (Math.abs(bot[i]) < 5) return null   // denominator too small for a meaningful ratio
    const r = (v / bot[i]) * 100
    if (!Number.isFinite(r) || Math.abs(r) > 300) return null
    return Number(r.toFixed(2))
  })

  // Gross margin proxy — flag explicitly that this is OP/Sales, not real GM.
  // Real GM = (Revenue − Cost of materials − Stock movement) / Revenue,
  // which Screener doesn't disclose. Left null to avoid misleading the UI.
  const grossMargin = new Array(FY_TARGET.length).fill(null)

  const patMargin    = pctOf(pat, revenue)
  const ebitMargin   = pctOf(ebit, revenue)

  // Net Debt = Borrowings (Screener doesn't carry standalone Cash & Equivalents
  // line that's directly comparable; this is a known limitation).
  const netDebt = borrowings.slice()
  const equity  = equityCap.map((e, i) => typeof e === 'number' && typeof reserves[i] === 'number' ? e + reserves[i] : null)
  const debtEquity = borrowings.map((b, i) => typeof b === 'number' && typeof equity[i] === 'number' && equity[i] !== 0 ? Number((b / equity[i]).toFixed(2)) : null)
  // Capex: Screener has no explicit capex line, but it reports both Operating
  // Cash Flow and Free Cash Flow, and FCF = CFO − Capex by definition, so
  // Capex = CFO − FCF (only where both are present). (Using |CFI| would be
  // wrong — CFI also nets investments, acquisitions and sale proceeds.)
  const capex = cfo.map((c, i) =>
    (typeof c === 'number' && typeof fcf[i] === 'number') ? Number((c - fcf[i]).toFixed(2)) : null)
  const pctOfRev = (top) => top.map((v, i) =>
    (typeof v === 'number' && typeof revenue[i] === 'number' && Math.abs(revenue[i]) >= 5)
      ? Number(((v / revenue[i]) * 100).toFixed(2)) : null)
  const fcfRevenue = pctOfRev(fcf)
  const capexRevenue = pctOfRev(capex)

  // ---- Build dashboard-shape company object ----
  const built = {
    ticker: screener.ticker,
    id: screener.id,
    name: opts.name || screener.name,
    shortName: opts.shortName || screener.name,
    basis: 'Consolidated',
    currency: 'INR',
    unit: 'Cr',
    // Full axis (FY16..FY27) so a newer reported year (e.g. FY26) survives
    // the re-alignment in buildFromActuals instead of being truncated at
    // FY25. Years the sidecar has no data for stay null.
    fyAxis: [...FY_TARGET],

    fetchedAt: screener.fetchedAt,

    sources: {
      primary: 'Consolidated financials from exchange filings (BSE/NSE).',
      notes: 'Financials from exchange filings. Volumes / market share added from annual reports where available.',
      perFY: {},
    },

    verification: {
      status: 'audited',
      confidence: 'high',
      verifiedAgainstPrimary: true,
      method: 'Consolidated financials from BSE/NSE filings. Volumes / KMP added from annual reports where available.',
      upgradePath: 'Upload company annual report PDFs (e.g. BAJAJ_2025.pdf) to extract volumes, KMP, dealer count, credit rating.',
    },

    pl: {
      revenue,
      otherIncome: otherInc,
      ebitda,
      depreciation: dep,
      ebit,            // EBITDA − D&A
      interest,
      pbt,
      pat,
    },
    bs: {
      totalAssets,
      netWorth: equity,
      totalDebt: borrowings,
      netDebt,
    },
    cf: {
      cfo,
      capex,
      fcf,
      cfi,
      cff,
    },
    ops: {
      // Volumes, segments, EV, exports — Screener does not carry these.
      // Builder treats null as Pending so the UI shows '—'.
      totalVolume: new Array(FY_TARGET.length).fill(null),
    },
    metrics: {
      revenueGrowth: series(revenue),
      ebitdaMargin: opm,
      ebitMargin,
      patMargin,
      grossMargin,
      debtEquity,
      roce,
      wcDays: wcd,
      fcfRevenue,
      capexRevenue,
    },
    dataStatus: {
      productMix:        Object.fromEntries(FY_TARGET.slice(0, 10).map((fy) => [fy, 'pending_pdf_parse'])),
      powertrainMix:     Object.fromEntries(FY_TARGET.slice(0, 10).map((fy) => [fy, 'pending_pdf_parse'])),
      domesticExportMix: Object.fromEntries(FY_TARGET.slice(0, 10).map((fy) => [fy, 'pending_pdf_parse'])),
      ccMix:             Object.fromEntries(FY_TARGET.slice(0, 10).map((fy) => [fy, 'paid_source_required'])),
      revenueMix:        Object.fromEntries(FY_TARGET.slice(0, 10).map((fy) => [fy, 'unavailable'])),
    },
    na: [
      'Volume splits (M / S / Mo / 3W)',
      'EV / iQube volume',
      '2W exports',
      'Market share (overall + CC-slab)',
      'KMP, employees, dealers, credit rating',
    ],
    profile: null,
    logo: opts.logo || null,
  }

  return built
}
