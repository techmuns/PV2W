/* ────────────────────────────────────────────────────────────────
   PV Industry Dashboard — Excel export
   ────────────────────────────────────────────────────────────────
   Reads window.PV_DATA (populated by js/data-loader.js + dashboard.js
   on boot) and emits a single .xlsx workbook structured to match
   the analyst's template:

     PV         – the main sheet. One row per metric, grouped by
                  company. Years 2010-2026 across the columns.
                  Yellow-banded year header, merged company-name
                  column on the left, 17 year columns. Industry
                  metrics first, then Maruti / Hyundai / Mahindra /
                  Tata Motors PV.
     Vehicles   – every vehicle_fy_metrics row (long format).
     Sources    – long-format master record with per-cell Source /
                  Source URL / Last Updated.
     Dictionary – metric definitions, units, typical sources.

   Year ↔ FY mapping
     Column 2025 corresponds to FY25 (April 2024 – March 2025), i.e.
     calendar-year-of-FY-end. Empty columns (e.g. 2010 for OEMs we
     only track from FY16) stay blank — never fabricated.
   ──────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const ALL_OEMS = ["Maruti", "Hyundai", "M&M", "Tata Motors PV"];

  /* Calendar years for the column header. Edit here to extend. */
  /* Year range: FY16 – FY26. We dropped 2010-2015 because no source
     in the dataset covers those FYs (Maruti Q4 IPs go back to FY16,
     Hyundai DRHP covers FY19+, M&M Screener covers FY15+ but only
     for one row, etc.). FY26 is included for forward-looking series
     (M&M consolidated already prints a full FY26 column). */
  const YEAR_START = 2016, YEAR_END = 2026;

  /* Column 2010 → FY10, 2025 → FY25, etc. */
  function yearToFY(y) { return "FY" + String(y).slice(2); }

  /* Resolve a metric's value, treating 'Pending' / undefined as blank. */
  function cellVal(row) {
    if (!row) return null;
    const v = row.Value;
    return (v === undefined || v === "" || v === "Pending") ? null : v;
  }

  /* Best-effort number format per row label. */
  function fmtFor(label) {
    if (/%/.test(label))                       return '0.0"%"';
    if (/Volume$|Industry Volume/i.test(label))return '#,##0';
    if (/Capex|Stock Price/i.test(label))      return '#,##0';
    if (/Days/i.test(label))                   return '0';
    if (/Employees|Dealers|launches \(Nos/.test(label)) return '#,##0';
    return null;
  }

  /* ── styling helpers ── */
  const PURPLE = "FF4F46E5";
  const PURPLE_DEEP = "FF312E81";     // header band
  const YELLOW = "FFFDE68A";          // soft amber for year headers
  const HEAD_BG = "FFE2E8F0";         // slate-200 for the first two header cells
  const ROW_BAND = "FFF8FAFC";        // slate-50 for alt-row banding
  const GROUP_BG = "FFEEF2FF";        // indigo-50 for group sub-headers
  const GROUP_FG = "FF3730A3";        // indigo-700 text on group headers
  const GRID = { style: "thin", color: { argb: "FFCBD5E1" } };

  /* Per-OEM accent colour for the merged company column. Picked
     to match the dashboard brand chips: red-tinted Maruti, Hyundai
     blue, M&M dark red, Tata teal, Industry indigo. */
  const COMPANY_ACCENT = {
    Industry:         { bg: "FFEEF2FF", fg: "FF312E81" },
    Maruti:           { bg: "FFFFE4E6", fg: "FF9F1239" },
    MARUTI:           { bg: "FFFFE4E6", fg: "FF9F1239" },
    Hyundai:          { bg: "FFE0E7FF", fg: "FF1E3A8A" },
    HYUNDAI:          { bg: "FFE0E7FF", fg: "FF1E3A8A" },
    "M&M":            { bg: "FFFEE2E2", fg: "FF7F1D1D" },
    "Tata Motors PV": { bg: "FFCCFBF1", fg: "FF115E59" },
    "TATA MOTORS PV": { bg: "FFCCFBF1", fg: "FF115E59" },
  };

  function thinBorders() {
    return { top: GRID, bottom: GRID, left: GRID, right: GRID };
  }

  /* Merge company column across the rows we just appended and
     style the merged cell with a brand-tinted accent. */
  function mergeCompanyColumn(sheet, startRow, endRow, label) {
    if (startRow > endRow) return;
    sheet.mergeCells(startRow, 1, endRow, 1);
    const cell = sheet.getCell(startRow, 1);
    cell.value = label;
    const accent = COMPANY_ACCENT[label] || { bg: "FFF1F5F9", fg: "FF1F2A37" };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true, textRotation: 90 };
    cell.font = { bold: true, size: 12, color: { argb: accent.fg } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accent.bg } };
    cell.border = thinBorders();
  }

  /* Append one company / industry block to the PV sheet.
     Supports group sub-headers via { _group: "Section name" } row
     entries which render as a coloured pill spanning the metric +
     year columns and softly visually separate metric clusters. */
  function appendBlock(sheet, companyLabel, rows, oem, D) {
    const yearCount = YEAR_END - YEAR_START + 1;
    const startRow = sheet.rowCount + 1;
    let dataRowIdx = 0;     // for alt-row banding within metric rows

    rows.forEach((rowDef) => {
      /* Group-header row */
      if (rowDef._group) {
        const headRow = sheet.addRow(["", rowDef._group, ...new Array(yearCount).fill(null)]);
        headRow.height = 18;
        sheet.mergeCells(headRow.number, 2, headRow.number, 2 + yearCount);
        const c = headRow.getCell(2);
        c.value = rowDef._group;
        c.font = { bold: true, size: 10, color: { argb: GROUP_FG } };
        c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_BG } };
        c.border = thinBorders();
        return;
      }

      const { label, source, metric, field } = rowDef;
      const r = [companyLabel, label];
      for (let y = YEAR_START; y <= YEAR_END; y++) {
        const fy = yearToFY(y);
        let v = null;
        if (source === "industry") {
          const row = D.Industry_FY_Metrics.find(x => x.FY === fy && x.Metric === metric);
          v = row ? cellVal(row) : null;
        } else if (source === "company" && oem) {
          const row = D.Company_FY_Metrics.find(x => x.Company === oem && x.FY === fy && x.Metric === metric);
          v = row ? cellVal(row) : null;
        } else if (source === "info" && oem) {
          const info = D.Company_Info.find(x => x.Company === oem && x.FY === fy);
          if (info) {
            const raw = info[field];
            v = (raw === "—" || raw == null || raw === "") ? null : raw;
          }
        }
        r.push(v);
      }
      sheet.addRow(r);

      /* Style the row — banded background + per-cell number format. */
      const last = sheet.lastRow;
      last.height = 17;
      const fmt = fmtFor(label);
      const isAlt = (dataRowIdx++ % 2 === 1);
      const metricCell = last.getCell(2);
      metricCell.font = { bold: false, size: 10, color: { argb: "FF1F2A37" } };
      metricCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      metricCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isAlt ? ROW_BAND : "FFFFFFFF" } };
      metricCell.border = thinBorders();
      for (let i = 3; i <= 2 + yearCount; i++) {
        const c = last.getCell(i);
        if (fmt) c.numFmt = fmt;
        c.alignment = { horizontal: "right", vertical: "middle" };
        c.font = { size: 10, color: { argb: "FF1F2A37" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isAlt ? ROW_BAND : "FFFFFFFF" } };
        c.border = thinBorders();
      }
    });
    mergeCompanyColumn(sheet, startRow, sheet.rowCount, companyLabel);
  }

  /* ──────────────────────────────────────────
     Sheet builders
     ────────────────────────────────────────── */

  function buildPV(wb, D) {
    const sheet = wb.addWorksheet("PV", { properties: { tabColor: { argb: PURPLE } } });
    const yearCount = YEAR_END - YEAR_START + 1;

    /* Header row */
    const head = ["COMPANY NAME", "METRIC"];
    for (let y = YEAR_START; y <= YEAR_END; y++) head.push(y);
    sheet.addRow(head);

    const hr = sheet.getRow(1);
    hr.height = 30;
    hr.alignment = { horizontal: "center", vertical: "middle" };
    /* First two cells: deep purple band, white text */
    [1, 2].forEach(i => {
      const c = hr.getCell(i);
      c.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PURPLE_DEEP } };
      c.border = thinBorders();
    });
    /* Year cells: soft amber band */
    for (let i = 3; i <= 2 + yearCount; i++) {
      const c = hr.getCell(i);
      c.font = { bold: true, size: 11, color: { argb: "FF78350F" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
      c.border = thinBorders();
    }

    /* ── Industry block ── */
    const INDUSTRY_ROWS = [
      { _group: "Volume" },
      { label: "Industry Volume",                   source: "industry", metric: "Total PV Volume" },
      { label: "PV Volume Growth %",                source: "industry", metric: "PV Volume Growth %" },
      { label: "Average ASP (₹ Lakh)",              source: "industry", metric: "Average ASP (Rs Lakh)" },
      { label: "Industry PAT (₹ Cr)",               source: "industry", metric: "Industry PAT (Rs Cr)" },
      { _group: "Mix" },
      { label: "Export Share %",                    source: "industry", metric: "Export Share %" },
      { label: "EV Share %",                        source: "industry", metric: "EV Share %" },
      { label: "SUV Share %",                       source: "industry", metric: "SUV Share %" },
      { _group: "Leadership" },
      { label: "Top Selling Model",                 source: "industry", metric: "Top Selling Model" },
      { label: "Top Gaining OEM",                   source: "industry", metric: "Top Gaining OEM" },
    ];
    /* Auto-discover any industry metric we haven't hand-listed above
       so new data refreshes appear in the export without code edits. */
    const indCovered = new Set(INDUSTRY_ROWS.filter(r => r.metric).map(r => r.metric));
    const indExtras = [...new Set((D.Industry_FY_Metrics || []).map(r => r.Metric))]
      .filter(m => !indCovered.has(m))
      .sort()
      .map(m => ({ label: m, source: "industry", metric: m }));
    appendBlock(sheet, "Industry", [...INDUSTRY_ROWS, ...indExtras], null, D);

    /* ── Per-OEM blocks ── */
    const OEM_ROWS = [
      { _group: "Scale & Growth" },
      { label: "Market Share %",                 source: "company", metric: "Market Share %" },
      { label: "Volume Growth %",                source: "company", metric: "Volume Growth %" },
      { label: "Revenue Growth %",               source: "company", metric: "Revenue Growth %" },
      { label: "Realisation Growth %",           source: "company", metric: "Realisation Growth %" },
      { _group: "Profitability" },
      { label: "Gross Margin %",                 source: "company", metric: "Gross Margin %" },
      { label: "EBITDA Margin %",                source: "company", metric: "EBITDA Margin %" },
      { label: "PAT Margin %",                   source: "company", metric: "PAT Margin %" },
      { _group: "Capital & Operations" },
      { label: "Capacity (units)",               source: "company", metric: "Capacity (units)" },
      { label: "Capacity Utilisation %",         source: "company", metric: "Capacity Utilisation %" },
      { label: "Capex (₹ Cr)",                   source: "company", metric: "Capex (Rs Cr)" },
      { label: "Capex Intensity %",              source: "company", metric: "Capex Intensity %" },
      { label: "Working Capital Days",           source: "company", metric: "Working Capital Days" },
      { _group: "Volume Mix" },
      { label: "Export Volume %",                source: "company", metric: "Export Volume %" },
      { label: "Export Revenue %",               source: "company", metric: "Export Revenue %" },
      { label: "EV Volume %",                    source: "company", metric: "EV Volume %" },
      { label: "EV Revenue %",                   source: "company", metric: "EV Revenue %" },
      { label: "SUV Volume %",                   source: "company", metric: "SUV Volume %" },
      { label: "SUV Revenue %",                  source: "company", metric: "SUV Revenue %" },
      { _group: "Product Cadence" },
      { label: "New Model Launches",             source: "company", metric: "New Model Launches" },
      { label: "Facelift Launches",              source: "company", metric: "Facelift Launches" },
      { label: "Top Selling Model",              source: "company", metric: "Top Selling Model" },
      { _group: "Market & Governance" },
      { label: "Stock Price (31-Mar, ₹)",        source: "company", metric: "Stock Price (31-Mar)" },
      { label: "No. of Employees",               source: "info", field: "Employees" },
      { label: "No. of Dealers",                 source: "info", field: "Dealers" },
      { label: "Credit Rating",                  source: "info", field: "Credit_Rating" },
      { label: "CEO",                            source: "info", field: "CEO" },
      { label: "CFO",                            source: "info", field: "CFO" },
      { label: "COO",                            source: "info", field: "COO" },
    ];
    const oemCovered = new Set(OEM_ROWS.filter(r => r.metric).map(r => r.metric));
    /* Metrics that overlap with Company_Info fields (already covered
       by the curated 'info'-sourced rows). Suppressed from auto-
       discover so the export doesn't render two parallel rows for
       the same concept (e.g. 'Dealers / Sales Outlets' company
       metric vs 'No. of Dealers' from Company_Info). */
    const COMPANY_INFO_OVERLAP = new Set([
      "Dealers / Sales Outlets",
      "Employees",
    ]);
    ALL_OEMS.forEach(co => {
      const seen = [...new Set((D.Company_FY_Metrics || [])
        .filter(r => r.Company === co)
        .map(r => r.Metric))];
      const extras = seen
        .filter(m => !oemCovered.has(m) && !COMPANY_INFO_OVERLAP.has(m))
        .sort()
        .map(m => ({ label: m, source: "company", metric: m }));
      appendBlock(sheet, co.toUpperCase(), [...OEM_ROWS, ...extras], co, D);
    });

    /* Column widths — sized so the longest content fits without
       wrapping. Years widened from 11 → 14 (fits 6-digit volumes
       like 1,650,000 and the 'Mahindra & Mahindra' top-selling
       model strings), metric column from 30 → 36 (fits 'Stock
       Price (31-Mar, ₹)' etc.), company from 6 → 9 for the
       vertical brand label. */
    sheet.getColumn(1).width = 9;
    sheet.getColumn(2).width = 36;
    for (let i = 3; i <= 2 + yearCount; i++) sheet.getColumn(i).width = 14;

    /* Auto-widen any year column whose longest data string exceeds
       the default — guards against new metrics with long values
       (e.g. 'Hyundai Creta', 'CRISIL AAA / Stable'). */
    for (let i = 3; i <= 2 + yearCount; i++) {
      const col = sheet.getColumn(i);
      let max = col.width;
      col.eachCell({ includeEmpty: false }, c => {
        const s = c.value == null ? "" : String(c.value);
        if (s.length + 2 > max) max = s.length + 2;
      });
      col.width = Math.min(28, max);
    }

    sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
    sheet.properties.defaultRowHeight = 16;
  }

  function buildSources(wb, D) {
    const sheet = wb.addWorksheet("Sources");
    sheet.addRow(["Company", "FY", "Metric", "Value", "YoY_Change", "Signal", "Source", "Source_URL", "Last_Updated"]);
    const hr = sheet.getRow(1);
    hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PURPLE } };
    hr.alignment = { vertical: "middle", horizontal: "left" };
    hr.height = 22;

    const all = [
      ...((D.Industry_FY_Metrics || []).map(r => ({ ...r, Company: "Industry" }))),
      ...(D.Company_FY_Metrics || []),
    ];
    const fyIdx = (fy) => D.FYS_FULL.indexOf(fy);
    all.sort((a, b) => (a.Company || "").localeCompare(b.Company || "") || fyIdx(a.FY) - fyIdx(b.FY));
    all.forEach((r) => {
      sheet.addRow([
        r.Company || "Industry",
        r.FY || null,
        r.Metric || null,
        (r.Value === "Pending" || r.Value === undefined) ? null : r.Value,
        r.YoY_Change == null ? null : r.YoY_Change,
        r.Signal || null,
        (r.Source && r.Source !== "Pending") ? r.Source : null,
        r.Source_URL || null,
        r.Last_Updated || null,
      ]);
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: 9 } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach((col) => {
      let max = 8;
      col.eachCell({ includeEmpty: false }, c => {
        const len = c.value == null ? 0 : String(c.value).length;
        if (len > max) max = len;
      });
      col.width = Math.min(48, Math.max(8, max + 2));
    });
  }

  function buildDictionary(wb, D) {
    const sheet = wb.addWorksheet("Dictionary");
    sheet.addRow(["Metric", "Unit", "Definition", "Typical Source"]);
    const hr = sheet.getRow(1);
    hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PURPLE } };
    hr.alignment = { vertical: "middle", horizontal: "left" };
    hr.height = 22;
    const dict = [
      ["Industry Volume",        "units",  "Total domestic PV sales (SIAM yearbook).",                                      "SIAM annual"],
      ["Export Volume % (Ind.)", "%",      "Industry-level PV exports as a share of PV production.",                        "SIAM yearbook"],
      ["EV Volume % (Ind.)",     "%",      "Industry-level BEV share of domestic PV.",                                      "SIAM / VAHAN"],
      ["SUV Volume % (Ind.)",    "%",      "Industry-level UV share of domestic PV.",                                       "SIAM yearbook"],
      ["Industry Top Selling Model","—",   "Highest-volume model across all OEMs in the FY.",                               "SIAM model-wise"],
      ["Capacity Utilisation %", "%",      "Sales volume ÷ installed capacity (proxy where production not disclosed).",      "Company AR + Q4 IP"],
      ["Capex (₹ Cr)",           "₹ Cr",   "Annual capex proxy = |Cash from Investing Activities| (Screener cash flow). Includes net of asset sales / divestments.", "Company AR cash flow"],
      ["Capex Intensity %",      "%",      "Capex ÷ Sales × 100 — how reinvestment-heavy the OEM is per ₹ of revenue.",       "Derived from AR cash flow + P&L"],
      ["PAT Margin %",           "%",      "Net Profit ÷ Sales × 100 — bottom-line margin per ₹ of revenue.",                  "Company AR / Screener consolidated P&L"],
      ["Market Share %",         "%",      "Domestic PV market share (SIAM basis).",                                        "SIAM / company AR"],
      ["Revenue Growth %",       "%",      "YoY change in Revenue from Operations / Net Sales / Turnover.",                 "Company AR / Q4 IP"],
      ["Volume Growth %",        "%",      "YoY change in total sales volume (domestic + exports).",                        "Company AR / SIAM"],
      ["Realisation Growth %",   "%",      "Derived: (1 + revenue growth) / (1 + volume growth) − 1.",                      "Derived"],
      ["Gross Margin %",         "%",      "Proxy: 100% − material cost %. Not company-disclosed gross margin.",            "Company Q4 IP"],
      ["EBITDA Margin %",        "%",      "EBITDA ÷ revenue.",                                                              "Company AR / Q4 IP"],
      ["Export Volume %",        "%",      "Exports as a share of company total sales volume.",                              "Company AR / Q4 IP"],
      ["EV Volume %",            "%",      "BEV share of company domestic volume.",                                          "Company Q4 IP / VAHAN"],
      ["SUV Volume %",           "%",      "SUV / UV share of company domestic volume.",                                     "Company Q4 IP / DRHP"],
      ["Working Capital Days",   "days",   "(Receivables + Inventory − Payables) × 365 ÷ revenue. Negative = supplier-funded.","Screener / AR balance sheet"],
      ["New Model launches (Nos.)","count","Count of newly launched models in the FY.",                                      "Company AR / Q4 IP"],
      ["Face Lift launches (Nos.)","count","Count of facelifts / refreshes in the FY.",                                      "Company AR / Q4 IP"],
      ["Top Selling Model",      "—",      "Highest-volume model in the FY at company level.",                               "Company sales PR"],
      ["Stock Price as on 31st March","Rs","NSE close on 31 March of the fiscal year.",                                      "Yahoo Finance (NSE close)"],
      ["No. of Employees",       "count",  "FY-end headcount.",                                                              "Company AR"],
      ["No. of Dealers",         "count",  "FY-end count of authorised sales outlets.",                                      "Company AR / Q4 IP"],
      ["CEO / CFO / COO",        "—",      "Key Managerial Personnel per company AR / IR page.",                             "Company AR / IR"],
      ["Credit Rating",          "—",      "External long-term + short-term credit rating (CRISIL/ICRA/CARE).",              "Rating agency website"],
    ];
    dict.forEach(d => sheet.addRow(d));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach((col, i) => {
      col.width = i === 2 ? 60 : (i === 0 ? 30 : (i === 1 ? 9 : 26));
    });

    sheet.addRow([]);
    sheet.addRow(["Workbook generated by"]);
    sheet.lastRow.getCell(1).font = { bold: true };
    sheet.addRow(["Source", "PV Industry Dashboard (https://github.com/techmuns/neha)"]);
    sheet.addRow(["Generated at (UTC)", new Date().toISOString()]);
    sheet.addRow(["Data last refreshed", (D._meta && D._meta.last_refresh) || "unknown"]);
  }

  /* ──────────────────────────────────────────
     Public entry — wired to the header button
     ────────────────────────────────────────── */

  function setExportingState(btn, on) {
    if (!btn) return;
    if (on) {
      btn.disabled = true;
      btn.dataset.label = btn.querySelector("span")?.textContent || "Export";
      const span = btn.querySelector("span"); if (span) span.textContent = "Exporting…";
    } else {
      btn.disabled = false;
      const span = btn.querySelector("span"); if (span && btn.dataset.label) span.textContent = btn.dataset.label;
    }
  }

  async function runExport() {
    const btn = document.getElementById("export-btn");
    setExportingState(btn, true);
    try {
      if (typeof ExcelJS === "undefined") throw new Error("Excel library not loaded — refresh the page and retry.");
      const D = window.PV_DATA;
      if (!D || !D.Company_FY_Metrics) throw new Error("Dashboard data not loaded yet — wait for the page to finish loading.");

      const wb = new ExcelJS.Workbook();
      wb.creator = "PV Industry Dashboard";
      wb.created = new Date();
      wb.title   = "PV Industry Dashboard Export";

      buildPV(wb, D);
      buildSources(wb, D);
      buildDictionary(wb, D);

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Dashboard_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[export] failed:", e);
      alert("Export failed: " + e.message);
    } finally {
      setExportingState(btn, false);
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#export-btn");
    if (btn) runExport();
  });

  window.PV_EXPORT = { run: runExport };
})();
