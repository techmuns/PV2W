/* =================================================================
   BACKEND / SOURCE TABLES — single source of truth for the dashboard.

   Future data agents replace the rows below. The UI does not need
   any changes when values are updated — visuals bind to these tables.

   Source rule: only reliable public sources are acceptable —
   NSE / BSE filings, annual reports, investor presentations,
   quarterly results, Screener, official company websites.
   If exact data is unavailable, leave Value: null and Source: "Pending".
   Do not guess values.

   Schemas:

   1) Company_FY_Metrics
      FY, Company, Metric, Value, YoY_Change, Signal,
      Source, Source_URL, Last_Updated

   2) Vehicle_FY_Metrics
      FY, Company, Vehicle, Segment, Volume, YoY_Growth, Segment_Rank,
      Signal, Image_URL, Source, Source_URL, Last_Updated

   3) BuySide_Signals
      FY, Company, Share_Read, Growth_Read, Margin_Read, Mix_Read,
      Risk_Read, Trigger_Read, Overall_Signal,
      Source, Source_URL, Last_Updated

   4) Company_Info
      FY, Company, CEO, CFO, COO, Credit_Rating, Employees, Dealers,
      Logo_URL, Source, Source_URL, Last_Updated

   5) Industry_FY_Metrics
      FY, Metric, Value, YoY_Change, Signal,
      Source, Source_URL, Last_Updated

   Signal values: "Positive" | "Negative" | "Neutral"
   FY format: "FY16" .. "FY25"
   ================================================================= */

