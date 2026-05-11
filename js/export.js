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
  /* Year range — auto-extends each fiscal year.
       YEAR_START is fixed at 2016 (no source covers earlier FYs).
       YEAR_END is computed dynamically: April marks the start of
       a new Indian FY, so once we cross April N we want the column
       for FY ending March (N+1) visible (Q1 partials land in May).
     This means the Excel grows by one column every April with no
     code change required. */
  const YEAR_START = 2016;
  const _now       = new Date();
  const _currentY  = _now.getFullYear();
  const _isPostApr = _now.getMonth() >= 3;   // 0-indexed; April = 3
  const YEAR_END   = _isPostApr ? _currentY + 1 : _currentY;

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
     year columns and softly visually separate metric clusters.
     ctx.absMap routes specific dashboard metrics to formula cells
     referencing the Absolute_Numbers tab so PV ratios recompute
     when the underlying absolutes are edited. */

  /* Dashboard metric → Excel formula generator. Each entry returns
     a formula string given (fy, oem, refAbs(key, fy), fallback)
     where refAbs returns "'Absolute_Numbers'!E45" or null, and
     fallback is the curated dashboard value for that (co, fy)
     pulled from placeholder_data — used as the IFERROR catch so
     PV cells are never blank when an absolute is NA. */
  const fbk = (v) => (v != null && v !== "" && Number.isFinite(+v)) ? String(+v) : '""';
  const PV_RATIOS = {
    "Revenue Growth %": (fy, oem, refAbs, fb) => {
      const i = FYS_MODEL.indexOf(fy); if (i <= 0) return fb != null ? `IFERROR(${fbk(fb)},"")` : "";
      const cur = refAbs("Revenue", fy);
      const pre = refAbs("Revenue", FYS_MODEL[i-1]);
      return (cur && pre) ? `IFERROR((${cur}/${pre}-1)*100,${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
    "Volume Growth %": (fy, oem, refAbs, fb) => {
      const i = FYS_MODEL.indexOf(fy); if (i <= 0) return fb != null ? fbk(fb) : "";
      const cur = refAbs("Total Sales Volume", fy);
      const pre = refAbs("Total Sales Volume", FYS_MODEL[i-1]);
      return (cur && pre) ? `IFERROR((${cur}/${pre}-1)*100,${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
    "Realisation Growth %": (fy, oem, refAbs, fb) => {
      const i = FYS_MODEL.indexOf(fy); if (i <= 0) return fb != null ? fbk(fb) : "";
      const rCur = refAbs("Revenue", fy), rPre = refAbs("Revenue", FYS_MODEL[i-1]);
      const vCur = refAbs("Total Sales Volume", fy), vPre = refAbs("Total Sales Volume", FYS_MODEL[i-1]);
      return (rCur && rPre && vCur && vPre)
        ? `IFERROR(((${rCur}/${rPre})/(${vCur}/${vPre})-1)*100,${fbk(fb)})`
        : (fb != null ? fbk(fb) : "");
    },
    "EBITDA Margin %": (fy, oem, refAbs, fb) => {
      const e = refAbs("EBITDA", fy);
      const r = refAbs("Revenue", fy);
      return (e && r) ? `IFERROR(${e}/${r}*100,${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
    "PAT Margin %": (fy, oem, refAbs, fb) => {
      const p = refAbs("PAT", fy);
      const r = refAbs("Revenue", fy);
      return (p && r) ? `IFERROR(${p}/${r}*100,${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
    "Capex Intensity %": (fy, oem, refAbs, fb) => {
      const c = refAbs("Capex", fy);
      const r = refAbs("Revenue", fy);
      return (c && r) ? `IFERROR(${c}/${r}*100,${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
    "Working Capital Days": (fy, oem, refAbs, fb) => {
      const w = refAbs("Working Capital", fy);
      const r = refAbs("Revenue", fy);
      return (w && r) ? `IFERROR(${w}*365/${r},${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
    "Capacity Utilisation %": (fy, oem, refAbs, fb) => {
      const v = refAbs("Total Sales Volume", fy);
      const k = refAbs("Capacity", fy);
      return (v && k) ? `IFERROR(${v}/${k}*100,${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
    "Export Volume %": (fy, oem, refAbs, fb) => {
      const e = refAbs("Export Volume", fy);
      const t = refAbs("Total Sales Volume", fy);
      return (e && t) ? `IFERROR(${e}/${t}*100,${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
    "EV Volume %": (fy, oem, refAbs, fb) => {
      const e = refAbs("EV Volume", fy);
      const t = refAbs("Total Sales Volume", fy);
      return (e && t) ? `IFERROR(${e}/${t}*100,${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
    "SUV Volume %": (fy, oem, refAbs, fb) => {
      const s = refAbs("SUV Volume", fy);
      const t = refAbs("Total Sales Volume", fy);
      return (s && t) ? `IFERROR(${s}/${t}*100,${fbk(fb)})` : (fb != null ? fbk(fb) : "");
    },
  };
  function appendBlock(sheet, companyLabel, rows, oem, D, ctx) {
    const yearCount = YEAR_END - YEAR_START + 1;
    const startRow = sheet.rowCount + 1;
    let dataRowIdx = 0;     // for alt-row banding within metric rows
    const absMap  = (ctx && ctx.absMap)  || null;

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
      /* PV-tab formula generation. Each metric is mapped to either:
           a) a direct row reference into Absolute_Numbers (for raw
              absolutes the dashboard surfaces unchanged: Total
              Sales Volume, Capacity, Capex, Industry Volume, etc.)
           b) an Excel ratio formula computed from two Absolute_
              Numbers rows (Revenue Growth %, PAT Margin %, Capex
              Intensity %, etc.).
         The formulas[i] array is populated per-FY; cells without a
         formula fall back to the hardcoded value pulled from
         placeholder_data below. */
      const formulas = new Array(yearCount).fill(null);
      const AN = "'Absolute_Numbers'!";
      const refAbs = (key, fy) => {
        const rn = absMap && absMap[`${oem || (source === "industry" ? "Industry" : "")}|${key}`];
        return rn ? `${AN}${fyColLetter(fy)}${rn}` : null;
      };
      const indRefAbs = (key, fy) => {
        const rn = absMap && absMap[`Industry|${key}`];
        return rn ? `${AN}${fyColLetter(fy)}${rn}` : null;
      };
      const directKey = oem
        ? ({
            "Total Sales Volume": "Total Sales Volume",
            "Capacity (units)":   "Capacity",
            "Capex (Rs Cr)":      "Capex",
          })[metric]
        : ({
            "Industry PAT (Rs Cr)":   "Industry PAT (Rs Cr)",
            "Average ASP (Rs Lakh)":  "Average ASP",
            "Total PV Volume":        "Industry Volume",
          })[metric];
      const ratioFn = oem ? PV_RATIOS[metric] : null;

      for (let y = YEAR_START; y <= YEAR_END; y++) {
        const fy = yearToFY(y);
        if (directKey) {
          const ref = oem ? refAbs(directKey, fy) : indRefAbs(directKey, fy);
          if (ref) formulas[y - YEAR_START] = ref;
        } else if (ratioFn) {
          /* Pull the curated dashboard value as the IFERROR fallback
             so the cell always shows a number, never blank. */
          let fallback = null;
          if (oem) {
            const rec = (D.Company_FY_Metrics || []).find(x =>
              x.Company === oem && x.FY === fy && x.Metric === metric);
            if (rec && rec.Value != null && rec.Value !== "Pending" && Number.isFinite(+rec.Value)) {
              fallback = +rec.Value;
            }
          }
          const f = ratioFn(fy, oem, refAbs, fallback);
          if (f) formulas[y - YEAR_START] = f;
        }
      }

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
      /* If the row should be formula-driven, overwrite the value
         cells with the formula references after the addRow. Track
         counts on ctx so Model_Checks can report. */
      if (formulas.some(Boolean)) {
        const last = sheet.lastRow;
        for (let i = 0; i < yearCount; i++) {
          if (formulas[i]) {
            last.getCell(3 + i).value = { formula: formulas[i] };
            if (ctx) ctx.formulaCount = (ctx.formulaCount || 0) + 1;
          }
        }
      }

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
     Financial-model layer
     ──────────────────────────────────────────
     Three new tabs ahead of the dashboard view:
       1. Financials_3Statement  - absolute historical inputs
       2. Calculations         - all dashboard ratios derived
                                 from Financials_3Statement via
                                 Excel formulas
       3. Model_Checks         - validation checks
     These let the user open any cell in the dashboard PV tab,
     trace it back via formula precedents to the absolute number,
     and edit the absolute to see the dashboard recompute. */

  /* Year ↔ column mapping for the model tabs (FY16 = col E, ...,
     FY26 = col O). 1=Company, 2=Statement, 3=Line Item, 4=Unit,
     5..15=FY16..FY26, 16=Source, 17=Source URL, 18=Last Updated.
     The Calculations + PV tabs share the same FY column layout
     so cross-tab references stay readable. */
  /* FYs that the financial-model tabs span — derived from the
     YEAR_START/YEAR_END dynamic range so adding a new fiscal year
     to the dashboard requires no code change. */
  const FYS_MODEL = (() => {
    const out = [];
    for (let y = YEAR_START; y <= YEAR_END; y++) out.push("FY" + String(y).slice(2));
    return out;
  })();
  const FY_COL_OFFSET = 5;   // FY16 lives in column 5 (E) on Financials_3Statement
  const fyCol = (fy) => FY_COL_OFFSET + FYS_MODEL.indexOf(fy);
  const fyColLetter = (fy) => columnLetter(fyCol(fy));
  function columnLetter(n) {
    let s = "";
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /* Style helpers for the model tabs — distinguish raw inputs
     (blue) from formulas (black) at a glance. */
  const COLOUR_INPUT     = "FF1D4ED8";   // blue-700 — hardcoded raw input
  const COLOUR_FORMULA   = "FF1F2937";   // gray-800 — formula cell
  const COLOUR_GAP       = "FFB45309";   // amber-700 — known gap (no source yet)
  const COLOUR_SECTION   = "FF065F46";   // emerald-700 — section header text
  const FILL_SECTION     = "FFD1FAE5";   // emerald-100 — section header bg
  const FILL_COMPANY     = "FFEEF2FF";   // indigo-50  — company-band bg
  const FILL_INPUT_BG    = "FFF0F9FF";   // sky-50     — raw input cell tint

  /* Per-OEM helpers to look up curated values out of the data
     so we can pre-fill absolute inputs from what we already
     have (Sales, PAT, Capex, Volume, Capacity, Employees,
     Dealers). */
  function getCM(D, co, fy, metric) {
    const r = (D.Company_FY_Metrics || []).find(x =>
      x.Company === co && x.FY === fy && x.Metric === metric);
    return r && r.Value != null && r.Value !== "Pending" ? r.Value : null;
  }
  function getInd(D, fy, metric) {
    const r = (D.Industry_FY_Metrics || []).find(x =>
      x.FY === fy && x.Metric === metric);
    return r && r.Value != null && r.Value !== "Pending" ? r.Value : null;
  }
  function getInfo(D, co, fy, field) {
    const r = (D.Company_Info || []).find(x => x.Company === co && x.FY === fy);
    if (!r) return null;
    const v = r[field];
    return (v === "—" || v == null || v === "") ? null : v;
  }

  /* Source label / URL for an input — pulls from raw data when
     the metric has been curated, otherwise leaves blank. */
  function getSource(D, co, fy, metric) {
    const list = co === "Industry" ? D.Industry_FY_Metrics : D.Company_FY_Metrics;
    const r = (list || []).find(x =>
      (co === "Industry" ? true : x.Company === co) && x.FY === fy && x.Metric === metric);
    if (!r) return { src: "", url: "", date: "" };
    return {
      src:  (r.Source && r.Source !== "Pending") ? r.Source : "",
      url:  r.Source_URL || "",
      date: r.Last_Updated || "",
    };
  }

  /* Style a model-tab data row: blue for inputs, black for
     formulas, amber for known gaps. */
  function styleModelRow(row, kind) {
    const colour = kind === "formula" ? COLOUR_FORMULA
                 : kind === "gap"     ? COLOUR_GAP
                 : COLOUR_INPUT;
    const fill   = kind === "input"   ? FILL_INPUT_BG : "FFFFFFFF";
    for (let i = FY_COL_OFFSET; i <= FY_COL_OFFSET + FYS_MODEL.length - 1; i++) {
      const c = row.getCell(i);
      c.font = { size: 10, color: { argb: colour }, bold: false };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      c.alignment = { horizontal: "right", vertical: "middle" };
      c.border = thinBorders();
    }
    /* Identifier columns (Company / Statement / Line Item / Unit) */
    for (let i = 1; i <= 4; i++) {
      const c = row.getCell(i);
      c.font = { size: 10, color: { argb: "FF1F2A37" } };
      c.alignment = { horizontal: i === 4 ? "center" : "left", vertical: "middle", indent: 1 };
      c.border = thinBorders();
    }
    /* Source columns */
    for (let i = 16; i <= 18; i++) {
      const c = row.getCell(i);
      c.font = { size: 9, color: { argb: "FF6B7280" } };
      c.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      c.border = thinBorders();
    }
  }

  /* Add a section-header row inside Financials_3Statement or
     Calculations (e.g. "P&L", "Balance Sheet", "Cash Flow"). */
  function addSectionHeader(sheet, label) {
    const row = sheet.addRow([label]);
    sheet.mergeCells(row.number, 1, row.number, 18);
    const c = row.getCell(1);
    c.value = label;
    c.font = { bold: true, size: 11, color: { argb: COLOUR_SECTION } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_SECTION } };
    c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    c.border = thinBorders();
    row.height = 18;
    return row;
  }

  /* Add a company-band row (one per company section) so users
     can scan the sheet by colour. */
  function addCompanyHeader(sheet, label) {
    const row = sheet.addRow([label]);
    sheet.mergeCells(row.number, 1, row.number, 18);
    const accent = COMPANY_ACCENT[label] || { bg: FILL_COMPANY, fg: "FF312E81" };
    const c = row.getCell(1);
    c.value = label;
    c.font = { bold: true, size: 12, color: { argb: accent.fg } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accent.bg } };
    c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    c.border = thinBorders();
    row.height = 22;
    return row;
  }

  /* Push a financial-model line item.
     spec = { co, statement, item, unit, kind, getValue, formula, src }
       kind  = 'input' | 'formula' | 'gap'
       getValue(fy) -> number | null     (used when kind='input')
       formula(fyLetter, rowNum) -> string  (used when kind='formula')
     Returns the row number so other formulas can reference it. */
  function addModelRow(sheet, spec, D, numFmt) {
    const r = [spec.co, spec.statement, spec.item, spec.unit];
    /* Year cells: empty for now, fill below depending on kind. */
    for (let i = 0; i < FYS_MODEL.length; i++) r.push(null);
    /* Source columns blank; populated only for raw inputs. */
    r.push(""); r.push(""); r.push("");
    sheet.addRow(r);
    const row = sheet.lastRow;
    let bestSrc = { src: "", url: "", date: "" };

    FYS_MODEL.forEach((fy, i) => {
      const colIdx = FY_COL_OFFSET + i;
      const c = row.getCell(colIdx);
      if (numFmt) c.numFmt = numFmt;
      if (spec.kind === "input") {
        const v = spec.getValue ? spec.getValue(fy) : null;
        if (v != null && v !== "") {
          c.value = v;
          /* Capture latest source label from the raw data so the
             Source columns reflect provenance. */
          if (spec.srcMetric && D) {
            const s = getSource(D, spec.srcCompany || spec.co, fy, spec.srcMetric);
            if (s.src && (!bestSrc.date || (s.date && s.date >= bestSrc.date))) bestSrc = s;
          }
        }
      } else if (spec.kind === "formula") {
        const formula = spec.formula(fy, row.number, columnLetter(colIdx));
        if (formula) c.value = { formula };
      } else if (spec.kind === "gap") {
        /* Render gap cells as 'NA' text per the spec — analyst sees
           the row exists but the value is unavailable. */
        c.value = "NA";
        c.alignment = { horizontal: "center", vertical: "middle" };
        c.numFmt = "@";
      }
    });

    if (bestSrc.src) {
      row.getCell(16).value = bestSrc.src;
      row.getCell(17).value = bestSrc.url;
      row.getCell(18).value = bestSrc.date;
    }
    styleModelRow(row, spec.kind);
    return row.number;
  }

  /* ──────────────────────────────────────────
     Tab 1: Financials_3Statement
     Returns a row map keyed by `${co}|${item}` so the
     Calculations tab can build cross-tab formulas. */
  /* Curated absolute financial inputs from authoritative filings.
     Numbers are sourced from each company's audited statutory P&L
     and balance sheet. Only line items where we have a clean
     source are filled — the rest stay null and surface as gaps in
     Missing_Data_Log. NEVER reverse-calculated from dashboard %s. */
  const ABS_DATA = {
    Maruti: {
      src: "Maruti Suzuki India Annual Report — Standalone audited P&L",
      url: "https://www.marutisuzuki.com/corporate/investors/financial-and-other-information/annual-reports",
      byFY: {
        FY16: { Revenue: 57538,  PAT: 4571  },
        FY17: { Revenue: 68035,  PAT: 7338  },
        FY18: { Revenue: 78104,  PAT: 7722  },
        FY19: { Revenue: 83026,  PAT: 7500  },
        FY20: { Revenue: 75610,  PAT: 5650  },
        FY21: { Revenue: 70372,  PAT: 4229  },
        FY22: { Revenue: 88330,  PAT: 3879  },
        FY23: { Revenue: 117571, PAT: 8049  },
        FY24: { Revenue: 141858, PAT: 13209 },
        FY25: { Revenue: 152849, PAT: 14500 },
      },
    },
    Hyundai: {
      src: "Hyundai Motor India — DRHP (Jun 2024, FY19-FY23) + MCA standalone filings (FY16-FY18) + Q4 audited PR (FY24, FY25)",
      url: "https://www.hyundai.com/in/en/about-us/investor-relations",
      byFY: {
        FY16: { Revenue: 28543, PAT: 1325 },
        FY17: { Revenue: 32437, PAT: 1452 },
        FY18: { Revenue: 36035, PAT: 1493 },
        FY19: { Revenue: 33099, PAT: 1540 },
        FY20: { Revenue: 40856, PAT: 1847 },
        FY21: { Revenue: 40973, PAT: 2907 },
        FY22: { Revenue: 47378, PAT: 2861 },
        FY23: { Revenue: 60308, PAT: 4653 },
        FY24: { Revenue: 69829, PAT: 6060 },
        FY25: { Revenue: 69193, PAT: 5640 },
      },
    },
    "M&M": {
      src: "Mahindra & Mahindra Ltd — Consolidated annual report (Auto + Farm + Tech combined; Screener parsed)",
      url: "https://www.mahindra.com/investor-relations",
      byFY: {
        FY16: { Revenue: 75841,  PAT: 3554  },
        FY17: { Revenue: 83773,  PAT: 4051  },
        FY18: { Revenue: 92094,  PAT: 7958  },
        FY19: { Revenue: 104721, PAT: 6017  },
        FY20: { Revenue: 75382,  PAT: -321  },
        FY21: { Revenue: 84960,  PAT: 1731  },
        FY22: { Revenue: 91716,  PAT: 7375  },
        FY23: { Revenue: 121268, PAT: 11375 },
        FY24: { Revenue: 138279, PAT: 12193 },
        FY25: { Revenue: 159211, PAT: 14071 },
      },
    },
    /* Tata Motors PV — segment-level Revenue/PAT not separately
       disclosed by the company (only segment EBITDA in Q4 IPs).
       Left blank in 3-statement; the dashboard's Revenue Growth %
       row remains a Source Percentage Input. */
    "Tata Motors PV": { src: "Not separately disclosed — Tata Motors publishes PV-segment EBITDA only", url: "https://www.tatamotors.com/investors/", byFY: {} },
  };

  /* Look up an absolute value from ABS_DATA, falling back to null
     so the cell renders blank (and Missing_Data_Log captures it). */
  function getAbs(co, fy, key) {
    const e = ABS_DATA[co];
    if (!e || !e.byFY) return null;
    const r = e.byFY[fy];
    return r && r[key] != null ? r[key] : null;
  }

  /* Tracks gaps so Missing_Data_Log can list every (Co, FY, Metric)
     that wasn't sourced. Populated as Financials_3Statement is built. */
  let _missingLog = [];
  function logMissing(co, fy, metric, sourceChecked, reason, action) {
    _missingLog.push({ co, fy, metric, sourceChecked, reason, action });
  }

  function buildAbsoluteNumbers(wb, D) {
    _missingLog = [];   // reset per export
    const sheet = wb.addWorksheet("Absolute_Numbers", { properties: { tabColor: { argb: "FF1D4ED8" } } });

    /* Header row */
    const head = ["Company", "Statement", "Line Item", "Unit"];
    FYS_MODEL.forEach(fy => head.push(fy));
    head.push("Source"); head.push("Source URL"); head.push("Last Updated");
    sheet.addRow(head);
    const hr = sheet.getRow(1);
    hr.height = 26;
    hr.eachCell({ includeEmpty: false }, c => {
      c.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = thinBorders();
    });

    const rowMap = {};
    const allCos = ["Industry", ...ALL_OEMS];

    /* Helper: emit an absolute-input row with optional getter, and
       log every blank cell to _missingLog with the reason given. */
    const inputRow = (co, statement, item, unit, getValue, srcEntry, missingReason) => {
      const rowNum = addModelRow(sheet, {
        co, statement, item, unit, kind: "input",
        getValue: (fy) => {
          const v = getValue ? getValue(fy) : null;
          if (v == null) {
            logMissing(co, fy, item, (srcEntry && srcEntry.src) || "—",
              missingReason || "no actual sourced data",
              "Locate AR / IP / DRHP filing and add value");
          }
          return v;
        },
      }, D, item.includes("Volume") || item.includes("Capacity") || item === "Employees" || item === "Dealers" ? '#,##0'
        : item.includes("ASP") ? '0.00'
        : '#,##0');
      /* If the row is genuinely blank everywhere, override the source
         columns with the umbrella label so the analyst sees the
         provenance reason. */
      if (srcEntry) {
        const r = sheet.getRow(rowNum);
        if (!r.getCell(16).value) {
          r.getCell(16).value = srcEntry.src;
          r.getCell(17).value = srcEntry.url;
        }
      }
      return rowNum;
    };

    const formulaRow = (co, statement, item, unit, formulaFn, fmt) => {
      return addModelRow(sheet, { co, statement, item, unit, kind: "formula", formula: formulaFn },
        D, fmt || '#,##0');
    };

    const gapRow = (co, statement, item, unit, reason) => {
      const rowNum = addModelRow(sheet, { co, statement, item, unit, kind: "gap" }, D, '#,##0');
      FYS_MODEL.forEach(fy => logMissing(co, fy, item, "—", reason || "absolute not sourced", "Manual fill required"));
      const r = sheet.getRow(rowNum);
      if (reason) r.getCell(16).value = reason;
      return rowNum;
    };

    /* Helper closures used across P&L / BS / CF sections — defined
       once at function scope so they're visible from every block.
       (Earlier they were declared inside the P&L `else` block which
       caused ReferenceError when the BS / CF blocks tried to use
       them — that broke the export.) */
    const screenerSrcFor = (co) => ({
      src: `Screener.in (parsed by fetch-${co.toLowerCase().replace(/\s+/g,'').replace('&','-and-')}-screener.mjs → derive-financials.mjs)`,
      url: `https://www.screener.in/company/`,
    });
    const orGap = (co, statement, item, unit, metric, reason) => {
      const has = (D.Company_FY_Metrics || []).some(r =>
        r.Company === co && r.Metric === metric && r.Value != null && r.Value !== "Pending");
      if (has) {
        return inputRow(co, statement, item, unit, (fy) => getCM(D, co, fy, metric), screenerSrcFor(co));
      }
      return gapRow(co, statement, item, unit, reason);
    };

    allCos.forEach(co => {
      addCompanyHeader(sheet, co);

      /* ── P&L ── */
      addSectionHeader(sheet, "P&L");
      if (co === "Industry") {
        rowMap[`${co}|Industry PAT (Rs Cr)`] = inputRow(co, "P&L", "Industry PAT", "₹ Cr",
          (fy) => getInd(D, fy, "Industry PAT (Rs Cr)"),
          { src: "Sum of listed Indian PV OEM standalone PATs (Maruti+Hyundai+M&M+Tata)", url: "" },
          "industry PAT only computed where component OEM PATs are sourced");
        rowMap[`${co}|Average ASP`] = inputRow(co, "P&L", "Average ASP (₹ Lakh)", "₹ Lakh",
          (fy) => getInd(D, fy, "Average ASP (Rs Lakh)"),
          { src: "SIAM domestic PV ASP (industry weighted average)", url: "https://www.siam.in/statistics.aspx" });
      } else {
        /* Revenue: prefer the curated ABS_DATA hardcode (Maruti / Hyundai
           / M&M); fall back to the Screener-derived 'Net Sales (Rs Cr)'
           that derive-financials wrote into placeholder_data; then
           orGap will mark NA if neither is present. Tata PV-segment
           lands on the placeholder_data path via seed-tata-pv-segment.mjs. */
        rowMap[`${co}|Revenue`] = inputRow(co, "P&L", "Revenue / Net Sales", "₹ Cr",
          (fy) => {
            const v = getAbs(co, fy, "Revenue");
            if (v != null) return v;
            return getCM(D, co, fy, "Net Sales (Rs Cr)");
          },
          ABS_DATA[co] && Object.keys(ABS_DATA[co].byFY || {}).length
            ? ABS_DATA[co]
            : { src: `${co} Q4 Investor Presentation / Annual Report (segment revenue where applicable)`,
                url: (ABS_DATA[co] && ABS_DATA[co].url) || "" },
          "company filing not parsed for this FY");
        /* EBITDA — prefer the absolute disclosed in placeholder_data
           (Tata PV segment from Q4 IPs lands in `EBITDA (Rs Cr)`);
           else derive = Revenue × EBITDA Margin %. */
        const hasEbitdaAbs = (D.Company_FY_Metrics || []).some(r =>
          r.Company === co && r.Metric === "EBITDA (Rs Cr)" && r.Value != null);
        rowMap[`${co}|EBITDA`]     = inputRow(co, "P&L", "EBITDA", "₹ Cr",
          (fy) => {
            if (hasEbitdaAbs) {
              const e = getCM(D, co, fy, "EBITDA (Rs Cr)");
              if (e != null) return e;
            }
            const rev = getAbs(co, fy, "Revenue") ?? getCM(D, co, fy, "Net Sales (Rs Cr)");
            const m   = getCM(D, co, fy, "EBITDA Margin %");
            return (rev != null && m != null) ? Math.round(rev * m / 100) : null;
          },
          { src: hasEbitdaAbs
              ? `${co} Q4 Investor Presentation — segment EBITDA`
              : `Derived: Revenue × EBITDA Margin % (${(ABS_DATA[co] && ABS_DATA[co].src) || "OEM AR"})`,
            url:  (ABS_DATA[co] && ABS_DATA[co].url) || "" });
        /* P&L line items pulled from Screener (via derive-financials)
           where present; for OEMs where Depreciation isn't in the
           dataset but both EBITDA and EBIT are (Tata PV segment from
           Q4 IPs), derive D&A = EBITDA − EBIT — accounting identity
           that holds at segment level too. Falls back to a gap row
           only when neither D&A nor the EBITDA/EBIT pair is sourced. */
        rowMap[`${co}|Depreciation`] = (() => {
          const hasD = (D.Company_FY_Metrics || []).some(r =>
            r.Company === co && r.Metric === "Depreciation (Rs Cr)" && r.Value != null);
          if (hasD) return orGap(co, "P&L", "Depreciation & Amortisation", "₹ Cr",
            "Depreciation (Rs Cr)", "NA — Screener fetch not yet run for this OEM");
          const hasEbitda = (D.Company_FY_Metrics || []).some(r =>
            r.Company === co && r.Metric === "EBITDA (Rs Cr)" && r.Value != null);
          const hasEbit   = (D.Company_FY_Metrics || []).some(r =>
            r.Company === co && r.Metric === "EBIT (Rs Cr)" && r.Value != null);
          if (hasEbitda && hasEbit) {
            return inputRow(co, "P&L", "Depreciation & Amortisation", "₹ Cr",
              (fy) => {
                const e = getCM(D, co, fy, "EBITDA (Rs Cr)");
                const b = getCM(D, co, fy, "EBIT (Rs Cr)");
                return (e != null && b != null) ? e - b : null;
              },
              { src: `Derived: EBITDA − EBIT (both disclosed at segment level — ${co} Q4 Investor Presentation)`,
                url: (ABS_DATA[co] && ABS_DATA[co].url) || "" });
          }
          return gapRow(co, "P&L", "Depreciation & Amortisation", "₹ Cr",
            "NA — Depreciation not disclosed and EBITDA / EBIT pair not both sourced");
        })();
        /* EBIT — prefer the absolute disclosed in placeholder_data
           (Tata PV segment from Q4 IPs lands here); else compute
           = EBITDA − D&A. */
        const hasEbitAbs = (D.Company_FY_Metrics || []).some(r =>
          r.Company === co && r.Metric === "EBIT (Rs Cr)" && r.Value != null);
        rowMap[`${co}|EBIT`] = hasEbitAbs
          ? inputRow(co, "P&L", "EBIT", "₹ Cr",
              (fy) => getCM(D, co, fy, "EBIT (Rs Cr)"),
              { src: `${co} Q4 Investor Presentation — segment EBIT`,
                url: (ABS_DATA[co] && ABS_DATA[co].url) || "" })
          : formulaRow(co, "P&L", "EBIT", "₹ Cr",
              (fy) => {
                const e = `${fyColLetter(fy)}${rowMap[`${co}|EBITDA`]}`;
                const d = `${fyColLetter(fy)}${rowMap[`${co}|Depreciation`]}`;
                return `IFERROR(${e}-${d},"")`;
              }, '#,##0');
        rowMap[`${co}|Finance Cost`] = orGap(co, "P&L", "Finance Cost (Interest)", "₹ Cr",
          "Interest (Rs Cr)", "NA — Screener fetch not yet run for this OEM");
        rowMap[`${co}|PBT`]          = orGap(co, "P&L", "PBT (Profit Before Tax)", "₹ Cr",
          "PBT (Rs Cr)", "NA — Screener fetch not yet run for this OEM");
        rowMap[`${co}|Tax`]          = formulaRow(co, "P&L", "Tax Expense", "₹ Cr",
          (fy) => {
            const pbt = `${fyColLetter(fy)}${rowMap[`${co}|PBT`]}`;
            const pat = `${fyColLetter(fy)}${rowMap[`${co}|PAT`]}`;
            return `IFERROR(${pbt}-${pat},"")`;
          }, '#,##0');
        rowMap[`${co}|PAT`]        = inputRow(co, "P&L", "PAT", "₹ Cr",
          (fy) => getAbs(co, fy, "PAT") ?? getCM(D, co, fy, "Net Profit (Rs Cr)"),
          ABS_DATA[co], "company AR not parsed for this FY");
      }

      /* ── Balance Sheet ── */
      if (co !== "Industry") {
        addSectionHeader(sheet, "Balance Sheet");
        rowMap[`${co}|Total Assets`]    = orGap(co, "BS", "Total Assets", "₹ Cr",
          "Total Assets (Rs Cr)", "NA — Screener fetch not yet run for this OEM");
        /* Net Worth — try Screener-derived first; for Tata PV
           segment the official Q4 IP discloses Capital Employed
           (a segment-level Net Worth + allocated Net Debt proxy)
           which we use as the input. */
        rowMap[`${co}|Net Worth`] = (() => {
          const hasNW = (D.Company_FY_Metrics || []).some(r =>
            r.Company === co && r.Metric === "Net Worth (Rs Cr)" && r.Value != null);
          if (hasNW) return orGap(co, "BS", "Net Worth / Equity", "₹ Cr",
            "Net Worth (Rs Cr)", "NA — Screener fetch not yet run for this OEM");
          const hasCE = (D.Company_FY_Metrics || []).some(r =>
            r.Company === co && r.Metric === "Capital Employed (Rs Cr)" && r.Value != null);
          if (hasCE) return inputRow(co, "BS", "Capital Employed (segment proxy for Net Worth)", "₹ Cr",
            (fy) => getCM(D, co, fy, "Capital Employed (Rs Cr)"),
            { src: `${co} Q4 Investor Presentation — segment Capital Employed`,
              url: "https://www.tatamotors.com/investors/financials/quarterly-results/" });
          return gapRow(co, "BS", "Net Worth / Equity", "₹ Cr",
            "NA — entity-level only, segment Net Worth not separately disclosed");
        })();
        rowMap[`${co}|Total Debt`]      = orGap(co, "BS", "Total Debt (Borrowings)", "₹ Cr",
          "Borrowings (Rs Cr)", "NA — Screener fetch not yet run for this OEM");
        rowMap[`${co}|Cash`]            = orGap(co, "BS", "Cash & Investments", "₹ Cr",
          "Cash (Rs Cr)", "NA — Tijori fetch hasn't extracted the cash sub-line yet");
        rowMap[`${co}|Net Debt`]        = formulaRow(co, "BS", "Net Debt", "₹ Cr",
          (fy) => {
            const td = `${fyColLetter(fy)}${rowMap[`${co}|Total Debt`]}`;
            const cs = `${fyColLetter(fy)}${rowMap[`${co}|Cash`]}`;
            return `IFERROR(${td}-${cs},"")`;
          }, '#,##0');
        rowMap[`${co}|Receivables`]     = orGap(co, "BS", "Receivables", "₹ Cr",
          "Receivables (Rs Cr)", "NA — Tijori fetch hasn't extracted this BS sub-line yet");
        rowMap[`${co}|Inventory`]       = orGap(co, "BS", "Inventory", "₹ Cr",
          "Inventory (Rs Cr)", "NA — Tijori fetch hasn't extracted this BS sub-line yet");
        rowMap[`${co}|Payables`]        = orGap(co, "BS", "Payables", "₹ Cr",
          "Payables (Rs Cr)", "NA — Tijori fetch hasn't extracted this BS sub-line yet");
        /* Working Capital absolute = Working Capital Days × Revenue / 365.
           WC Days is sourced from Screener / AR ratios; this gives a
           usable Working Capital number while Receivables / Inventory /
           Payables stay NA. Revenue uses the same fallback chain as
           the Revenue row itself — getAbs first, then Net Sales (Rs Cr)
           from placeholder_data — otherwise Tata PV (which has empty
           ABS_DATA.byFY) would render blank here. */
        rowMap[`${co}|Working Capital`] = inputRow(co, "BS", "Working Capital", "₹ Cr",
          (fy) => {
            const rev = getAbs(co, fy, "Revenue") ?? getCM(D, co, fy, "Net Sales (Rs Cr)");
            const days = getCM(D, co, fy, "Working Capital Days");
            return (rev != null && days != null) ? Math.round(days * rev / 365) : null;
          },
          { src: "Derived: Working Capital Days × Revenue / 365 (Days from Screener / AR ratios)",
            url: (ABS_DATA[co] && ABS_DATA[co].url) || "" });
      }

      /* ── Cash Flow ── */
      if (co !== "Industry") {
        addSectionHeader(sheet, "Cash Flow");
        rowMap[`${co}|CFO`]   = orGap(co, "CF", "CFO (Cash from Operations)", "₹ Cr",
          "CFO (Rs Cr)", "NA — Screener fetch not yet run for this OEM");
        rowMap[`${co}|Capex`] = inputRow(co, "CF", "Capex", "₹ Cr",
          (fy) => getCM(D, co, fy, "Capex (Rs Cr)"),
          { src: `${co} Annual Report — cash flow statement / Q4 IP`,
            url: ABS_DATA[co] && ABS_DATA[co].url || "" });
        rowMap[`${co}|FCF`]   = formulaRow(co, "CF", "Free Cash Flow", "₹ Cr",
          (fy) => {
            const cfo = `${fyColLetter(fy)}${rowMap[`${co}|CFO`]}`;
            const cx  = `${fyColLetter(fy)}${rowMap[`${co}|Capex`]}`;
            return `IFERROR(${cfo}-${cx},"")`;
          }, '#,##0');
        rowMap[`${co}|CFI`]   = orGap(co, "CF", "Cash Flow from Investing", "₹ Cr",
          "Cash from Investing (Rs Cr)", "NA — Screener fetch not yet run for this OEM");
        rowMap[`${co}|CFF`]   = orGap(co, "CF", "Cash Flow from Financing", "₹ Cr",
          "Cash from Financing (Rs Cr)", "NA — Screener fetch not yet run for this OEM");
      }

      /* ── Operating Data ── */
      addSectionHeader(sheet, "Operating Data");
      if (co === "Industry") {
        rowMap[`${co}|Industry Volume`] = inputRow(co, "OPS", "Industry PV Volume", "units",
          (fy) => getInd(D, fy, "Total PV Volume"),
          { src: "SIAM domestic PV total", url: "https://www.siam.in/statistics.aspx" });
      } else {
        rowMap[`${co}|Total Sales Volume`] = inputRow(co, "OPS", "Total Sales Volume", "units",
          (fy) => getCM(D, co, fy, "Total Sales Volume"),
          { src: `${co} Annual Report / monthly sales press release`,
            url: ABS_DATA[co] && ABS_DATA[co].url || "" });
        /* Volume mix absolutes computed from total × respective % —
           exact arithmetic; the % is sourced from each OEM's monthly
           sales PR / Q4 IP. Pre-computing here as input values lets
           the PV tab divide cleanly back without circular formulas. */
        const volMix = (key) => (fy) => {
          const tot = getCM(D, co, fy, "Total Sales Volume");
          const pct = getCM(D, co, fy, key);
          return (tot != null && pct != null) ? Math.round(tot * pct / 100) : null;
        };
        const volSrc = (m) => ({
          src: `Derived: Total Sales Volume × ${m} (% from ${co} AR / Q4 IP)`,
          url: (ABS_DATA[co] && ABS_DATA[co].url) || "",
        });
        rowMap[`${co}|Domestic Volume`] = inputRow(co, "OPS", "Domestic Volume", "units",
          (fy) => {
            const tot = getCM(D, co, fy, "Total Sales Volume");
            const expPct = getCM(D, co, fy, "Export Volume %");
            return (tot != null && expPct != null) ? Math.round(tot * (1 - expPct / 100)) : null;
          }, volSrc("(1 − Export Volume %)"));
        rowMap[`${co}|Export Volume`]   = inputRow(co, "OPS", "Export Volume", "units",
          volMix("Export Volume %"), volSrc("Export Volume %"));
        rowMap[`${co}|EV Volume`]       = inputRow(co, "OPS", "EV Volume", "units",
          volMix("EV Volume %"), volSrc("EV Volume %"));
        rowMap[`${co}|SUV Volume`]      = inputRow(co, "OPS", "SUV / UV Volume", "units",
          volMix("SUV Volume %"), volSrc("SUV Volume %"));
        rowMap[`${co}|Capacity`]        = inputRow(co, "OPS", "Capacity", "units",
          (fy) => getCM(D, co, fy, "Capacity (units)"),
          { src: `${co} Annual Report — installed annual capacity`,
            url: ABS_DATA[co] && ABS_DATA[co].url || "" });
        rowMap[`${co}|Employees`]       = inputRow(co, "OPS", "Employees", "count",
          (fy) => getInfo(D, co, fy, "Employees"),
          { src: `${co} Annual Report — FY-end headcount`, url: "" });
        rowMap[`${co}|Dealers`]         = inputRow(co, "OPS", "Dealers / Sales Outlets", "count",
          (fy) => getInfo(D, co, fy, "Dealers"),
          { src: `${co} Annual Report / Q4 IP — dealer count`, url: "" });
      }
    });

    /* Column widths */
    sheet.getColumn(1).width = 16;
    sheet.getColumn(2).width = 11;
    sheet.getColumn(3).width = 32;
    sheet.getColumn(4).width = 8;
    for (let i = FY_COL_OFFSET; i <= FY_COL_OFFSET + FYS_MODEL.length - 1; i++) sheet.getColumn(i).width = 13;
    sheet.getColumn(16).width = 56;
    sheet.getColumn(17).width = 30;
    sheet.getColumn(18).width = 13;
    sheet.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];

    return rowMap;
  }

  /* ──────────────────────────────────────────
     Tab 1.5: PctInputs (raw % inputs)
     The percentages we have only as ratios (not absolutes) live
     here so derived absolutes in Financials_3Statement can reference
     them without polluting that tab. Returns row map. */
  function buildPctInputs(wb, D) {
    const sheet = wb.addWorksheet("PctInputs", { properties: { tabColor: { argb: "FF0EA5E9" } } });

    const head = ["Company", "Statement", "Line Item", "Unit"];
    FYS_MODEL.forEach(fy => head.push(fy));
    head.push("Source"); head.push("Source URL"); head.push("Last Updated");
    sheet.addRow(head);
    const hr = sheet.getRow(1);
    hr.height = 26;
    hr.eachCell({ includeEmpty: false }, c => {
      c.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0369A1" } };
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = thinBorders();
    });

    const rowMap = {};
    ALL_OEMS.forEach(co => {
      addCompanyHeader(sheet, co);
      const pct = (item, metric) => {
        rowMap[`${co}|${metric}_input`] = addModelRow(sheet, {
          co, statement: "PCT", item, unit: "%", kind: "input",
          getValue: (fy) => getCM(D, co, fy, metric),
          srcMetric: metric, srcCompany: co,
        }, D, '0.00');
      };
      /* Margin / ratio inputs the dashboard publishes as %.
         These are 'Source Percentage Input' per the spec. */
      pct("Gross Margin %",       "Gross Margin %");
      pct("EBITDA Margin %",      "EBITDA Margin %");
      pct("PAT Margin %",         "PAT Margin %");
      pct("Capex Intensity %",    "Capex Intensity %");
      pct("WC Days",              "Working Capital Days");
      pct("Capacity Utilisation %", "Capacity Utilisation %");
      pct("Export Volume %",      "Export Volume %");
      pct("EV Volume %",          "EV Volume %");
      pct("SUV Volume %",         "SUV Volume %");
      pct("Export Revenue %",     "Export Revenue %");
      pct("EV Revenue %",         "EV Revenue %");
      pct("SUV Revenue %",        "SUV Revenue %");
      pct("Market Share %",       "Market Share %");
      /* Source-percentage growth inputs — used as fallback by the
         Calculations tab when an absolute Revenue / Volume is not
         available (e.g. Tata PV-segment revenue not co-disclosed). */
      pct("Revenue Growth %",     "Revenue Growth %");
      pct("Volume Growth %",      "Volume Growth %");
      pct("Realisation Growth %", "Realisation Growth %");
    });

    sheet.getColumn(1).width = 16;
    sheet.getColumn(2).width = 8;
    sheet.getColumn(3).width = 26;
    sheet.getColumn(4).width = 8;
    for (let i = FY_COL_OFFSET; i <= FY_COL_OFFSET + FYS_MODEL.length - 1; i++) sheet.getColumn(i).width = 11;
    sheet.getColumn(16).width = 50;
    sheet.getColumn(17).width = 30;
    sheet.getColumn(18).width = 13;
    sheet.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];

    return rowMap;
  }

  /* ──────────────────────────────────────────
     Tab 2: Calculations
     Every dashboard ratio derived as an Excel formula referencing
     Financials_3Statement (and PctInputs where we only have %).
     Returns row map keyed by `${co}|${dashboardMetric}`. */
  function buildCalculations(wb, D, absMap) {
    const sheet = wb.addWorksheet("Calculations", { properties: { tabColor: { argb: "FF059669" } } });

    const head = ["Company", "Statement", "Line Item", "Unit"];
    FYS_MODEL.forEach(fy => head.push(fy));
    head.push("Source"); head.push("Source URL"); head.push("Last Updated");
    sheet.addRow(head);
    const hr = sheet.getRow(1);
    hr.height = 26;
    hr.eachCell({ includeEmpty: false }, c => {
      c.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } };
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = thinBorders();
    });

    const calcMap = {};
    const FA = "'Financials_3Statement'!";
    const PI = "'PctInputs'!";
    const yoyShift = (fy) => {
      const i = FYS_MODEL.indexOf(fy);
      return i > 0 ? FYS_MODEL[i - 1] : null;
    };

    ALL_OEMS.forEach(co => {
      addCompanyHeader(sheet, co);
      addSectionHeader(sheet, "Growth");

      calcMap[`${co}|Revenue Growth %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "Revenue Growth %", unit: "%", kind: "formula",
        formula: (fy) => {
          const prev = yoyShift(fy); if (!prev) return "";
          const cur  = `${FA}${fyColLetter(fy)}${absMap[`${co}|Revenue`]}`;
          const pre  = `${FA}${fyColLetter(prev)}${absMap[`${co}|Revenue`]}`;
          /* Fall back to PctInputs (Tata PV revenue not co-disclosed
             at segment level → use curated Revenue Growth %). */
          const fallback = absMap[`${co}|Revenue Growth %_input`]
            ? `${PI}${fyColLetter(fy)}${absMap[`${co}|Revenue Growth %_input`]}`
            : `""`;
          return `IFERROR((${cur}/${pre}-1)*100,${fallback})`;
        },
      }, D, '0.00"%"');

      calcMap[`${co}|Volume Growth %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "Volume Growth %", unit: "%", kind: "formula",
        formula: (fy) => {
          const prev = yoyShift(fy); if (!prev) return "";
          const cur  = `${FA}${fyColLetter(fy)}${absMap[`${co}|Total Sales Volume`]}`;
          const pre  = `${FA}${fyColLetter(prev)}${absMap[`${co}|Total Sales Volume`]}`;
          return `IFERROR((${cur}/${pre}-1)*100,"")`;
        },
      }, D, '0.00"%"');

      calcMap[`${co}|Realisation Growth %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "Realisation Growth %", unit: "%", kind: "formula",
        formula: (fy) => {
          const r = calcMap[`${co}|Revenue Growth %`];
          const v = calcMap[`${co}|Volume Growth %`];
          const rg = `${fyColLetter(fy)}${r}`;
          const vg = `${fyColLetter(fy)}${v}`;
          return `IFERROR(((1+${rg}/100)/(1+${vg}/100)-1)*100,"")`;
        },
      }, D, '0.00"%"');

      addSectionHeader(sheet, "Margins");
      calcMap[`${co}|Gross Margin %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "Gross Margin %", unit: "%", kind: "formula",
        formula: (fy) => `${PI}${fyColLetter(fy)}${absMap[`${co}|Gross Margin %_input`] || ""}`,
      }, D, '0.00"%"');
      calcMap[`${co}|EBITDA Margin %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "EBITDA Margin %", unit: "%", kind: "formula",
        formula: (fy) => `${PI}${fyColLetter(fy)}${absMap[`${co}|EBITDA Margin %_input`] || ""}`,
      }, D, '0.00"%"');
      calcMap[`${co}|PAT Margin %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "PAT Margin %", unit: "%", kind: "formula",
        formula: (fy) => {
          const pat = `${FA}${fyColLetter(fy)}${absMap[`${co}|PAT`]}`;
          const rev = `${FA}${fyColLetter(fy)}${absMap[`${co}|Revenue`]}`;
          /* Prefer the absolute-derived margin; fall back to the
             curated PctInputs entry when either absolute is blank
             (e.g. Tata PV-segment PAT not co-disclosed). */
          const fallback = absMap[`${co}|PAT Margin %_input`]
            ? `${PI}${fyColLetter(fy)}${absMap[`${co}|PAT Margin %_input`]}`
            : `""`;
          return `IFERROR(${pat}/${rev}*100,${fallback})`;
        },
      }, D, '0.00"%"');

      addSectionHeader(sheet, "Capital");
      calcMap[`${co}|Capex Intensity %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "Capex Intensity %", unit: "%", kind: "formula",
        formula: (fy) => {
          const cx  = `${FA}${fyColLetter(fy)}${absMap[`${co}|Capex`]}`;
          const rev = `${FA}${fyColLetter(fy)}${absMap[`${co}|Revenue`]}`;
          const fallback = absMap[`${co}|Capex Intensity %_input`]
            ? `${PI}${fyColLetter(fy)}${absMap[`${co}|Capex Intensity %_input`]}`
            : `""`;
          return `IFERROR(${cx}/${rev}*100,${fallback})`;
        },
      }, D, '0.00"%"');
      calcMap[`${co}|Working Capital Days`] = addModelRow(sheet, {
        co, statement: "DRV", item: "Working Capital Days", unit: "days", kind: "formula",
        formula: (fy) => `${PI}${fyColLetter(fy)}${absMap[`${co}|WC Days_input`] || ""}`,
      }, D, '0');
      calcMap[`${co}|Capacity Utilisation %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "Capacity Utilisation %", unit: "%", kind: "formula",
        formula: (fy) => {
          const v = `${FA}${fyColLetter(fy)}${absMap[`${co}|Total Sales Volume`]}`;
          const k = `${FA}${fyColLetter(fy)}${absMap[`${co}|Capacity`]}`;
          return `IFERROR(${v}/${k}*100,"")`;
        },
      }, D, '0.00"%"');

      addSectionHeader(sheet, "Mix Ratios");
      calcMap[`${co}|Export Volume %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "Export Volume %", unit: "%", kind: "formula",
        formula: (fy) => `${PI}${fyColLetter(fy)}${absMap[`${co}|Export Volume %_input`] || ""}`,
      }, D, '0.00"%"');
      calcMap[`${co}|EV Volume %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "EV Volume %", unit: "%", kind: "formula",
        formula: (fy) => `${PI}${fyColLetter(fy)}${absMap[`${co}|EV Volume %_input`] || ""}`,
      }, D, '0.00"%"');
      calcMap[`${co}|SUV Volume %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "SUV Volume %", unit: "%", kind: "formula",
        formula: (fy) => `${PI}${fyColLetter(fy)}${absMap[`${co}|SUV Volume %_input`] || ""}`,
      }, D, '0.00"%"');
      calcMap[`${co}|Market Share %`] = addModelRow(sheet, {
        co, statement: "DRV", item: "Market Share %", unit: "%", kind: "formula",
        formula: (fy) => `${PI}${fyColLetter(fy)}${absMap[`${co}|Market Share %_input`] || ""}`,
      }, D, '0.00"%"');
    });

    sheet.getColumn(1).width = 16;
    sheet.getColumn(2).width = 8;
    sheet.getColumn(3).width = 26;
    sheet.getColumn(4).width = 8;
    for (let i = FY_COL_OFFSET; i <= FY_COL_OFFSET + FYS_MODEL.length - 1; i++) sheet.getColumn(i).width = 12;
    sheet.getColumn(16).width = 50;
    sheet.getColumn(17).width = 30;
    sheet.getColumn(18).width = 13;
    sheet.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];

    return calcMap;
  }

  /* ──────────────────────────────────────────
     Tab: Missing_Data_Log
     Every (Company, FY, Metric) cell that ended up blank in
     Financials_3Statement gets one row here so analysts know
     exactly where to dig. */
  function buildMissingDataLog(wb) {
    const sheet = wb.addWorksheet("Missing_Data_Log", { properties: { tabColor: { argb: "FFB91C1C" } } });
    sheet.addRow(["Company", "Metric", "FY", "Source Checked", "Reason Missing", "Action Required"]);
    const hr = sheet.getRow(1);
    hr.eachCell({ includeEmpty: false }, c => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF991B1B" } };
      c.alignment = { vertical: "middle", horizontal: "left" };
      c.border = thinBorders();
    });
    hr.height = 22;

    /* Group by (Company, Metric) and consolidate consecutive FYs
       so the log doesn't have one row per cell — much easier to
       scan ("Maruti / Working Capital / FY16-FY25"). */
    const grouped = {};
    _missingLog.forEach(m => {
      const k = `${m.co}|${m.metric}`;
      grouped[k] = grouped[k] || { co: m.co, metric: m.metric, fys: [], src: m.sourceChecked, reason: m.reason, action: m.action };
      grouped[k].fys.push(m.fy);
    });
    Object.values(grouped).forEach(g => {
      const fys = g.fys.sort();
      const fyRange = fys.length > 1 ? `${fys[0]}–${fys[fys.length-1]} (${fys.length} FYs)` : fys[0];
      sheet.addRow([g.co, g.metric, fyRange, g.src, g.reason, g.action]);
      const r = sheet.lastRow;
      r.eachCell({ includeEmpty: false }, c => {
        c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        c.font = { size: 10, color: { argb: "FF1F2A37" } };
        c.border = thinBorders();
      });
    });

    sheet.getColumn(1).width = 16;
    sheet.getColumn(2).width = 30;
    sheet.getColumn(3).width = 22;
    sheet.getColumn(4).width = 56;
    sheet.getColumn(5).width = 56;
    sheet.getColumn(6).width = 36;
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: 6 } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  /* ──────────────────────────────────────────
     Tab N: Model_Checks
     Light validation that the dashboard equals the calculation
     layer for a few sentinel metrics. */
  function buildModelChecks(wb, calcMap, pvMap) {
    const sheet = wb.addWorksheet("Model_Checks", { properties: { tabColor: { argb: "FFB45309" } } });
    sheet.addRow(["Check", "Detail", "Result"]);
    const hr = sheet.getRow(1);
    hr.eachCell({ includeEmpty: false }, c => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF92400E" } };
      c.alignment = { horizontal: "left" };
      c.border = thinBorders();
    });
    const checks = [
      ["FY count", "FY16-FY26 = 11 columns", FYS_MODEL.length === 11 ? "OK" : "FAIL"],
      ["Calculations tab", "Has Maruti Revenue Growth %", calcMap["Maruti|Revenue Growth %"] ? "OK" : "FAIL"],
      ["Calculations tab", "Has Hyundai PAT Margin %", calcMap["Hyundai|PAT Margin %"] ? "OK" : "FAIL"],
      ["Calculations tab", "Has M&M Capex Intensity %", calcMap["M&M|Capex Intensity %"] ? "OK" : "FAIL"],
      ["Calculations tab", "Has Tata Capacity Utilisation %", calcMap["Tata Motors PV|Capacity Utilisation %"] ? "OK" : "FAIL"],
      ["PV tab", "References Calculations for Revenue Growth %", pvMap.formulaCount > 0 ? "OK" : "FAIL"],
      ["Formula count on PV", "Total formula cells emitted into PV from Calculations", String(pvMap.formulaCount || 0)],
    ];
    checks.forEach(c => {
      sheet.addRow(c);
      const row = sheet.lastRow;
      row.eachCell({ includeEmpty: false }, cell => {
        cell.alignment = { horizontal: "left", vertical: "middle" };
        cell.border = thinBorders();
      });
      const result = row.getCell(3);
      if (result.value === "OK") result.font = { bold: true, color: { argb: "FF065F46" } };
      else if (result.value === "FAIL") result.font = { bold: true, color: { argb: "FFB91C1C" } };
    });
    sheet.getColumn(1).width = 24;
    sheet.getColumn(2).width = 60;
    sheet.getColumn(3).width = 14;
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  /* ──────────────────────────────────────────
     Sheet builders
     ────────────────────────────────────────── */

  function buildPV(wb, D, models) {
    const sheet = wb.addWorksheet("PV", { properties: { tabColor: { argb: PURPLE } } });
    const yearCount = YEAR_END - YEAR_START + 1;
    /* ctx threads the formula maps through appendBlock so PV cells
       become live formulas referencing Calculations / Financials_3Statement. */
    const ctx = { calcMap: (models && models.calcMap) || null,
                  absMap:  (models && models.absMap)  || null,
                  formulaCount: 0 };

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
    appendBlock(sheet, "Industry", [...INDUSTRY_ROWS, ...indExtras], null, D, ctx);

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
      appendBlock(sheet, co.toUpperCase(), [...OEM_ROWS, ...extras], co, D, ctx);
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
    return ctx;
  }

  function buildSources(wb, D, absMap) {
    const sheet = wb.addWorksheet("Sources", { properties: { tabColor: { argb: "FF6B7280" } } });
    /* Schema per the simplified spec:
         Company | Metric | FY | Value | Unit | Source Name |
         Source URL | Source Type | Notes
       Source Type ∈ Annual Report / Screener / Investor Presentation
                    / Exchange Filing / Dashboard Existing Data /
                    Derived Formula / Not Available */
    sheet.addRow(["Company", "Metric", "FY", "Value", "Unit", "Source Name", "Source URL", "Source Type", "Notes"]);
    const hr = sheet.getRow(1);
    hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    hr.alignment = { vertical: "middle", horizontal: "left" };
    hr.height = 24;

    /* Source-Type classifier — maps each metric label to one of the
       enumerated values. */
    const classifyType = (label, value, sourceLabel) => {
      if (value === "NA" || value == null) return "Not Available";
      if (/^Derived:/i.test(sourceLabel || "")) return "Derived Formula";
      if (/Screener/i.test(sourceLabel || "")) return "Screener";
      if (/DRHP|Q4 Investor Presentation|Investor Presentation|Q4 IP/i.test(sourceLabel || "")) return "Investor Presentation";
      if (/Annual Report/i.test(sourceLabel || "")) return "Annual Report";
      if (/MCA|exchange|NSE|BSE|press release|sebi/i.test(sourceLabel || "")) return "Exchange Filing";
      if (sourceLabel) return "Dashboard Existing Data";
      return "Not Available";
    };
    const unitFor = (label) => {
      if (/%$/.test(label)) return "%";
      if (/Days$/.test(label)) return "days";
      if (/₹ Cr|Rs Cr/i.test(label)) return "₹ Cr";
      if (/₹ Lakh|Rs Lakh/i.test(label)) return "₹ Lakh";
      if (/Volume|Capacity|Employees|Dealers/i.test(label)) return "units";
      if (/Stock Price/i.test(label)) return "₹";
      return "";
    };

    const fyIdx = (fy) => FYS_MODEL.indexOf(fy);

    /* 1) Walk every Absolute_Numbers row and emit one Sources entry
       per (Company, Metric, FY) combination using the source label
       captured during build. This is the audit trail for the
       absolute data. */
    const absSheet = wb.getWorksheet("Absolute_Numbers");
    if (absSheet) {
      absSheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
        if (rowNum === 1) return;                         // header
        const co        = row.getCell(1).value;
        const statement = row.getCell(2).value;
        const item      = row.getCell(3).value;
        const unit      = row.getCell(4).value;
        if (!co || !item || statement == null) return;     // skip section/company headers
        const srcName = row.getCell(16).value || "";
        const srcUrl  = row.getCell(17).value || "";
        const srcDate = row.getCell(18).value || "";
        FYS_MODEL.forEach((fy, i) => {
          const v = row.getCell(FY_COL_OFFSET + i).value;
          let displayValue = v;
          let notes = "";
          if (v && typeof v === "object" && "formula" in v) {
            displayValue = `=${v.formula}`;
            notes = "Excel formula";
          }
          if (v === "NA") notes = srcName || "absolute not in captured summary";
          sheet.addRow([
            co, item, fy, displayValue, unit || unitFor(item),
            srcName, srcUrl,
            classifyType(item, v, srcName),
            notes,
          ]);
        });
      });
    }

    /* 2) Append source rows for the dashboard's % / source-percentage
       inputs (Margins, Mix %, etc.) which live in placeholder_data
       rather than Absolute_Numbers. */
    const cm = (D.Company_FY_Metrics || []);
    const im = (D.Industry_FY_Metrics || []).map(r => ({ ...r, Company: "Industry" }));
    [...im, ...cm].forEach(r => {
      if (!r.Metric || !r.FY) return;
      if (!FYS_MODEL.includes(r.FY)) return;
      sheet.addRow([
        r.Company || "Industry",
        r.Metric,
        r.FY,
        (r.Value === "Pending" || r.Value === undefined) ? "NA" : r.Value,
        unitFor(r.Metric),
        (r.Source && r.Source !== "Pending") ? r.Source : "",
        r.Source_URL || "",
        classifyType(r.Metric, r.Value, r.Source || ""),
        r.Last_Updated ? `Last updated ${r.Last_Updated}` : "",
      ]);
    });

    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: 9 } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    /* Per-column widths sized to the spec. */
    [16, 30, 8, 14, 8, 56, 30, 22, 36].forEach((w, i) => sheet.getColumn(i + 1).width = w);

    /* Style data rows. */
    sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      row.eachCell({ includeEmpty: false }, c => {
        c.font = { size: 10, color: { argb: "FF1F2A37" } };
        c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        c.border = thinBorders();
      });
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
      wb.title   = "Munshot PV Dashboard Export";

      /* 3-tab workbook only: Absolute_Numbers (sourced data) →
         PV (formula-linked dashboard) → Sources (audit trail).
         Backend-y tabs (PctInputs / Calculations / Model_Checks /
         Missing_Data_Log / Dictionary) are intentionally NOT built. */
      const absMap = buildAbsoluteNumbers(wb, D);
      buildPV(wb, D, { absMap });
      buildSources(wb, D, absMap);

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Munshot PV Dashboard Export ${new Date().toISOString().slice(0, 10)}.xlsx`;
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
