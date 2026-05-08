/* ────────────────────────────────────────────────────────────────
   PV Industry Dashboard — Excel export
   ────────────────────────────────────────────────────────────────
   Reads window.PV_DATA (populated by js/data-loader.js + js/dashboard.js
   on boot) and emits a single multi-sheet .xlsx file:

     Summary    – latest-FY KPI snapshot for every company
     Industry   – wide-format SIAM industry trend, FY16-FY25
     Maruti, Hyundai, Mahindra, Tata Motors PV
                  – one wide sheet per OEM, FY16-FY25
     Vehicles   – every vehicle row in vehicle_fy_metrics
     Governance – company_info (KMP, ratings, dealers, employees)
     Sources    – long-format company_fy_metrics + industry rows
                  (every cell with its Source / Source URL / date)
     Dictionary – metric definitions and computation notes

   Designed for analyst use:
     - Wide rows = FYs; columns = metrics (sortable / filterable)
     - Numeric columns formatted with thousands separators / %
     - Frozen header rows
     - Ranges declared as Excel Tables so 'Format as Table' filters
       work out of the box
     - YoY columns use Excel formulas so the user can audit the math
     - Missing values are blank (not 'NA' strings) so SUM / AVG behave
   ──────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  /* ──────────────────────────────────────────
     Helpers
     ────────────────────────────────────────── */

  const ALL_OEMS = ["Maruti", "Hyundai", "M&M", "Tata Motors PV"];
  const SHEET_NAME_FIX = { "M&M": "Mahindra" };   // Excel allows '&' but cleaner to swap

  function safeSheet(name) {
    return (SHEET_NAME_FIX[name] || name)
      .replace(/[\\\/?*\[\]:]/g, " ")
      .slice(0, 31);
  }

  /* Pull the value out of a metrics row, falling back to null. */
  function val(row) {
    if (!row) return null;
    const v = row.Value;
    return (v === undefined || v === "" || v === "Pending") ? null : v;
  }

  function isPctMetric(m)  { return /%|Margin|Share/.test(m); }
  function isCurrMetric(m) { return /Capex|Stock/.test(m); }

  function fmtFor(metric) {
    if (isPctMetric(metric))  return '0.0"%"';
    if (isCurrMetric(metric)) return '#,##0';
    if (/Days/.test(metric))  return '0';
    if (/Volume$|Outlets|Employees|Launches/.test(metric)) return '#,##0';
    return null;
  }

  /* Sort metrics into a consistent order for every company sheet. */
  const METRIC_ORDER = [
    "Revenue Growth %", "Volume Growth %", "Realisation Growth %",
    "Gross Margin %", "EBITDA Margin %",
    "Export Volume %", "SUV Volume %", "EV Volume %",
    "Capacity Utilisation %", "Market Share %",
    "Capex (Rs Cr)", "Working Capital Days",
    "Stock Price (31-Mar)", "Total Sales Volume",
    "Dealers / Sales Outlets",
    "New Model Launches", "Facelift Launches", "Top Selling Model",
  ];
  function sortedMetrics(set) {
    const known = METRIC_ORDER.filter(m => set.has(m));
    const extra = [...set].filter(m => !METRIC_ORDER.includes(m)).sort();
    return [...known, ...extra];
  }

  /* Apply institutional table styling once. The header row is
     painted in the dashboard's purple, body rows alternate-banded. */
  function styleHeader(row) {
    row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
    row.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    row.height = 22;
  }

  function freezeHeader(sheet, ySplit = 1, xSplit = 0) {
    sheet.views = [{ state: "frozen", ySplit, xSplit }];
  }

  /* Auto-size columns to a sensible width. Caps long Source URLs. */
  function autoSize(sheet) {
    sheet.columns.forEach((col) => {
      let max = 8;
      col.eachCell({ includeEmpty: false }, (c) => {
        const v = c.value && typeof c.value === "object" && "richText" in c.value
          ? c.value.richText.map((t) => t.text).join("")
          : c.value;
        const len = v == null ? 0 : String(v).length;
        if (len > max) max = len;
      });
      col.width = Math.min(48, Math.max(8, max + 2));
    });
  }

  /* Excel column letter for a given column index (1-based). */
  function colLetter(n) {
    let s = "";
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /* ──────────────────────────────────────────
     Sheet builders
     ────────────────────────────────────────── */

  /* Summary — latest-FY KPI snapshot for every company. Wide row
     per OEM with a few headline metrics. */
  function buildSummary(wb, D) {
    const sheet = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF4F46E5" } } });
    const fyList = D.FYS_FULL;
    const latestFY = fyList[fyList.length - 1];
    const cols = [
      "Company", "FY",
      "Revenue Growth %", "Volume Growth %", "EBITDA Margin %",
      "Market Share %", "SUV Volume %", "Export Volume %",
      "Capex (Rs Cr)", "Stock Price (31-Mar)",
      "Source (latest)", "Last Updated",
    ];
    sheet.addRow(cols);
    styleHeader(sheet.getRow(1));

    /* Industry row */
    const indMetrics = ["PV Volume Growth %", "SUV Share %", "Export Share %"];
    const indRow = ["Industry", latestFY];
    indMetrics.forEach(m => {
      const r = D.Industry_FY_Metrics.find(x => x.FY === latestFY && x.Metric === m);
      indRow.push(val(r));
    });
    /* pad remaining metric cells */
    while (indRow.length < cols.length - 2) indRow.push(null);
    indRow.push("SIAM yearbook / monthly press"); indRow.push(latestFY);
    sheet.addRow(indRow);

    /* OEM rows */
    ALL_OEMS.forEach((co) => {
      const row = [co, latestFY];
      let lastSrc = null, lastUpd = null;
      cols.slice(2, -2).forEach((m) => {
        const r = D.Company_FY_Metrics.find(x => x.Company === co && x.FY === latestFY && x.Metric === m);
        row.push(val(r));
        if (r && r.Source && r.Source !== "Pending") lastSrc = r.Source;
        if (r && r.Last_Updated) lastUpd = r.Last_Updated;
      });
      row.push(lastSrc); row.push(lastUpd);
      sheet.addRow(row);
    });

    /* Number formats */
    sheet.getColumn(3).numFmt  = '0.0"%"';
    sheet.getColumn(4).numFmt  = '0.0"%"';
    sheet.getColumn(5).numFmt  = '0.0"%"';
    sheet.getColumn(6).numFmt  = '0.0"%"';
    sheet.getColumn(7).numFmt  = '0.0"%"';
    sheet.getColumn(8).numFmt  = '0.0"%"';
    sheet.getColumn(9).numFmt  = '#,##0';
    sheet.getColumn(10).numFmt = '#,##0.00';

    freezeHeader(sheet);
    autoSize(sheet);
  }

  /* Industry — wide table FY × metric. */
  function buildIndustry(wb, D) {
    const sheet = wb.addWorksheet("Industry");
    const metrics = sortedMetrics(new Set(D.Industry_FY_Metrics.map(r => r.Metric)));
    const fys = D.FYS_FULL;

    sheet.addRow(["FY", ...metrics, "Source", "Last Updated"]);
    styleHeader(sheet.getRow(1));

    fys.forEach((fy) => {
      const row = [fy];
      let lastSrc = null, lastUpd = null;
      metrics.forEach((m) => {
        const r = D.Industry_FY_Metrics.find(x => x.FY === fy && x.Metric === m);
        row.push(val(r));
        if (r && r.Source && r.Source !== "Pending") lastSrc = r.Source;
        if (r && r.Last_Updated) lastUpd = r.Last_Updated;
      });
      row.push(lastSrc); row.push(lastUpd);
      sheet.addRow(row);
    });

    /* Number formats per metric column */
    metrics.forEach((m, i) => {
      const fmt = fmtFor(m);
      if (fmt) sheet.getColumn(i + 2).numFmt = fmt;
    });

    freezeHeader(sheet);
    autoSize(sheet);
  }

  /* Per-company sheet — wide FY × metric, plus an audited
     'Growth (formula)' column at the right that recomputes YoY %
     in Excel for the column the user pins to a chart later. */
  function buildCompany(wb, D, company) {
    const sheet = wb.addWorksheet(safeSheet(company), { properties: { tabColor: { argb: "FFA78BFA" } } });
    const fys = D.FYS_FULL;
    const set = new Set(D.Company_FY_Metrics.filter(r => r.Company === company).map(r => r.Metric));
    const metrics = sortedMetrics(set);
    if (!metrics.length) {
      sheet.addRow(["No data available for " + company]);
      return;
    }

    sheet.addRow(["FY", ...metrics, "Source (latest)", "Last Updated"]);
    styleHeader(sheet.getRow(1));

    /* Find Revenue Growth % column for the auditable formula */
    fys.forEach((fy) => {
      const row = [fy];
      let lastSrc = null, lastUpd = null;
      metrics.forEach((m) => {
        const r = D.Company_FY_Metrics.find(x => x.Company === company && x.FY === fy && x.Metric === m);
        row.push(val(r));
        if (r && r.Source && r.Source !== "Pending") lastSrc = r.Source;
        if (r && r.Last_Updated) lastUpd = r.Last_Updated;
      });
      row.push(lastSrc); row.push(lastUpd);
      sheet.addRow(row);
    });

    /* Number formats per metric column */
    metrics.forEach((m, i) => {
      const fmt = fmtFor(m);
      if (fmt) sheet.getColumn(i + 2).numFmt = fmt;
    });

    /* If we have Total Sales Volume in this OEM's data, drop a
       formula-based Growth % audit column right after the last
       data column so the user can verify the Volume Growth %
       row against the underlying volume column. */
    const tsvIdx = metrics.indexOf("Total Sales Volume");
    if (tsvIdx >= 0) {
      const tsvCol = colLetter(tsvIdx + 2);   // +1 for FY column +1 because 1-indexed
      const formulaColIdx = metrics.length + 4;  // after Source + Last Updated
      sheet.getRow(1).getCell(formulaColIdx).value = "Volume Growth (formula)";
      styleHeader(sheet.getRow(1));   // re-apply since we added a cell
      for (let i = 0; i < fys.length; i++) {
        const r2 = i + 2;             // first data row is row 2
        const cell = sheet.getCell(r2, formulaColIdx);
        if (i === 0) {
          cell.value = "—";
        } else {
          /* (curr / prev) - 1, expressed as % */
          cell.value = { formula: `IFERROR((${tsvCol}${r2}/${tsvCol}${r2 - 1})-1, "")`, result: undefined };
          cell.numFmt = '0.0%';
        }
      }
      sheet.getColumn(formulaColIdx).width = 20;
    }

    freezeHeader(sheet);
    autoSize(sheet);
  }

  /* Vehicles — every vehicle_fy_metrics row, long format. */
  function buildVehicles(wb, D) {
    const sheet = wb.addWorksheet("Vehicles");
    const rows = D.Vehicle_FY_Metrics || [];
    if (!rows.length) {
      sheet.addRow(["No vehicle data available"]);
      return;
    }
    /* Column union from every row */
    const cols = Array.from(rows.reduce((s, r) => {
      Object.keys(r).forEach(k => s.add(k));
      return s;
    }, new Set()));
    /* Re-order so the readable fields come first */
    const front = ["FY", "Company", "Vehicle", "Segment", "Sales_Volume", "Market_Share_in_Segment", "Avg_Price"];
    const ordered = [...front.filter(k => cols.includes(k)), ...cols.filter(k => !front.includes(k))];
    sheet.addRow(ordered);
    styleHeader(sheet.getRow(1));
    rows.forEach(r => sheet.addRow(ordered.map(k => r[k] ?? null)));
    freezeHeader(sheet);
    autoSize(sheet);
  }

  /* Governance — company_info wide table. */
  function buildGovernance(wb, D) {
    const sheet = wb.addWorksheet("Governance");
    const rows = D.Company_Info || [];
    if (!rows.length) {
      sheet.addRow(["No governance data available"]);
      return;
    }
    const cols = ["FY", "Company", "CEO", "CFO", "COO", "Credit_Rating", "Employees", "Dealers", "Source", "Source_URL", "Last_Updated"];
    sheet.addRow(cols);
    styleHeader(sheet.getRow(1));
    rows.forEach(r => sheet.addRow(cols.map(k => r[k] ?? null)));
    sheet.getColumn(7).numFmt = "#,##0";
    sheet.getColumn(8).numFmt = "#,##0";
    freezeHeader(sheet);
    autoSize(sheet);
  }

  /* Sources — long-format dump of every company_fy_metrics +
     industry_fy_metrics row with provenance. The sortable / filterable
     master record. */
  function buildSources(wb, D) {
    const sheet = wb.addWorksheet("Sources");
    sheet.addRow(["Company", "FY", "Metric", "Value", "YoY_Change", "Signal", "Source", "Source_URL", "Last_Updated"]);
    styleHeader(sheet.getRow(1));

    const all = [
      ...((D.Industry_FY_Metrics || []).map(r => ({ ...r, Company: "Industry" }))),
      ...(D.Company_FY_Metrics || []),
    ];
    /* Sort: Company, then FY ascending */
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
        r.Source && r.Source !== "Pending" ? r.Source : null,
        r.Source_URL || null,
        r.Last_Updated || null,
      ]);
    });

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: sheet.rowCount, column: 9 },
    };
    freezeHeader(sheet);
    autoSize(sheet);
  }

  /* Dictionary — short metric-by-metric definitions. */
  function buildDictionary(wb, D) {
    const sheet = wb.addWorksheet("Dictionary");
    sheet.addRow(["Metric", "Unit", "Definition", "Typical Source"]);
    styleHeader(sheet.getRow(1));
    const dict = [
      ["Revenue Growth %",     "%",     "YoY change in Revenue from Operations / Net Sales / Turnover.",                    "Company AR / Q4 IP"],
      ["Volume Growth %",      "%",     "YoY change in total sales volume (domestic + exports).",                           "Company AR / SIAM"],
      ["Realisation Growth %", "%",     "Derived: (1 + revenue growth) / (1 + volume growth) − 1.",                         "Derived"],
      ["Gross Margin %",       "%",     "Proxy: 100% − material cost %. Not company-disclosed gross margin.",               "Company Q4 IP key ratios"],
      ["EBITDA Margin %",      "%",     "EBITDA ÷ revenue.",                                                                "Company AR / Q4 IP"],
      ["Export Volume %",      "%",     "Exports as a share of total sales volume.",                                        "Company AR / Q4 IP"],
      ["SUV Volume %",         "%",     "SUV / UV share of domestic volume.",                                               "Company Q4 IP / DRHP"],
      ["EV Volume %",          "%",     "BEV share of domestic volume.",                                                    "Company Q4 IP / VAHAN"],
      ["Capacity Utilisation %","%",    "Sales volume ÷ installed capacity (proxy where production not disclosed).",        "Company AR + Q4 IP"],
      ["Market Share %",       "%",     "Domestic PV market share (SIAM basis).",                                           "SIAM / company AR"],
      ["Capex (Rs Cr)",        "Rs Cr", "Annual capital expenditure from cash-flow statement.",                             "Company AR cash flow"],
      ["Working Capital Days", "days",  "(Receivables + Inventory − Payables) × 365 ÷ revenue. Negative = supplier-funded.", "Screener / AR balance sheet"],
      ["Stock Price (31-Mar)", "Rs",    "NSE close on 31 March of the fiscal year.",                                        "Yahoo Finance (NSE close)"],
      ["Total Sales Volume",   "units", "Total annual sales volume (domestic + exports + OEM supplies).",                   "Company monthly sales PR"],
      ["Dealers / Sales Outlets","count","FY-end count of authorised sales outlets / dealerships.",                          "Company AR / Q4 IP"],
      ["New Model Launches",   "count", "Count of newly launched models in the FY.",                                        "Company AR / Q4 IP"],
      ["Facelift Launches",    "count", "Count of facelifts / refreshes in the FY.",                                        "Company AR / Q4 IP"],
      ["Top Selling Model",    "—",     "Highest-volume model in the FY at company / industry level.",                      "Company sales PR / SIAM"],
      ["PV Volume Growth %",   "%",     "Industry-level YoY change in domestic PV sales.",                                  "SIAM yearbook"],
      ["SUV Share %",          "%",     "Industry-level UV share of domestic PV.",                                          "SIAM yearbook"],
      ["EV Share %",           "%",     "Industry-level BEV share of domestic PV.",                                         "SIAM / VAHAN"],
      ["Export Share %",       "%",     "Industry-level PV exports ÷ PV production.",                                       "SIAM yearbook"],
      ["Top Gaining OEM",      "—",     "OEM with the largest YoY market-share gain (derived).",                            "Derived from Market Share %"],
    ];
    dict.forEach(d => sheet.addRow(d));
    freezeHeader(sheet);
    autoSize(sheet);

    /* Add a tiny meta block at the bottom for traceability. */
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
      btn.dataset.label = btn.textContent;
      btn.textContent = "Exporting…";
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
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

      buildSummary(wb, D);
      buildIndustry(wb, D);
      ALL_OEMS.forEach((co) => buildCompany(wb, D, co));
      buildVehicles(wb, D);
      buildGovernance(wb, D);
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

  /* Delegate so the button keeps working even if the header
     re-renders. */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#export-btn");
    if (btn) runExport();
  });

  /* Expose for manual tests in the console. */
  window.PV_EXPORT = { run: runExport };
})();