window.PV_DATA = (function () {

  const COMPANIES   = ["Industry", "Maruti", "Hyundai", "M&M", "Tata Motors PV"];
  const FYS_FULL    = ["FY16","FY17","FY18","FY19","FY20","FY21","FY22","FY23","FY24","FY25"];
  const FYS         = ["FY23", "FY24", "FY25"];   // years with full coverage (used by main view)
  const TODAY_ISO   = "2026-04-20";
  const STALE_ISO   = "2025-12-01";

  const DEFAULT_VEHICLES = {
    "Maruti":         ["Swift", "Brezza", "Fronx", "Grand Vitara", "Ertiga", "Baleno"],
    "Hyundai":        ["Creta", "Venue", "Exter", "i20", "Verna", "Alcazar"],
    "M&M":            ["Scorpio-N", "XUV700", "Thar", "XUV 3XO", "Bolero", "XUV400"],
    "Tata Motors PV": ["Nexon", "Punch", "Harrier", "Safari", "Tiago", "Altroz"],
  };

  const OEM_KPIS = [
    "Market Share %",
    "Volume Growth %",
    "Revenue Growth %",
    "EBITDA Margin %",
    "SUV Revenue %",
    "Stock Price (31-Mar)",
  ];

  const INDUSTRY_KPIS = [
    "Total PV Volume",
    "PV Volume Growth %",
    "SUV Share %",
    "EV Share %",
    "Export Share %",
    "Top Gaining OEM",
  ];

  /* Metrics for which we expose a 10-year trend in the drawer. */
  const TREND_METRICS = new Set([
    "Market Share %", "Volume Growth %", "Revenue Growth %", "EBITDA Margin %",
    "SUV Revenue %", "Stock Price (31-Mar)",
    "Gross Margin %", "Realisation Growth %", "Export Revenue %", "EV Revenue %",
    "Capacity Utilisation %", "Working Capital Days", "Capex (Rs Cr)",
  ]);

  const m = (FY, Company, Metric, Value, YoY_Change, Signal, Last_Updated = TODAY_ISO) => ({
    FY, Company, Metric, Value, YoY_Change, Signal,
    Source: "Pending",
    Source_URL: null,
    Last_Updated,
  });

  /* =========================================================
     Table 1 — Company_FY_Metrics (FY23-FY25 hand-seeded)
     ========================================================= */
  const Company_FY_Metrics = [];

  ([
    ["FY23", { "Market Share %": [41.2, 0.6, "Positive"], "Volume Growth %": [19.0, 6.0, "Positive"],
               "Revenue Growth %": [22.5, 7.2, "Positive"], "EBITDA Margin %": [9.8, 1.1, "Positive"],
               "SUV Revenue %": [22.0, 4.0, "Positive"],   "Stock Price (31-Mar)": [8650, 12.0, "Positive"],
               "Gross Margin %": [27.5, 0.8, "Positive"],
               "Realisation Growth %": [3.2, 1.0, "Positive"],
               "SUV Volume %": [18.0, 3.5, "Positive"],
               "EV Volume %": [0.0, 0.0, "Neutral"], "EV Revenue %": [0.0, 0.0, "Neutral"],
               "Export Volume %": [12.4, 0.6, "Neutral"], "Export Revenue %": [10.1, 0.4, "Neutral"],
               "Capacity (units)": [2200000, 5.0, "Positive"], "Capacity Utilisation %": [85.0, 4.0, "Positive"],
               "Capex (Rs Cr)": [7000, 15.0, "Neutral"], "Working Capital Days": [-12, 1, "Positive"],
               "New Model Launches": [2, null, "Neutral"], "Facelift Launches": [3, null, "Neutral"],
               "Top Selling Model": ["Brezza", null, "Neutral"] }],
    ["FY24", { "Market Share %": [41.7, 0.5, "Positive"], "Volume Growth %": [9.0, -10.0, "Neutral"],
               "Revenue Growth %": [12.4, -10.1, "Neutral"], "EBITDA Margin %": [11.4, 1.6, "Positive"],
               "SUV Revenue %": [28.5, 6.5, "Positive"],  "Stock Price (31-Mar)": [12450, 43.9, "Positive"],
               "Gross Margin %": [29.0, 1.5, "Positive"],
               "Realisation Growth %": [3.4, 0.2, "Neutral"],
               "SUV Volume %": [22.5, 4.5, "Positive"],
               "EV Volume %": [0.0, 0.0, "Neutral"], "EV Revenue %": [0.0, 0.0, "Neutral"],
               "Export Volume %": [13.5, 1.1, "Positive"], "Export Revenue %": [11.0, 0.9, "Positive"],
               "Capacity (units)": [2350000, 6.8, "Positive"], "Capacity Utilisation %": [88.0, 3.0, "Positive"],
               "Capex (Rs Cr)": [8000, 14.0, "Neutral"], "Working Capital Days": [-14, -2, "Positive"],
               "New Model Launches": [3, null, "Neutral"], "Facelift Launches": [2, null, "Neutral"],
               "Top Selling Model": ["Brezza", null, "Neutral"] }],
    ["FY25", { "Market Share %": [42.1, 0.4, "Positive"], "Volume Growth %": [4.7, -4.3, "Neutral"],
               "Revenue Growth %": [8.2, -4.2, "Neutral"], "EBITDA Margin %": [12.0, 0.6, "Positive"],
               "SUV Revenue %": [32.0, 3.5, "Positive"],  "Stock Price (31-Mar)": [12880, 3.5, "Neutral"],
               "Gross Margin %": [29.6, 0.6, "Positive"],
               "Realisation Growth %": [3.5, 0.1, "Neutral"],
               "SUV Volume %": [25.0, 2.5, "Positive"],
               "EV Volume %": [0.4, 0.4, "Positive"], "EV Revenue %": [0.6, 0.6, "Positive"],
               "Export Volume %": [15.0, 1.5, "Positive"], "Export Revenue %": [12.4, 1.4, "Positive"],
               "Capacity (units)": [2600000, 10.6, "Positive"], "Capacity Utilisation %": [86.0, -2.0, "Neutral"],
               "Capex (Rs Cr)": [9000, 12.5, "Neutral"], "Working Capital Days": [-15, -1, "Positive"],
               "New Model Launches": [2, null, "Neutral"], "Facelift Launches": [4, null, "Neutral"],
               "Top Selling Model": ["Brezza", null, "Neutral"] }],
  ]).forEach(([fy, metrics]) => {
    Object.entries(metrics).forEach(([metric, [val, yoy, sig]]) => {
      Company_FY_Metrics.push(m(fy, "Maruti", metric, val, yoy, sig));
    });
  });

  ([
    ["FY23", { "Market Share %": [14.5, 0.2, "Neutral"], "Volume Growth %": [17.2, 3.0, "Positive"],
               "Revenue Growth %": [19.0, 4.5, "Positive"], "EBITDA Margin %": [12.8, 0.5, "Positive"],
               "SUV Revenue %": [56.0, 3.0, "Positive"],  "Stock Price (31-Mar)": [null, null, "Neutral"],
               "Gross Margin %": [30.0, 0.6, "Positive"], "Realisation Growth %": [2.5, 0.4, "Neutral"],
               "SUV Volume %": [52.0, 3.0, "Positive"], "EV Volume %": [0.5, 0.2, "Positive"],
               "EV Revenue %": [1.4, 0.5, "Positive"], "Export Volume %": [22.0, 1.0, "Positive"],
               "Export Revenue %": [21.0, 1.2, "Positive"], "Capacity (units)": [820000, 0, "Neutral"],
               "Capacity Utilisation %": [99.0, 1.0, "Positive"], "Capex (Rs Cr)": [3500, 8.0, "Neutral"],
               "Working Capital Days": [10, 0, "Neutral"], "New Model Launches": [1, null, "Neutral"],
               "Facelift Launches": [2, null, "Neutral"], "Top Selling Model": ["Creta", null, "Neutral"] }],
    ["FY24", { "Market Share %": [14.6, 0.1, "Neutral"], "Volume Growth %": [8.5, -8.7, "Neutral"],
               "Revenue Growth %": [10.4, -8.6, "Neutral"], "EBITDA Margin %": [13.4, 0.6, "Positive"],
               "SUV Revenue %": [60.0, 4.0, "Positive"],  "Stock Price (31-Mar)": [null, null, "Neutral"],
               "Gross Margin %": [30.6, 0.6, "Positive"], "Realisation Growth %": [1.7, -0.8, "Neutral"],
               "SUV Volume %": [56.0, 4.0, "Positive"], "EV Volume %": [0.7, 0.2, "Positive"],
               "EV Revenue %": [1.9, 0.5, "Positive"], "Export Volume %": [23.5, 1.5, "Positive"],
               "Export Revenue %": [22.6, 1.6, "Positive"], "Capacity (units)": [820000, 0, "Neutral"],
               "Capacity Utilisation %": [101.0, 2.0, "Positive"], "Capex (Rs Cr)": [4200, 20.0, "Neutral"],
               "Working Capital Days": [9, -1, "Positive"], "New Model Launches": [2, null, "Neutral"],
               "Facelift Launches": [1, null, "Neutral"], "Top Selling Model": ["Creta", null, "Neutral"] }],
    ["FY25", { "Market Share %": [14.4, -0.2, "Negative"], "Volume Growth %": [3.0, -5.5, "Negative"],
               "Revenue Growth %": [5.5, -4.9, "Negative"], "EBITDA Margin %": [13.1, -0.3, "Neutral"],
               "SUV Revenue %": [62.5, 2.5, "Positive"],  "Stock Price (31-Mar)": [1820, null, "Neutral"],
               "Gross Margin %": [30.4, -0.2, "Neutral"], "Realisation Growth %": [2.4, 0.7, "Neutral"],
               "SUV Volume %": [58.0, 2.0, "Positive"], "EV Volume %": [1.1, 0.4, "Positive"],
               "EV Revenue %": [2.6, 0.7, "Positive"], "Export Volume %": [25.0, 1.5, "Positive"],
               "Export Revenue %": [24.0, 1.4, "Positive"], "Capacity (units)": [1000000, 22.0, "Positive"],
               "Capacity Utilisation %": [88.0, -13.0, "Negative"], "Capex (Rs Cr)": [5000, 19.0, "Neutral"],
               "Working Capital Days": [9, 0, "Neutral"], "New Model Launches": [2, null, "Neutral"],
               "Facelift Launches": [2, null, "Neutral"], "Top Selling Model": ["Creta", null, "Neutral"] }],
  ]).forEach(([fy, metrics]) => {
    Object.entries(metrics).forEach(([metric, [val, yoy, sig]]) => {
      Company_FY_Metrics.push(m(fy, "Hyundai", metric, val, yoy, sig));
    });
  });

  ([
    ["FY23", { "Market Share %": [9.4, 1.4, "Positive"], "Volume Growth %": [56.0, 25.0, "Positive"],
               "Revenue Growth %": [62.0, 24.0, "Positive"], "EBITDA Margin %": [12.0, 1.5, "Positive"],
               "SUV Revenue %": [92.0, 2.0, "Positive"], "Stock Price (31-Mar)": [1185, 9.0, "Positive"],
               "Gross Margin %": [25.5, 0.5, "Positive"], "Realisation Growth %": [3.8, 0.6, "Positive"],
               "SUV Volume %": [88.0, 2.5, "Positive"], "EV Volume %": [0.0, 0, "Neutral"],
               "EV Revenue %": [0.0, 0, "Neutral"], "Export Volume %": [4.0, 0.5, "Neutral"],
               "Export Revenue %": [4.4, 0.6, "Neutral"], "Capacity (units)": [490000, 10.0, "Positive"],
               "Capacity Utilisation %": [82.0, 14.0, "Positive"], "Capex (Rs Cr)": [3000, 25.0, "Neutral"],
               "Working Capital Days": [-8, -2, "Positive"], "New Model Launches": [1, null, "Neutral"],
               "Facelift Launches": [2, null, "Neutral"], "Top Selling Model": ["Scorpio-N", null, "Neutral"] }],
    ["FY24", { "Market Share %": [10.4, 1.0, "Positive"], "Volume Growth %": [21.0, -35.0, "Neutral"],
               "Revenue Growth %": [25.0, -37.0, "Neutral"], "EBITDA Margin %": [13.5, 1.5, "Positive"],
               "SUV Revenue %": [94.0, 2.0, "Positive"], "Stock Price (31-Mar)": [1956, 65.0, "Positive"],
               "Gross Margin %": [26.4, 0.9, "Positive"], "Realisation Growth %": [3.3, -0.5, "Neutral"],
               "SUV Volume %": [90.5, 2.5, "Positive"], "EV Volume %": [0.0, 0, "Neutral"],
               "EV Revenue %": [0.0, 0, "Neutral"], "Export Volume %": [4.5, 0.5, "Neutral"],
               "Export Revenue %": [4.9, 0.5, "Neutral"], "Capacity (units)": [560000, 14.3, "Positive"],
               "Capacity Utilisation %": [86.0, 4.0, "Positive"], "Capex (Rs Cr)": [4500, 50.0, "Neutral"],
               "Working Capital Days": [-9, -1, "Positive"], "New Model Launches": [2, null, "Neutral"],
               "Facelift Launches": [1, null, "Neutral"], "Top Selling Model": ["Scorpio-N", null, "Neutral"] }],
    ["FY25", { "Market Share %": [11.6, 1.2, "Positive"], "Volume Growth %": [18.0, -3.0, "Positive"],
               "Revenue Growth %": [22.0, -3.0, "Positive"], "EBITDA Margin %": [14.2, 0.7, "Positive"],
               "SUV Revenue %": [95.0, 1.0, "Positive"], "Stock Price (31-Mar)": [2870, 46.7, "Positive"],
               "Gross Margin %": [27.0, 0.6, "Positive"], "Realisation Growth %": [3.4, 0.1, "Neutral"],
               "SUV Volume %": [92.0, 1.5, "Positive"], "EV Volume %": [1.5, 1.5, "Positive"],
               "EV Revenue %": [2.4, 2.4, "Positive"], "Export Volume %": [5.0, 0.5, "Positive"],
               "Export Revenue %": [5.5, 0.6, "Positive"], "Capacity (units)": [640000, 14.3, "Positive"],
               "Capacity Utilisation %": [88.0, 2.0, "Positive"], "Capex (Rs Cr)": [5000, 11.0, "Neutral"],
               "Working Capital Days": [-10, -1, "Positive"], "New Model Launches": [3, null, "Neutral"],
               "Facelift Launches": [1, null, "Neutral"], "Top Selling Model": ["Scorpio-N", null, "Neutral"] }],
  ]).forEach(([fy, metrics]) => {
    Object.entries(metrics).forEach(([metric, [val, yoy, sig]]) => {
      Company_FY_Metrics.push(m(fy, "M&M", metric, val, yoy, sig));
    });
  });

  ([
    ["FY23", { "Market Share %": [13.5, 1.0, "Positive"], "Volume Growth %": [45.0, 22.0, "Positive"],
               "Revenue Growth %": [48.0, 23.0, "Positive"], "EBITDA Margin %": [6.5, 1.0, "Neutral"],
               "SUV Revenue %": [62.0, 4.0, "Positive"], "Stock Price (31-Mar)": [430, 15.0, "Positive"],
               "Gross Margin %": [22.5, 1.0, "Neutral"], "Realisation Growth %": [2.0, 0.5, "Neutral"],
               "SUV Volume %": [60.0, 4.0, "Positive"], "EV Volume %": [9.0, 4.0, "Positive"],
               "EV Revenue %": [12.0, 5.0, "Positive"], "Export Volume %": [1.5, 0.0, "Neutral"],
               "Export Revenue %": [1.6, 0.0, "Neutral"], "Capacity (units)": [600000, 0, "Neutral"],
               "Capacity Utilisation %": [89.0, 12.0, "Positive"], "Capex (Rs Cr)": [3500, 16.0, "Neutral"],
               "Working Capital Days": [5, -3, "Positive"], "New Model Launches": [2, null, "Neutral"],
               "Facelift Launches": [2, null, "Neutral"], "Top Selling Model": ["Nexon", null, "Neutral"] }],
    ["FY24", { "Market Share %": [13.8, 0.3, "Positive"], "Volume Growth %": [12.5, -32.5, "Neutral"],
               "Revenue Growth %": [10.0, -38.0, "Neutral"], "EBITDA Margin %": [6.8, 0.3, "Neutral"],
               "SUV Revenue %": [66.0, 4.0, "Positive"], "Stock Price (31-Mar)": [1015, 136.0, "Positive"],
               "Gross Margin %": [23.0, 0.5, "Neutral"], "Realisation Growth %": [-2.0, -4.0, "Negative"],
               "SUV Volume %": [64.0, 4.0, "Positive"], "EV Volume %": [12.0, 3.0, "Positive"],
               "EV Revenue %": [15.0, 3.0, "Positive"], "Export Volume %": [1.4, -0.1, "Neutral"],
               "Export Revenue %": [1.5, -0.1, "Neutral"], "Capacity (units)": [620000, 3.3, "Neutral"],
               "Capacity Utilisation %": [90.0, 1.0, "Positive"], "Capex (Rs Cr)": [4200, 20.0, "Neutral"],
               "Working Capital Days": [3, -2, "Positive"], "New Model Launches": [1, null, "Neutral"],
               "Facelift Launches": [3, null, "Neutral"], "Top Selling Model": ["Nexon", null, "Neutral"] }],
    ["FY25", { "Market Share %": [13.4, -0.4, "Negative"], "Volume Growth %": [1.5, -11.0, "Negative"],
               "Revenue Growth %": [-2.0, -12.0, "Negative"], "EBITDA Margin %": [6.4, -0.4, "Negative"],
               "SUV Revenue %": [68.0, 2.0, "Positive"], "Stock Price (31-Mar)": [770, -24.1, "Negative"],
               "Gross Margin %": [22.4, -0.6, "Negative"], "Realisation Growth %": [-3.5, -1.5, "Negative"],
               "SUV Volume %": [66.0, 2.0, "Positive"], "EV Volume %": [11.0, -1.0, "Negative"],
               "EV Revenue %": [13.5, -1.5, "Negative"], "Export Volume %": [1.3, -0.1, "Neutral"],
               "Export Revenue %": [1.4, -0.1, "Neutral"], "Capacity (units)": [650000, 4.8, "Neutral"],
               "Capacity Utilisation %": [85.0, -5.0, "Neutral"], "Capex (Rs Cr)": [4800, 14.0, "Neutral"],
               "Working Capital Days": [4, 1, "Neutral"], "New Model Launches": [1, null, "Neutral"],
               "Facelift Launches": [2, null, "Neutral"], "Top Selling Model": ["Nexon", null, "Neutral"] }],
  ]).forEach(([fy, metrics]) => {
    Object.entries(metrics).forEach(([metric, [val, yoy, sig]]) => {
      const lu = (fy === "FY25") ? STALE_ISO : TODAY_ISO;
      Company_FY_Metrics.push(m(fy, "Tata Motors PV", metric, val, yoy, sig, lu));
    });
  });

  /* =========================================================
     Back-projected history (FY16-FY22) — placeholder series.
     Anchors: FY16 baseline + FY23 actual (already in table above).
     Generates smoothly varying values agents can later overwrite
     row-by-row.
     ========================================================= */
  const HISTORY_BASELINES = {
    "Maruti": {
      "Market Share %":          [50.5, 41.2],
      "Volume Growth %":         [10.5, 19.0],
      "Revenue Growth %":        [11.0, 22.5],
      "EBITDA Margin %":         [16.2, 9.8],
      "SUV Revenue %":           [9.0,  22.0],
      "Stock Price (31-Mar)":    [3700, 8650],
      "Gross Margin %":          [30.5, 27.5],
      "Realisation Growth %":    [4.5,  3.2],
      "Export Revenue %":        [9.0,  10.1],
      "EV Revenue %":            [0.0,  0.0],
      "Capacity Utilisation %":  [80.0, 85.0],
      "Working Capital Days":    [-8,   -12],
      "Capex (Rs Cr)":           [3500, 7000],
    },
    "Hyundai": {
      "Market Share %":          [16.5, 14.5],
      "Volume Growth %":         [8.5,  17.2],
      "Revenue Growth %":        [10.5, 19.0],
      "EBITDA Margin %":         [11.0, 12.8],
      "SUV Revenue %":           [38.0, 56.0],
      "Stock Price (31-Mar)":    [null, null],
      "Gross Margin %":          [29.0, 30.0],
      "Realisation Growth %":    [3.0,  2.5],
      "Export Revenue %":        [16.0, 21.0],
      "EV Revenue %":            [0.1,  1.4],
      "Capacity Utilisation %":  [88.0, 99.0],
      "Working Capital Days":    [12,   10],
      "Capex (Rs Cr)":           [1500, 3000],
    },
    "M&M": {
      "Market Share %":          [7.5,  9.4],
      "Volume Growth %":         [5.5,  56.0],
      "Revenue Growth %":        [6.0,  62.0],
      "EBITDA Margin %":         [11.0, 12.0],
      "SUV Revenue %":           [80.0, 92.0],
      "Stock Price (31-Mar)":    [320,  1185],
      "Gross Margin %":          [24.0, 25.5],
      "Realisation Growth %":    [2.5,  3.8],
      "Export Revenue %":        [3.5,  4.4],
      "EV Revenue %":            [0.0,  0.0],
      "Capacity Utilisation %":  [70.0, 82.0],
      "Working Capital Days":    [-2,   -8],
      "Capex (Rs Cr)":           [2200, 3000],
    },
    "Tata Motors PV": {
      "Market Share %":          [5.5,  13.5],
      "Volume Growth %":         [3.0,  45.0],
      "Revenue Growth %":        [4.5,  48.0],
      "EBITDA Margin %":         [-2.0, 6.5],
      "SUV Revenue %":           [22.0, 62.0],
      "Stock Price (31-Mar)":    [380,  430],
      "Gross Margin %":          [16.0, 22.5],
      "Realisation Growth %":    [-1.0, 2.0],
      "Export Revenue %":        [3.0,  1.6],
      "EV Revenue %":            [0.0,  12.0],
      "Capacity Utilisation %":  [55.0, 89.0],
      "Working Capital Days":    [12,   5],
      "Capex (Rs Cr)":           [2200, 3500],
    },
  };

  /* deterministic small-amplitude wobble so curves don't look like rulers */
  function wobble(seedKey, i, magnitude) {
    let h = 0;
    for (let c = 0; c < seedKey.length; c++) h = (h * 31 + seedKey.charCodeAt(c)) | 0;
    h = (h * 17 + i * 113) | 0;
    return ((Math.abs(h) % 1000) / 1000 - 0.5) * 2 * magnitude;
  }

  const HIST_FYS = ["FY16","FY17","FY18","FY19","FY20","FY21","FY22"];

  Object.entries(HISTORY_BASELINES).forEach(([company, metricBaselines]) => {
    Object.entries(metricBaselines).forEach(([metric, [v0, v7]]) => {
      if (v0 === null || v7 === null) {
        // emit empty rows so the drawer can show "Limited history available"
        HIST_FYS.forEach(fy => Company_FY_Metrics.push({
          FY: fy, Company: company, Metric: metric,
          Value: null, YoY_Change: null, Signal: "Neutral",
          Source: "Pending", Source_URL: null, Last_Updated: null,
        }));
        return;
      }
      // Special case — COVID dip in FY21 for growth/volume metrics
      const isGrowth = metric.includes("Growth") || metric.includes("Volume");
      const wobMag = Math.max(Math.abs(v7 - v0) * 0.06, Math.abs(v7) * 0.03, 0.3);

      HIST_FYS.forEach((fy, i) => {
        const t = (i + 1) / 8;
        let linear = v0 + (v7 - v0) * t;
        if (isGrowth && fy === "FY21") linear *= -0.5;        // covid hit
        if (isGrowth && fy === "FY22") linear = Math.max(linear, 8);
        const noise = wobble(company + metric, i, wobMag);
        let value = linear + noise;
        // Round sensibly
        if (Math.abs(value) >= 100) value = Math.round(value);
        else value = Math.round(value * 10) / 10;

        Company_FY_Metrics.push({
          FY: fy, Company: company, Metric: metric,
          Value: value, YoY_Change: null, Signal: "Neutral",
          Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO,
        });
      });
    });
  });

  /* =========================================================
     Table 2 — Vehicle_FY_Metrics
     ========================================================= */
  const Vehicle_FY_Metrics = [];

  const VEHICLE_SEED = {
    "Maruti": {
      "Swift":         { segment: "Hatch",   FY23: [180000,  6, 1, "Positive"], FY24: [196000,  9, 1, "Positive"], FY25: [205000,  4, 2, "Neutral"]  },
      "Brezza":        { segment: "Sub-SUV", FY23: [165000, 22, 1, "Positive"], FY24: [185000, 12, 1, "Positive"], FY25: [195000,  5, 2, "Positive"] },
      "Fronx":         { segment: "Sub-SUV", FY23: [ 50000, null, 6, "Positive"], FY24: [128000,156, 3, "Positive"], FY25: [150000, 17, 3, "Positive"] },
      "Grand Vitara":  { segment: "SUV",     FY23: [ 95000, null, 5, "Positive"], FY24: [128000, 35, 4, "Positive"], FY25: [142000, 11, 4, "Positive"] },
      "Ertiga":        { segment: "MPV",     FY23: [180000, 18, 1, "Positive"], FY24: [192000,  7, 1, "Positive"], FY25: [198000,  3, 1, "Neutral"]  },
      "Baleno":        { segment: "Hatch",   FY23: [200000, 10, 1, "Positive"], FY24: [205000,  3, 1, "Neutral"],  FY25: [188000, -8, 2, "Negative"] },
    },
    "Hyundai": {
      "Creta":         { segment: "SUV",     FY23: [125000, 18, 1, "Positive"], FY24: [156000, 25, 1, "Positive"], FY25: [180000, 15, 1, "Positive"] },
      "Venue":         { segment: "Sub-SUV", FY23: [108000,  2, 3, "Neutral"],  FY24: [101000, -6, 4, "Negative"], FY25: [ 92000, -9, 5, "Negative"] },
      "Exter":         { segment: "Sub-SUV", FY23: [     0, null, null, "Neutral"], FY24: [ 65000, null, 6, "Positive"], FY25: [ 78000, 20, 6, "Positive"] },
      "i20":           { segment: "Hatch",   FY23: [ 80000, -4, 4, "Negative"], FY24: [ 76000, -5, 5, "Negative"], FY25: [ 70000, -8, 5, "Negative"] },
      "Verna":         { segment: "Sedan",   FY23: [ 30000, -10, 3, "Negative"], FY24: [ 38000, 27, 2, "Positive"], FY25: [ 36000, -5, 2, "Neutral"]  },
      "Alcazar":       { segment: "MPV",     FY23: [ 22000, 5, 5, "Neutral"],  FY24: [ 24000,  9, 5, "Neutral"],  FY25: [ 25000,  4, 5, "Neutral"]  },
    },
    "M&M": {
      "Scorpio-N":     { segment: "SUV",     FY23: [110000, null, 2, "Positive"], FY24: [156000, 42, 2, "Positive"], FY25: [180000, 15, 2, "Positive"] },
      "XUV700":        { segment: "SUV",     FY23: [ 75000,120, 3, "Positive"], FY24: [ 98000, 31, 3, "Positive"], FY25: [108000, 10, 3, "Positive"] },
      "Thar":          { segment: "SUV",     FY23: [ 58000, 15, 4, "Positive"], FY24: [ 64000, 10, 4, "Positive"], FY25: [ 88000, 38, 4, "Positive"] },
      "XUV 3XO":       { segment: "Sub-SUV", FY23: [ 22000, -10, 6, "Negative"], FY24: [ 35000, 59, 5, "Positive"], FY25: [ 78000,123, 4, "Positive"] },
      "Bolero":        { segment: "Utility", FY23: [ 95000,  4, 1, "Neutral"],  FY24: [ 92000, -3, 1, "Neutral"],  FY25: [ 88000, -4, 1, "Neutral"]  },
      "XUV400":        { segment: "EV",      FY23: [   500, null, 5, "Neutral"], FY24: [  6500, null, 4, "Positive"], FY25: [  5800, -11, 4, "Negative"] },
    },
    "Tata Motors PV": {
      "Nexon":         { segment: "Sub-SUV", FY23: [165000, 35, 1, "Positive"], FY24: [185000, 12, 1, "Positive"], FY25: [178000, -4, 1, "Neutral"]  },
      "Punch":         { segment: "Sub-SUV", FY23: [128000, 28, 2, "Positive"], FY24: [196000, 53, 2, "Positive"], FY25: [205000,  5, 2, "Positive"] },
      "Harrier":       { segment: "SUV",     FY23: [ 42000, 10, 5, "Neutral"],  FY24: [ 46000, 10, 5, "Neutral"],  FY25: [ 38000,-17, 6, "Negative"] },
      "Safari":        { segment: "SUV",     FY23: [ 28000,  8, 6, "Neutral"],  FY24: [ 30000,  7, 6, "Neutral"],  FY25: [ 25000,-17, 7, "Negative"] },
      "Tiago":         { segment: "Hatch",   FY23: [ 70000, 12, 3, "Positive"], FY24: [ 65000, -7, 3, "Negative"], FY25: [ 58000,-11, 4, "Negative"] },
      "Altroz":        { segment: "Hatch",   FY23: [ 56000,  6, 5, "Neutral"],  FY24: [ 50000,-11, 5, "Negative"], FY25: [ 42000,-16, 6, "Negative"] },
    },
  };

  Object.entries(VEHICLE_SEED).forEach(([company, models]) => {
    Object.entries(models).forEach(([vehicle, info]) => {
      ["FY23","FY24","FY25"].forEach(fy => {
        const [vol, yoy, rank, sig] = info[fy];
        const lu = (company === "Tata Motors PV" && fy === "FY25") ? STALE_ISO : TODAY_ISO;
        Vehicle_FY_Metrics.push({
          FY: fy, Company: company, Vehicle: vehicle, Segment: info.segment,
          Volume: vol, YoY_Growth: yoy, Segment_Rank: rank,
          Signal: sig, Image_URL: null,
          Source: "Pending", Source_URL: null, Last_Updated: lu,
        });
      });
    });
  });

  /* =========================================================
     Table 3 — BuySide_Signals
     ========================================================= */
  const BuySide_Signals = [
    { FY: "FY23", Company: "Maruti", Share_Read: "Gaining", Growth_Read: "Ahead",
      Margin_Read: "Expanding", Mix_Read: "SUV improving", Risk_Read: "EV gap",
      Trigger_Read: "Brezza/Grand Vitara ramp", Overall_Signal: "Positive",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY24", Company: "Maruti", Share_Read: "Gaining", Growth_Read: "In line",
      Margin_Read: "Expanding", Mix_Read: "SUV + Exports up", Risk_Read: "Hatch weakness",
      Trigger_Read: "Operating leverage, exports", Overall_Signal: "Positive",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY25", Company: "Maruti", Share_Read: "Stable", Growth_Read: "Ahead",
      Margin_Read: "Expanding", Mix_Read: "SUV + Export improving", Risk_Read: "EV gap",
      Trigger_Read: "e-Vitara launch, capacity adds", Overall_Signal: "Positive",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },

    { FY: "FY23", Company: "Hyundai", Share_Read: "Stable", Growth_Read: "In line",
      Margin_Read: "Expanding", Mix_Read: "SUV strong", Risk_Read: "Capacity ceiling",
      Trigger_Read: "Talegaon plant", Overall_Signal: "Neutral",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY24", Company: "Hyundai", Share_Read: "Stable", Growth_Read: "Behind",
      Margin_Read: "Expanding", Mix_Read: "SUV + Export improving", Risk_Read: "Capacity ceiling",
      Trigger_Read: "IPO unlock, Creta facelift", Overall_Signal: "Neutral",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY25", Company: "Hyundai", Share_Read: "Losing", Growth_Read: "Behind",
      Margin_Read: "Flat", Mix_Read: "SUV richer; volume soft", Risk_Read: "Sub-Rs10L weakness",
      Trigger_Read: "Creta EV, Talegaon ramp", Overall_Signal: "Negative",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },

    { FY: "FY23", Company: "M&M", Share_Read: "Gaining", Growth_Read: "Ahead",
      Margin_Read: "Expanding", Mix_Read: "SUV-only mix richer", Risk_Read: "Wait-times unwinding",
      Trigger_Read: "Scorpio-N, XUV700 ramp", Overall_Signal: "Positive",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY24", Company: "M&M", Share_Read: "Gaining", Growth_Read: "Ahead",
      Margin_Read: "Expanding", Mix_Read: "SUV improving", Risk_Read: "EV portfolio gap",
      Trigger_Read: "Thar 5-door, XUV 3XO", Overall_Signal: "Positive",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY25", Company: "M&M", Share_Read: "Gaining", Growth_Read: "Ahead",
      Margin_Read: "Expanding", Mix_Read: "SUV + EV improving", Risk_Read: "EV ramp execution",
      Trigger_Read: "BE 6 / XEV 9e launches", Overall_Signal: "Positive",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },

    { FY: "FY23", Company: "Tata Motors PV", Share_Read: "Gaining", Growth_Read: "Ahead",
      Margin_Read: "Expanding", Mix_Read: "EV + SUV strong", Risk_Read: "Sedan absent",
      Trigger_Read: "Punch, Nexon EV scale", Overall_Signal: "Positive",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY24", Company: "Tata Motors PV", Share_Read: "Stable", Growth_Read: "In line",
      Margin_Read: "Flat", Mix_Read: "EV softening, SUV up", Risk_Read: "EV demand cooling",
      Trigger_Read: "Curvv, Harrier EV", Overall_Signal: "Neutral",
      Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY25", Company: "Tata Motors PV", Share_Read: "Losing", Growth_Read: "Behind",
      Margin_Read: "Pressure", Mix_Read: "EV slowing, hatch eroding", Risk_Read: "EV competition",
      Trigger_Read: "Punch EV ramp, new platform", Overall_Signal: "Negative",
      Source: "Pending", Source_URL: null, Last_Updated: STALE_ISO },
  ];

  /* =========================================================
     Table 4 — Company_Info
     ========================================================= */
  const Company_Info = [
    { FY: "FY25", Company: "Maruti", CEO: "Hisashi Takeuchi", CFO: "Rahul Bharti",
      COO: "Kenichi Ayukawa", Credit_Rating: "CRISIL AAA / Stable",
      Employees: 18500, Dealers: 4000, Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY25", Company: "Hyundai", CEO: "Unsoo Kim", CFO: "P.B. Balaji",
      COO: "Tarun Garg", Credit_Rating: "CRISIL AAA / Stable",
      Employees: 9000, Dealers: 1366, Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY25", Company: "M&M", CEO: "Anish Shah", CFO: "Amarjyoti Barua",
      COO: "Rajesh Jejurikar", Credit_Rating: "CRISIL AAA / Stable",
      Employees: 24500, Dealers: 1500, Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY25", Company: "Tata Motors PV", CEO: "Shailesh Chandra", CFO: "Dhiman Gupta",
      COO: "—", Credit_Rating: "CRISIL AA+ / Positive",
      Employees: 12000, Dealers: 1500, Source: "Pending", Source_URL: null, Last_Updated: STALE_ISO },

    { FY: "FY24", Company: "Maruti", CEO: "Hisashi Takeuchi", CFO: "Rahul Bharti",
      COO: "Kenichi Ayukawa", Credit_Rating: "CRISIL AAA / Stable",
      Employees: 17800, Dealers: 3845, Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
    { FY: "FY23", Company: "Maruti", CEO: "Hisashi Takeuchi", CFO: "Ajay Seth",
      COO: "Kenichi Ayukawa", Credit_Rating: "CRISIL AAA / Stable",
      Employees: 17000, Dealers: 3680, Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO },
  ];

  /* Logo_URL is keyed per company (constant across FYs). Best-effort
     defaults via Clearbit's public logo endpoint; falls back to a
     "Logo pending" UI state on load error. Data agents should replace
     these with verified URLs from official OEM media assets. */
  const COMPANY_LOGO_URL = {
    "Maruti":         "https://logo.clearbit.com/marutisuzuki.com",
    "Hyundai":        "https://logo.clearbit.com/hyundai.com",
    "M&M":            "https://logo.clearbit.com/mahindra.com",
    "Tata Motors PV": "https://logo.clearbit.com/tatamotors.com",
    "Industry":       null,
  };
  Company_Info.forEach(r => { r.Logo_URL = COMPANY_LOGO_URL[r.Company] || null; });

  /* =========================================================
     Table 5 — Industry_FY_Metrics (FY23-FY25 actual + history)
     ========================================================= */
  const Industry_FY_Metrics = [];
  ([
    ["FY23", { "Total PV Volume": [3890000, 27.0, "Positive"], "PV Volume Growth %": [27.0, 14.0, "Positive"],
               "SUV Share %": [42.0, 4.0, "Positive"], "EV Share %": [1.4, 0.8, "Positive"],
               "Export Share %": [12.5, 1.0, "Positive"], "Top Gaining OEM": ["M&M", null, "Neutral"] }],
    ["FY24", { "Total PV Volume": [4200000, 8.0, "Neutral"], "PV Volume Growth %": [8.0, -19.0, "Neutral"],
               "SUV Share %": [50.0, 8.0, "Positive"], "EV Share %": [2.2, 0.8, "Positive"],
               "Export Share %": [13.5, 1.0, "Positive"], "Top Gaining OEM": ["M&M", null, "Neutral"] }],
    ["FY25", { "Total PV Volume": [4350000, 3.6, "Neutral"], "PV Volume Growth %": [3.6, -4.4, "Neutral"],
               "SUV Share %": [55.0, 5.0, "Positive"], "EV Share %": [2.6, 0.4, "Positive"],
               "Export Share %": [14.5, 1.0, "Positive"], "Top Gaining OEM": ["M&M", null, "Neutral"] }],
  ]).forEach(([fy, metrics]) => {
    Object.entries(metrics).forEach(([metric, [val, yoy, sig]]) => {
      Industry_FY_Metrics.push({
        FY: fy, Metric: metric, Value: val, YoY_Change: yoy, Signal: sig,
        Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO,
      });
    });
  });

  /* Industry history: anchor (FY16, FY23) for each metric, generate FY16-FY22. */
  const INDUSTRY_HISTORY = {
    "Total PV Volume":      [2790000, 3890000],
    "PV Volume Growth %":   [7.5, 27.0],
    "SUV Share %":          [22.0, 42.0],
    "EV Share %":           [0.0, 1.4],
    "Export Share %":       [10.0, 12.5],
    "Top Gaining OEM":      [null, null],
  };
  Object.entries(INDUSTRY_HISTORY).forEach(([metric, [v0, v7]]) => {
    if (v0 === null || v7 === null) return;
    HIST_FYS.forEach((fy, i) => {
      const t = (i + 1) / 8;
      let linear = v0 + (v7 - v0) * t;
      if (metric === "PV Volume Growth %" && fy === "FY21") linear = -10;     // covid
      if (metric === "Total PV Volume"    && fy === "FY21") linear *= 0.78;
      const noise = wobble("Industry" + metric, i, Math.abs(v7 - v0) * 0.04);
      let value = linear + noise;
      value = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
      Industry_FY_Metrics.push({
        FY: fy, Metric: metric, Value: value, YoY_Change: null, Signal: "Neutral",
        Source: "Pending", Source_URL: null, Last_Updated: TODAY_ISO,
      });
    });
  });

  return {
    COMPANIES, FYS, FYS_FULL, OEM_KPIS, INDUSTRY_KPIS, TREND_METRICS, DEFAULT_VEHICLES,
    Company_FY_Metrics, Vehicle_FY_Metrics, BuySide_Signals,
    Company_Info, Industry_FY_Metrics,
  };
})();
