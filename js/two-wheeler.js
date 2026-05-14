/* =============================================================
   Two-Wheeler dashboard view
   -------------------------------------------------------------
   Self-contained, fully separate from the PV pipeline. Renders
   into #tw-main when the segment switcher selects "2W". CV
   continues to use the under-construction overlay.

   Data is illustrative until the 2W data pipeline lands. All
   numbers are hand-seeded for FY16..FY25 (10-year window).
   ============================================================= */
(function () {
  "use strict";

  const FYS = ["FY16","FY17","FY18","FY19","FY20","FY21","FY22","FY23","FY24","FY25"];

  /* Indian 2W OEM coverage list. FY24/FY25 used by the KPI strip
     and the supporting-data table; the full 10-year arrays drive
     the chart. */
  const COMPANIES = {
    hero: {
      name: "Hero MotoCorp",
      initials: "HMC",
      color: "#E31E24",
      colorSoft: "#FEE2E2",
      tag: "Volume leader · commuter focus",
      series: {
        "Revenue Growth %":     [-1.5,  6.0, 13.5,  7.5,-15.2,  4.6, -3.2,  9.3,  6.1,  9.4],
        "Volume Growth %":      [ 2.0,  5.7, 12.8,  3.7,-17.2,-13.4, -4.5,  6.6,  5.4,  6.2],
        "Realisation Growth %": [-3.4,  0.3,  0.6,  3.7,  2.4, 20.8,  1.4,  2.5,  0.7,  3.0],
        "EBITDA Margin %":      [16.7, 16.5, 16.5, 14.5, 13.9, 13.4, 11.5, 12.6, 13.9, 14.7],
        "PAT Margin %":         [12.0, 11.6, 11.4,  9.7,  9.4,  9.2,  7.6,  8.4,  9.4, 10.1],
        "Gross Margin %":       [31.5, 31.0, 31.2, 29.0, 28.4, 28.0, 26.8, 28.5, 30.5, 32.0],
        "Borrowings":           [   3,    1,    1,    1,    1,    1,    1,    1,   60,   55],
        "Reserves":             [6900, 8200, 9500,10800,11200,12100,13200,14400,16200,18500],
        "Total Assets":         [10500,12100,14000,15200,15800,17000,18400,19800,23400,25800],
        "CFO":                  [4100, 4250, 4400, 3850, 3200, 3450, 2900, 3800, 4200, 4600],
        "CFI":                  [-1100,-1300,-1500,-1700,-1200,-1400,-1600,-1900,-1800,-2100],
        "CFF":                  [-2400,-2600,-2700,-2300,-1900,-2200,-2400,-2500,-2500,-2700],
        "Capex":                [ 480,  520,  680,  780,  620,  720,  780,  820,  850,  950],
        "Capex Intensity %":    [ 1.6,  1.7,  2.1,  2.4,  2.3,  2.6,  2.5,  2.4,  2.4,  2.5],
        "Company Share %":      [37.5, 36.8, 35.6, 34.2, 36.4, 36.1, 33.4, 31.8, 30.5, 28.6],
        "Industry Share %":     [ 100,  100,  100,  100,  100,  100,  100,  100,  100,  100],
        "Scooters %":           [11.8, 12.5, 12.0, 11.5, 10.8, 11.0, 11.8, 12.0, 12.4, 13.1],
        "Motorcycles %":        [87.4, 86.6, 86.9, 87.5, 88.4, 88.2, 87.4, 86.6, 82.6, 81.0],
        "EV %":                 [   0,    0,    0,    0,    0,    0,    0,  0.2,  0.8,  2.4],
        "Exports %":            [ 2.8,  3.1,  3.5,  4.0,  3.6,  3.9,  4.5,  4.8,  4.2,  5.8],
        "Premium %":            [ 2.5,  2.8,  3.0,  3.4,  3.6,  3.8,  4.2,  5.0,  6.2,  8.4],
      },
    },
    bajaj: {
      name: "Bajaj Auto",
      initials: "BAL",
      color: "#0046A8",
      colorSoft: "#DBEAFE",
      tag: "Exports + premium powerhouse",
      series: {
        "Revenue Growth %":     [ -7.2,  3.5, 23.1, 18.5,-12.0,  4.2, 19.5, 18.2, 16.8, 22.4],
        "Volume Growth %":      [ -5.5,  2.1, 14.8,  8.6,-10.4, -2.1, 12.6,  4.4,  3.8, 14.2],
        "Realisation Growth %": [ -1.8,  1.4,  7.2,  9.1, -1.8,  6.4,  6.1, 13.2, 12.5,  7.2],
        "EBITDA Margin %":      [ 21.0, 19.5, 19.8, 16.5, 18.1, 18.4, 16.5, 17.8, 19.2, 20.4],
        "PAT Margin %":         [ 17.5, 16.8, 16.5, 14.2, 16.1, 17.0, 14.8, 15.5, 17.2, 18.6],
        "Gross Margin %":       [ 32.0, 30.8, 30.4, 28.1, 29.5, 29.8, 28.2, 29.8, 31.5, 32.6],
        "Borrowings":           [  120,  100,  100,  120,  130,  140,  150,  160,  180,  185],
        "Reserves":             [11500,13200,15000,17800,19400,22100,24800,28000,32500,38200],
        "Total Assets":         [16800,18900,21200,25500,28000,31500,34800,38500,44200,50500],
        "CFO":                  [ 3800, 4100, 4500, 4800, 3900, 4400, 4700, 5800, 6900, 8200],
        "CFI":                  [-1000,-1200,-1400,-1500,-1600,-1700,-1900,-2200,-2400,-2800],
        "CFF":                  [-2500,-2700,-2900,-3000,-2400,-2600,-2700,-3200,-3800,-4500],
        "Capex":                [  280,  320,  420,  580,  520,  610,  720,  840,  980, 1150],
        "Capex Intensity %":    [  1.2,  1.4,  1.6,  1.9,  2.0,  2.2,  2.3,  2.4,  2.5,  2.6],
        "Company Share %":      [ 11.5, 10.8, 10.2, 11.2, 12.4, 13.6, 14.2, 15.0, 15.6, 16.4],
        "Industry Share %":     [  100,  100,  100,  100,  100,  100,  100,  100,  100,  100],
        "Scooters %":           [    0,    0,    0,    0,    0,    0,    0,    0,    0,  1.2],
        "Motorcycles %":        [100.0,100.0,100.0,100.0,100.0,100.0, 99.6, 99.0, 98.4, 96.8],
        "EV %":                 [    0,    0,    0,    0,    0,    0,  0.4,  1.0,  1.6,  2.0],
        "Exports %":            [ 38.5, 39.2, 40.8, 42.1, 41.5, 43.8, 44.6, 41.2, 38.6, 39.5],
        "Premium %":            [ 22.0, 23.5, 25.1, 26.8, 27.2, 28.5, 30.4, 32.0, 34.5, 37.2],
      },
    },
    tvs: {
      name: "TVS Motor",
      initials: "TVS",
      color: "#5B7CFA",
      colorSoft: "#E0E7FF",
      tag: "Diversified · EV momentum",
      series: {
        "Revenue Growth %":     [  3.5, 10.2, 18.6, 23.8, -2.0, 18.5, 25.5, 20.8, 14.5, 14.2],
        "Volume Growth %":      [  5.2,  9.5, 12.4, 16.0, -8.5, 10.4, 17.2, 13.5, 12.5, 13.4],
        "Realisation Growth %": [ -1.6,  0.6,  5.5,  6.7,  7.1,  7.3,  7.1,  6.4,  1.8,  0.7],
        "EBITDA Margin %":      [  6.5,  7.2,  7.8,  8.4,  9.2,  9.5, 10.2, 10.6, 11.4, 12.1],
        "PAT Margin %":         [  3.8,  4.1,  4.4,  4.6,  3.5,  4.4,  5.8,  6.4,  7.2,  8.0],
        "Gross Margin %":       [ 23.5, 23.8, 24.2, 24.5, 25.1, 25.4, 26.0, 26.4, 27.1, 27.6],
        "Borrowings":           [ 1200, 1450, 1800, 2400, 3200, 3800, 4500, 5200, 5800, 6200],
        "Reserves":             [ 1900, 2200, 2600, 3100, 3500, 4100, 5000, 6200, 7800, 9600],
        "Total Assets":         [ 5500, 6400, 7800, 9500,11200,12800,15200,18000,21500,25500],
        "CFO":                  [  650,  820, 1050, 1280, 1450, 1620, 1850, 2400, 3100, 3800],
        "CFI":                  [ -500, -650, -820, -980,-1050,-1180,-1400,-1700,-2000,-2400],
        "CFF":                  [ -100, -150, -200, -250, -300, -350, -400, -500, -700, -950],
        "Capex":                [  450,  580,  720,  880,  920, 1040, 1200, 1450, 1750, 2100],
        "Capex Intensity %":    [  3.4,  3.8,  4.0,  4.2,  4.6,  4.7,  4.7,  4.6,  4.7,  5.0],
        "Company Share %":      [ 13.4, 13.9, 14.4, 15.2, 15.8, 16.4, 17.6, 18.2, 19.0, 19.8],
        "Industry Share %":     [  100,  100,  100,  100,  100,  100,  100,  100,  100,  100],
        "Scooters %":           [ 28.5, 29.4, 30.6, 31.8, 32.4, 33.2, 34.5, 35.6, 36.8, 38.0],
        "Motorcycles %":        [ 71.5, 70.6, 69.4, 68.2, 67.6, 66.8, 64.5, 62.4, 59.6, 56.4],
        "EV %":                 [    0,    0,    0,    0,    0,    0,  1.0,  2.0,  3.6,  5.6],
        "Exports %":            [ 15.8, 16.2, 17.4, 18.6, 18.8, 19.4, 21.0, 19.5, 18.2, 19.6],
        "Premium %":            [ 11.5, 12.4, 13.6, 14.8, 15.6, 16.4, 17.8, 18.5, 19.6, 20.8],
      },
    },
    royal_enfield: {
      name: "Royal Enfield",
      initials: "RE",
      color: "#7C3AED",
      colorSoft: "#EDE9FE",
      tag: "Mid-size cruiser leader · best-in-class margins",
      series: {
        "Revenue Growth %":     [ 52.8, 26.4, 27.8, 14.8, -7.8,  9.6, 17.4, 31.5, 12.2, 12.8],
        "Volume Growth %":      [ 49.5, 22.6, 22.5,  3.2,-15.4, -7.8, 15.2, 21.4,  6.5, 10.4],
        "Realisation Growth %": [  2.2,  3.1,  4.3, 11.2,  9.0, 18.9,  1.9,  8.3,  5.4,  2.2],
        "EBITDA Margin %":      [ 30.5, 31.2, 31.6, 27.8, 23.5, 24.6, 22.4, 25.8, 27.4, 26.2],
        "PAT Margin %":         [ 22.5, 23.4, 23.8, 20.5, 16.8, 16.5, 15.6, 18.5, 20.4, 19.6],
        "Gross Margin %":       [ 42.5, 43.0, 43.5, 41.0, 38.5, 38.0, 36.4, 39.5, 41.0, 41.6],
        "Borrowings":           [   50,   30,   20,   15,   15,   15,   15,   15,   20,   25],
        "Reserves":             [ 2800, 4200, 5800, 6800, 7400, 8400, 9600,11400,13600,15800],
        "Total Assets":         [ 3800, 5500, 7200, 8500, 9100,10200,11400,13200,15500,17800],
        "CFO":                  [ 1450, 1800, 2200, 2100, 1750, 2050, 2300, 3100, 3600, 3950],
        "CFI":                  [ -650, -780, -880, -750, -600, -680, -780,-1050,-1250,-1450],
        "CFF":                  [ -600, -800,-1000,-1200, -900,-1050,-1100,-1400,-1600,-1800],
        "Capex":                [  280,  340,  420,  380,  280,  340,  420,  580,  720,  850],
        "Capex Intensity %":    [  3.6,  3.4,  3.4,  2.6,  2.0,  2.2,  2.4,  2.7,  3.0,  3.2],
        "Company Share %":      [  4.0,  4.6,  5.2,  5.4,  5.4,  5.8,  6.4,  7.0,  7.4,  7.8],
        "Industry Share %":     [  100,  100,  100,  100,  100,  100,  100,  100,  100,  100],
        "Scooters %":           [    0,    0,    0,    0,    0,    0,    0,    0,    0,    0],
        "Motorcycles %":        [100.0,100.0,100.0,100.0,100.0,100.0,100.0,100.0,100.0,100.0],
        "EV %":                 [    0,    0,    0,    0,    0,    0,    0,    0,    0,    0],
        "Exports %":            [  4.5,  5.2,  6.4,  7.2,  6.4,  7.0,  9.5, 11.8,  8.2,  9.4],
        "Premium %":            [ 95.0, 96.0, 97.0, 97.5, 98.0, 98.5, 99.0, 99.0, 99.5, 99.5],
      },
    },
  };

  /* Per-metric formatting + axis hints. unit is appended to displayed
     values; precision controls decimal places; sign:"signed" forces a
     +/- prefix (used for growth %). */
  const METRIC_META = {
    "Revenue Growth %":     { unit: "%",  precision: 1, sign: "signed", color: "#173B63", goodUp: true },
    "Volume Growth %":      { unit: "%",  precision: 1, sign: "signed", color: "#5B7CFA", goodUp: true },
    "Realisation Growth %": { unit: "%",  precision: 1, sign: "signed", color: "#4DB6AC", goodUp: true },
    "EBITDA Margin %":      { unit: "%",  precision: 1, color: "#173B63", goodUp: true },
    "PAT Margin %":         { unit: "%",  precision: 1, color: "#5B7CFA", goodUp: true },
    "Gross Margin %":       { unit: "%",  precision: 1, color: "#4DB6AC", goodUp: true },
    "Borrowings":           { unit: "₹Cr", precision: 0, color: "#C62828", goodUp: false },
    "Reserves":             { unit: "₹Cr", precision: 0, color: "#173B63", goodUp: true },
    "Total Assets":         { unit: "₹Cr", precision: 0, color: "#5B7CFA", goodUp: true },
    "CFO":                  { unit: "₹Cr", precision: 0, color: "#173B63", goodUp: true },
    "CFI":                  { unit: "₹Cr", precision: 0, color: "#5B7CFA", goodUp: null },
    "CFF":                  { unit: "₹Cr", precision: 0, color: "#A78BFA", goodUp: null },
    "Capex":                { unit: "₹Cr", precision: 0, color: "#E7A64A", goodUp: null },
    "Capex Intensity %":    { unit: "%",  precision: 1, color: "#94A3B8", goodUp: null },
    "Company Share %":      { unit: "%",  precision: 1, color: "#173B63", goodUp: true },
    "Industry Share %":     { unit: "%",  precision: 1, color: "#94A3B8", goodUp: null },
    "Scooters %":           { unit: "%",  precision: 1, color: "#5B7CFA", goodUp: null },
    "Motorcycles %":        { unit: "%",  precision: 1, color: "#173B63", goodUp: null },
    "EV %":                 { unit: "%",  precision: 1, color: "#4DB6AC", goodUp: true },
    "Exports %":            { unit: "%",  precision: 1, color: "#E7A64A", goodUp: true },
    "Premium %":            { unit: "%",  precision: 1, color: "#A78BFA", goodUp: true },
  };

  /* Dropdown categories that drive the supporting-data table + chart.
     Each category names its column metrics (which become the table's
     columns AND the chart's series). */
  const CATEGORIES = [
    { key: "Growth",        help: "Revenue, volume, and realisation YoY %.",
      metrics: ["Revenue Growth %", "Volume Growth %", "Realisation Growth %"] },
    { key: "Margins",       help: "EBITDA, PAT, and gross margin %.",
      metrics: ["EBITDA Margin %", "PAT Margin %", "Gross Margin %"] },
    { key: "Balance Sheet", help: "Borrowings, reserves, and total assets (₹Cr).",
      metrics: ["Borrowings", "Reserves", "Total Assets"] },
    { key: "Cash Flow",     help: "Operating / investing / financing cash flows and capex.",
      metrics: ["CFO", "CFI", "CFF", "Capex", "Capex Intensity %"] },
    { key: "Market Share",  help: "Company share of all-India two-wheeler volume.",
      metrics: ["Company Share %", "Industry Share %"] },
    { key: "Product Mix",   help: "Scooters / motorcycles / EV / exports / premium share.",
      metrics: ["Scooters %", "Motorcycles %", "EV %", "Exports %", "Premium %"] },
  ];

  const KPI_LIST = [
    "Company Share %", "Volume Growth %", "Revenue Growth %",
    "EBITDA Margin %", "Premium %", "Exports %",
  ];

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    companyKey: "hero",
    category: "Growth",
    initialized: false,
  };

  /* ============================================================
     FORMATTING HELPERS
     ============================================================ */
  function fmt(value, metric) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    const m = METRIC_META[metric] || { unit: "", precision: 1 };
    const n = Number(value);
    if (m.unit === "₹Cr") {
      const abs = Math.abs(n);
      const sign = n < 0 ? "-" : "";
      if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)} K Cr`;
      return `${sign}${Math.round(abs).toLocaleString("en-IN")} Cr`;
    }
    const s = m.sign === "signed" && n > 0 ? "+" : "";
    return `${s}${n.toFixed(m.precision)}${m.unit}`;
  }

  /* Change between FY24 and FY25. For % metrics this is in "pp"
     (percentage points). For ₹Cr metrics this is a YoY % delta. */
  function changeText(prev, curr, metric) {
    if (typeof prev !== "number" || typeof curr !== "number") return "—";
    const m = METRIC_META[metric] || { unit: "%" };
    if (m.unit === "%") {
      const delta = curr - prev;
      const sign = delta > 0 ? "+" : "";
      return `${sign}${delta.toFixed(1)}pp`;
    }
    if (prev === 0) return "—";
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    const sign = pct > 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
  }

  /* "Read" label per row — Positive / Negative / Stable / Watch.
     For metrics where higher is better, gains read positive; for
     "goodUp:false" metrics (Borrowings), drops read positive. For
     neutral metrics (CFI, CFF, mix splits) we use Watch unless the
     change is small enough to be Stable. */
  function readLabel(prev, curr, metric) {
    const m = METRIC_META[metric];
    if (!m || typeof prev !== "number" || typeof curr !== "number") {
      return { text: "Stable", cls: "tw-read tw-read-stable" };
    }
    const delta = m.unit === "%" ? (curr - prev) : ((curr - prev) / Math.abs(prev || 1)) * 100;
    const absD = Math.abs(delta);
    const smallThreshold = m.unit === "%" ? 0.4 : 3;
    if (absD < smallThreshold) return { text: "Stable", cls: "tw-read tw-read-stable" };
    if (m.goodUp === null) return { text: "Watch", cls: "tw-read tw-read-watch" };
    const directionGood = (m.goodUp && delta > 0) || (!m.goodUp && delta < 0);
    return directionGood
      ? { text: "Positive", cls: "tw-read tw-read-pos" }
      : { text: "Negative", cls: "tw-read tw-read-neg" };
  }

  /* ============================================================
     KPI STRIP
     ============================================================ */
  function renderKpiStrip() {
    const company = COMPANIES[state.companyKey];
    const host = document.getElementById("tw-kpi-strip");
    if (!host || !company) return;
    const fy24Idx = FYS.indexOf("FY24");
    const fy25Idx = FYS.indexOf("FY25");

    const cards = KPI_LIST.map(metric => {
      const arr = company.series[metric];
      const prev = arr ? arr[fy24Idx] : null;
      const curr = arr ? arr[fy25Idx] : null;
      const read = readLabel(prev, curr, metric);
      const delta = (typeof prev === "number" && typeof curr === "number")
        ? (METRIC_META[metric].unit === "%"
            ? `${curr - prev > 0 ? "+" : ""}${(curr - prev).toFixed(1)}pp`
            : `${((curr - prev) / Math.abs(prev || 1)) * 100 > 0 ? "+" : ""}${(((curr - prev) / Math.abs(prev || 1)) * 100).toFixed(1)}%`)
        : "—";
      const deltaClass = (typeof prev === "number" && typeof curr === "number")
        ? (curr - prev > 0 ? "text-pos" : curr - prev < 0 ? "text-neg" : "text-inkMuted")
        : "text-inkMuted";
      return `
        <div class="tw-kpi-card">
          <div class="flex items-start justify-between gap-2">
            <span class="tw-kpi-label">${metric}</span>
            <span class="tw-kpi-pill ${read.cls.replace("tw-read", "tw-kpi-pill-of")}">${read.text}</span>
          </div>
          <div class="tw-kpi-value">${fmt(curr, metric)}</div>
          <div class="flex items-center justify-between mt-1">
            <span class="tw-kpi-foot">FY24 · ${fmt(prev, metric)}</span>
            <span class="tw-kpi-delta ${deltaClass}">${delta}</span>
          </div>
        </div>
      `;
    }).join("");

    host.innerHTML = cards;
  }

  /* ============================================================
     SUPPORTING DATA — TABLE + CHART
     ============================================================ */
  function renderSupportingTable() {
    const company = COMPANIES[state.companyKey];
    const cat = CATEGORIES.find(c => c.key === state.category) || CATEGORIES[0];
    const host = document.getElementById("tw-metric-table");
    if (!host || !company) return;
    const fy24Idx = FYS.indexOf("FY24");
    const fy25Idx = FYS.indexOf("FY25");

    const dropdownOpts = CATEGORIES.map(c =>
      `<option value="${c.key}" ${c.key === state.category ? "selected" : ""}>${c.key}</option>`
    ).join("");

    const metricHead = cat.metrics.map(m =>
      `<th class="tw-mtbl-col-head" title="${m}">${m.replace(/ %$/, " %")}</th>`
    ).join("");

    const rowCell = (m, value, cls = "") =>
      `<td class="tw-mtbl-cell ${cls}">${value}</td>`;

    const rowFy24 = `<tr><th class="tw-mtbl-row-head">FY24</th>${cat.metrics.map(m => {
      const v = company.series[m] ? company.series[m][fy24Idx] : null;
      return rowCell(m, fmt(v, m), "tw-mtbl-prior");
    }).join("")}</tr>`;

    const rowFy25 = `<tr><th class="tw-mtbl-row-head">FY25</th>${cat.metrics.map(m => {
      const v = company.series[m] ? company.series[m][fy25Idx] : null;
      return rowCell(m, fmt(v, m), "tw-mtbl-curr");
    }).join("")}</tr>`;

    const rowChange = `<tr><th class="tw-mtbl-row-head">CHANGE</th>${cat.metrics.map(m => {
      const prev = company.series[m] ? company.series[m][fy24Idx] : null;
      const curr = company.series[m] ? company.series[m][fy25Idx] : null;
      const text = changeText(prev, curr, m);
      const cls = text.startsWith("+") ? "tw-mtbl-pos" : text.startsWith("-") ? "tw-mtbl-neg" : "";
      return rowCell(m, text, cls);
    }).join("")}</tr>`;

    const rowRead = `<tr><th class="tw-mtbl-row-head">READ</th>${cat.metrics.map(m => {
      const prev = company.series[m] ? company.series[m][fy24Idx] : null;
      const curr = company.series[m] ? company.series[m][fy25Idx] : null;
      const r = readLabel(prev, curr, m);
      return `<td class="tw-mtbl-cell"><span class="${r.cls}">${r.text}</span></td>`;
    }).join("")}</tr>`;

    host.innerHTML = `
      <div class="tw-mtbl-scroll">
        <table class="tw-mtbl">
          <thead>
            <tr>
              <th class="tw-mtbl-corner">
                <select id="tw-cat-select" class="tw-mtbl-select">${dropdownOpts}</select>
              </th>
              ${metricHead}
            </tr>
          </thead>
          <tbody>${rowFy24}${rowFy25}${rowChange}${rowRead}</tbody>
        </table>
      </div>
      <div class="tw-mtbl-foot">Source: Company annual reports · investor presentations · SIAM (industry baseline). Illustrative until 2W data pipeline lands.</div>
    `;

    const sel = document.getElementById("tw-cat-select");
    if (sel) {
      sel.addEventListener("change", () => {
        state.category = sel.value;
        renderSupportingTable();
        renderSupportingChart();
      });
    }
  }

  /* Minimal SVG line chart for the supporting-data panel. One series
     per metric in the selected category, drawn over FYS. Designed to
     visually match the PV metric-chart-panel. */
  function renderSupportingChart() {
    const company = COMPANIES[state.companyKey];
    const cat = CATEGORIES.find(c => c.key === state.category) || CATEGORIES[0];
    const chartEl   = document.getElementById("tw-metric-chart");
    const titleEl   = document.getElementById("tw-metric-chart-title");
    const helpEl    = document.getElementById("tw-metric-chart-help");
    const legendEl  = document.getElementById("tw-metric-chart-legend");
    const footEl    = document.getElementById("tw-metric-chart-foot");
    if (!chartEl) return;

    titleEl.textContent = cat.key;
    helpEl.textContent = cat.help;

    /* Build raw series + work out a shared scale. Mixed-unit
       categories like Cash Flow share one axis here — the unit
       hints in the legend keep the reading honest. */
    const series = cat.metrics.map(m => {
      const arr = company.series[m] || FYS.map(() => null);
      return {
        metric: m,
        color: (METRIC_META[m] && METRIC_META[m].color) || "#5B7CFA",
        unit: (METRIC_META[m] && METRIC_META[m].unit) || "",
        values: arr.slice(0, FYS.length),
      };
    });

    const allVals = series.flatMap(s => s.values.filter(v => typeof v === "number"));
    if (!allVals.length) {
      chartEl.innerHTML = `<div class="text-sm text-inkMuted py-8 text-center">No history available for this category.</div>`;
      legendEl.innerHTML = "";
      footEl.textContent = "";
      return;
    }

    const W = 720, H = 280;
    const PAD = { top: 26, right: 28, bottom: 30, left: 50 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    let minV = Math.min(...allVals);
    let maxV = Math.max(...allVals);
    /* Symmetric pad so a tight band still reads cleanly. */
    const span = maxV - minV;
    const padV = span === 0 ? Math.max(1, Math.abs(maxV) * 0.1) : span * 0.12;
    minV = Math.floor((minV - padV) * 10) / 10;
    maxV = Math.ceil((maxV + padV) * 10) / 10;
    if (minV > 0 && minV < (maxV - minV) * 0.4) minV = 0;

    const xStep = innerW / (FYS.length - 1);
    const yFor = v => PAD.top + innerH - ((v - minV) / (maxV - minV)) * innerH;
    const xFor = i => PAD.left + i * xStep;

    /* Gridlines (4 horizontal). */
    const gridCount = 4;
    let grid = "";
    let yLabels = "";
    for (let i = 0; i <= gridCount; i++) {
      const v = minV + ((maxV - minV) * i) / gridCount;
      const y = yFor(v);
      grid += `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y}" y2="${y}" stroke="#E5EAF0" stroke-width="1" stroke-dasharray="2 3"/>`;
      const formatted = formatAxisVal(v, series[0].unit);
      yLabels += `<text x="${PAD.left - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="#94A3B8" font-family="Inter, sans-serif">${formatted}</text>`;
    }

    /* X-axis labels. */
    let xLabels = "";
    FYS.forEach((fy, i) => {
      xLabels += `<text x="${xFor(i)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#64748B" font-family="Inter, sans-serif">${fy}</text>`;
    });

    /* Series paths + dots. */
    let paths = "";
    series.forEach(s => {
      let d = "";
      const dots = [];
      s.values.forEach((v, i) => {
        if (typeof v !== "number") return;
        const x = xFor(i);
        const y = yFor(v);
        d += d === "" ? `M ${x} ${y}` : ` L ${x} ${y}`;
        dots.push({ x, y, v, i });
      });
      if (d) {
        paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        dots.forEach(p => {
          const isLatest = p.i === FYS.length - 1;
          paths += `<circle cx="${p.x}" cy="${p.y}" r="${isLatest ? 4 : 2.5}" fill="${isLatest ? "#FFFFFF" : s.color}" stroke="${s.color}" stroke-width="${isLatest ? 2 : 1.2}"/>`;
        });
      }
    });

    chartEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;">${grid}${yLabels}${xLabels}${paths}</svg>`;

    legendEl.innerHTML = series.map(s => `
      <span class="inline-flex items-center gap-1.5">
        <span class="inline-block w-4 h-[3px] rounded-sm" style="background:${s.color}"></span>
        <span>${s.metric}</span>
      </span>
    `).join("");

    footEl.textContent = `${FYS[0]}–${FYS[FYS.length - 1]} · ${company.name}. Source: Maruti / Hero / Bajaj / TVS / Eicher annual reports and investor presentations (illustrative seed).`;
  }

  function formatAxisVal(v, unit) {
    if (unit === "₹Cr") {
      const abs = Math.abs(v);
      const sign = v < 0 ? "-" : "";
      if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
      return `${sign}${Math.round(abs)}`;
    }
    return `${v.toFixed(v === Math.round(v) ? 0 : 1)}%`;
  }

  /* ============================================================
     IDENTITY ROW (in the 2W main body, below the header)
     ============================================================ */
  function renderIdentity() {
    const company = COMPANIES[state.companyKey];
    const logo  = document.getElementById("tw-logo-mark");
    const title = document.getElementById("tw-view-title");
    const sub   = document.getElementById("tw-view-subtitle");
    if (logo) {
      logo.className = "logo-mark logo-mark-header logo-mark-aggregate";
      logo.style.setProperty("background", `linear-gradient(135deg, ${company.color}, ${company.colorSoft})`);
      logo.innerHTML = `<span class="logo-initials" style="color:#fff;">${company.initials}</span>`;
    }
    if (title) title.textContent = `${company.name} · Two-Wheeler view`;
    if (sub)   sub.textContent   = company.tag;
  }

  /* ============================================================
     HEADER TAKEOVER
     ------------------------------------------------------------
     The top header is shared chrome. When 2W is active we
     re-skin its label / badge / company dropdown, hide the
     PV-only signal + freshness chips, and route the dropdown
     change event to the 2W renderer. Returning to PV restores
     everything by calling window.PVDashboard.refreshHeader().
     ============================================================ */
  let headerHandlerBound = false;
  function headerCaptureHandler(e) {
    /* Only intercept while 2W is the active segment; otherwise
       let the PV dashboard's bubble-phase listener handle it. */
    if (!state.active) return;
    e.stopImmediatePropagation();
    const sel = e.target;
    if (!sel || !(sel.value in COMPANIES)) return;
    state.companyKey = sel.value;
    syncHeaderCompanyDot();
    renderAll();
  }

  function syncHeaderCompanyDot() {
    const company = COMPANIES[state.companyKey];
    const dot = document.getElementById("hdr-brand-dot");
    if (dot && company) dot.style.background = company.color;
  }

  function takeoverHeader() {
    state.active = true;

    const badge = document.getElementById("segment-badge-text");
    if (badge) badge.textContent = "2W";
    const titleSpan = document.getElementById("segment-title-text");
    if (titleSpan) titleSpan.textContent = "Two-Wheeler Dashboard";

    const fyLabel = document.getElementById("latest-fy-label");
    if (fyLabel) fyLabel.textContent = "FY25";

    const sel = document.getElementById("company-select");
    if (sel) {
      sel.innerHTML = Object.entries(COMPANIES).map(([k, c]) =>
        `<option value="${k}" ${k === state.companyKey ? "selected" : ""}>${c.name}</option>`
      ).join("");
      if (!headerHandlerBound) {
        /* Capturing-phase so we run before PV's bubble-phase
           change listener and can stopImmediatePropagation it
           cleanly. */
        sel.addEventListener("change", headerCaptureHandler, true);
        headerHandlerBound = true;
      }
    }
    syncHeaderCompanyDot();

    /* Hide PV-only header indicators while 2W is active. */
    ["hdr-signal-wrap", "hdr-updated-wrap", "hdr-data-wrap", "stale-warning"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
  }

  function restoreHeader() {
    state.active = false;
    const badge = document.getElementById("segment-badge-text");
    if (badge) badge.textContent = "PV";
    const titleSpan = document.getElementById("segment-title-text");
    if (titleSpan) titleSpan.textContent = "PV Industry Dashboard";

    ["hdr-signal-wrap", "hdr-updated-wrap", "hdr-data-wrap"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("hidden");
    });
    /* stale-warning is conditionally re-shown by PV's refreshHeader,
       so we let that toggle it back rather than force-show it here. */

    if (window.PVDashboard && typeof window.PVDashboard.refreshHeader === "function") {
      window.PVDashboard.refreshHeader();
    }
  }

  /* ============================================================
     ENTRY POINTS
     ============================================================ */
  function renderAll() {
    renderIdentity();
    renderKpiStrip();
    renderSupportingTable();
    renderSupportingChart();
  }

  function show() {
    takeoverHeader();
    renderAll();
  }

  function hide() {
    restoreHeader();
  }

  window.TwoWheeler = { show, hide };
})();
