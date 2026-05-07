/* =================================================================
   Dashboard rendering — single reusable template.
   Reads exclusively from window.PV_DATA tables.
   ================================================================= */
(function () {
  /* D, BRAND, TABS_OEM and TABS_INDUSTRY are populated from the
     async data layer (see init() at the bottom). They are left
     as `let` rather than `const` because the IIFE has to construct
     them after PV_LOADER resolves. */
  let D = null;
  let BRAND = null;
  let TABS_OEM = null;
  let TABS_INDUSTRY = null;

  const COLOR = {
    blue:    "#2563EB",
    blueSft: "#93B4F4",
    teal:    "#14B8A6",
    navy:    "#0B1F33",
    grey:    "#94A3B8",
    greySft: "#CBD5E1",
    pos:     "#16A34A",
    neg:     "#DC2626",
    warn:    "#B45309",
    amber:   "#F59E0B",
    neu:     "#64748B",
  };

  /* #RRGGBB → "r, g, b" string for use in CSS rgba(var(--x), …) */
  function hexToRgb(hex) {
    const m = String(hex || "").replace("#", "").match(/.{2}/g);
    return m && m.length >= 3
      ? `${parseInt(m[0],16)}, ${parseInt(m[1],16)}, ${parseInt(m[2],16)}`
      : "37, 99, 235";
  }

  const state = {
    fy:        "FY25",
    company:   "Maruti",
    activeTab: "Growth",
  };

  /* ---------- helpers ---------- */
  const $ = (sel) => document.querySelector(sel);
  const fmtNum = (n) => {
    if (n === null || n === undefined) return "—";
    if (typeof n !== "number") return String(n);
    const abs = Math.abs(n);
    if (abs >= 1e7) return (n / 1e7).toFixed(2) + " Cr";
    if (abs >= 1e5) return (n / 1e5).toFixed(2) + " L";
    if (abs >= 1000) return n.toLocaleString("en-IN");
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(1);
  };
  const fmtDelta = (n, suffix = "pp") => {
    if (n === null || n === undefined) return "—";
    return (n >= 0 ? "+" : "") + n.toFixed(1) + suffix;
  };
  const prevFY = (fy) => {
    const i = D.FYS_FULL.indexOf(fy);
    return i > 0 ? D.FYS_FULL[i - 1] : null;
  };
  const signalClass = (s) => ({
    "Positive": "signal-pos",
    "Negative": "signal-neg",
    "Neutral":  "signal-neu",
  }[s] || "signal-neu");
  const signalDot = (s) => {
    const colour = { "Positive": "#2E7D32", "Negative": "#C62828", "Neutral": "#64748B" }[s] || "#64748B";
    return `<span class="inline-block w-1.5 h-1.5 rounded-full" style="background:${colour}"></span>`;
  };
  const daysSince = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return Math.floor((Date.now() - d) / 86400000);
  };
  const freshness = (iso) => {
    const days = daysSince(iso);
    if (days === null) return "Missing";
    return days <= 30 ? "Fresh" : "Stale";
  };
  const isPctMetric = (m) => m.includes("%") || m.includes("Margin") || m.includes("Share");

  function formatMetricValue(metric, v) {
    if (v === null || v === undefined) return "—";
    if (typeof v === "string") return v;
    if (metric === "Stock Price (31-Mar)") return "₹" + fmtNum(v);
    if (metric === "Total PV Volume" || metric === "Capacity (units)") return fmtNum(v);
    if (metric === "Capex (Rs Cr)") return "₹" + fmtNum(v) + " Cr";
    if (isPctMetric(metric)) return v.toFixed(1) + "%";
    if (metric === "Working Capital Days") return v.toFixed(0) + " d";
    return fmtNum(v);
  }

  /* ---------- table queries ---------- */
  const getCompanyMetric = (fy, company, metric) =>
    D.Company_FY_Metrics.find(r => r.FY === fy && r.Company === company && r.Metric === metric);
  const getIndustryMetric = (fy, metric) =>
    D.Industry_FY_Metrics.find(r => r.FY === fy && r.Metric === metric);
  const getBuySide = (fy, company) =>
    D.BuySide_Signals.find(r => r.FY === fy && r.Company === company);
  const getCompanyInfo = (fy, company) =>
    D.Company_Info.find(r => r.FY === fy && r.Company === company)
    || D.Company_Info.find(r => r.Company === company);
  const getVehicles = (fy, company) =>
    D.Vehicle_FY_Metrics.filter(r => r.FY === fy && r.Company === company);

  function getMetricHistory(company, metric, maxYears = 10, untilFY = null) {
    const isIndustry = company === "Industry";
    const rows = isIndustry
      ? D.Industry_FY_Metrics.filter(r => r.Metric === metric)
      : D.Company_FY_Metrics.filter(r => r.Company === company && r.Metric === metric);
    const indexOf = (fy) => D.FYS_FULL.indexOf(fy);
    let sorted = rows.slice().sort((a, b) => indexOf(a.FY) - indexOf(b.FY));
    if (untilFY) {
      const cutoff = indexOf(untilFY);
      sorted = sorted.filter(r => indexOf(r.FY) <= cutoff);
    }
    return sorted.slice(-maxYears);
  }

  function computeLastUpdated() {
    const isIndustry = state.company === "Industry";
    const rows = isIndustry
      ? D.Industry_FY_Metrics.filter(r => r.FY === state.fy)
      : D.Company_FY_Metrics.filter(r => r.FY === state.fy && r.Company === state.company)
          .concat(getBuySide(state.fy, state.company) ? [getBuySide(state.fy, state.company)] : [])
          .concat(getVehicles(state.fy, state.company));
    if (!rows.length) return null;
    let latest = null;
    rows.forEach(r => {
      if (!r.Last_Updated) return;
      if (!latest || r.Last_Updated > latest) latest = r.Last_Updated;
    });
    return latest;
  }

  /* ---------- KPI icons ---------- */
  const ICON = {
    "Market Share %":      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l7 4"/></svg>`,
    "Volume Growth %":     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-9"/><path d="M14 6h7v7"/></svg>`,
    "Revenue Growth %":    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    "EBITDA Margin %":     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19L19 5"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/></svg>`,
    "SUV Revenue %":       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="6" rx="1.5"/><path d="M5 11l2-5h10l2 5"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg>`,
    "Stock Price (31-Mar)":`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><rect x="6" y="11" width="3" height="9"/><rect x="11" y="6" width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></svg>`,
    "Total PV Volume":     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="6" rx="1.5"/><path d="M5 11l2-5h10l2 5"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg>`,
    "PV Volume Growth %":  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-9"/><path d="M14 6h7v7"/></svg>`,
    "SUV Share %":         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l8 2"/></svg>`,
    "EV Share %":          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>`,
    "Export Share %":      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
    "Top Gaining OEM":     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M6 4h12l-1 8a5 5 0 0 1-10 0z"/></svg>`,
  };
  const iconFor = (m) => ICON[m] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>`;

  /* ---------- top header ---------- */
  function renderTopBar() {
    $("#fy-select").innerHTML  = D.FYS.map(f => `<option value="${f}" ${f===state.fy?"selected":""}>${f}</option>`).join("");
    $("#company-select").innerHTML = D.COMPANIES.map(c => `<option value="${c}" ${c===state.company?"selected":""}>${c}</option>`).join("");
    $("#hdr-brand-dot").style.background = BRAND[state.company].color;

    let overall = "Neutral";
    if (state.company === "Industry") {
      const r = getIndustryMetric(state.fy, "PV Volume Growth %");
      overall = r ? r.Signal : "Neutral";
    } else {
      const bs = getBuySide(state.fy, state.company);
      overall = bs ? bs.Overall_Signal : "Neutral";
    }
    const sigEl = $("#overall-signal");
    sigEl.className = `text-xs font-semibold px-2.5 py-0.5 rounded-full ${signalClass(overall)}`;
    sigEl.textContent = overall;

    const lu = computeLastUpdated();
    $("#last-updated").textContent = lu
      ? new Date(lu).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : "—";

    const fresh = freshness(lu);
    const fEl = $("#freshness-badge");
    fEl.textContent = fresh;
    fEl.className = "text-xs font-semibold px-2.5 py-0.5 rounded-full " +
      (fresh === "Fresh" ? "signal-pos" : fresh === "Stale" ? "signal-warn" : "signal-neg");

    const warn = $("#stale-warning");
    if (fresh === "Stale" || fresh === "Missing") {
      warn.classList.remove("hidden");
      warn.textContent = fresh === "Missing"
        ? "⚠ Data missing for selected FY"
        : "⚠ Some metrics last refreshed > 30 days ago";
    } else {
      warn.classList.add("hidden");
    }
  }

  /* ---------- identity row ----------
     Brand badges are intentionally abstract geometric marks built from
     primitives (rectangles, circles, chevrons, network dots). They take
     their colour cue from each OEM's palette but do not reproduce any
     real logo, wordmark, or trademarked shape. Each card has its own
     visual motif so the five companies remain visually distinct. */
  const BRAND_BADGE = {
    "Maruti": (c) => `
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="9" fill="${c}"/>
        <rect x="6"  y="20" width="4.4" height="6"  rx="1" fill="#FFFFFF" opacity="0.55"/>
        <rect x="13.5" y="14" width="4.4" height="12" rx="1" fill="#FFFFFF" opacity="0.78"/>
        <rect x="21" y="9"  width="4.4" height="17" rx="1" fill="#FFFFFF"/>
      </svg>`,
    "Hyundai": (c) => `
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="9" fill="${c}"/>
        <circle cx="16" cy="16" r="9" fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.45"/>
        <line x1="9" y1="22" x2="22" y2="11" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/>
        <circle cx="22" cy="11" r="1.6" fill="#FFFFFF"/>
      </svg>`,
    "Tata Motors PV": (c) => `
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="9" fill="${c}"/>
        <path d="M9 22 L16 11 L23 22" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <line x1="11" y1="23.6" x2="21" y2="23.6" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
      </svg>`,
    "M&M": (c) => `
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="9" fill="${c}"/>
        <circle cx="13" cy="16" r="5.5" fill="none" stroke="#FFFFFF" stroke-width="1.6" opacity="0.7"/>
        <circle cx="19" cy="16" r="5.5" fill="none" stroke="#FFFFFF" stroke-width="1.6"/>
      </svg>`,
    "Industry": (c) => `
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="9" fill="${c}"/>
        <line x1="9" y1="22" x2="16" y2="13" stroke="#FFFFFF" stroke-width="1.4" opacity="0.5"/>
        <line x1="16" y1="13" x2="23" y2="11" stroke="#FFFFFF" stroke-width="1.4" opacity="0.5"/>
        <circle cx="9"  cy="22" r="2.2" fill="#FFFFFF" opacity="0.6"/>
        <circle cx="16" cy="13" r="2.2" fill="#FFFFFF" opacity="0.85"/>
        <circle cx="23" cy="11" r="2.2" fill="#FFFFFF"/>
      </svg>`,
  };
  function brandBadge(company) {
    const brand = BRAND[company] || { color: "#334E68" };
    const fn = BRAND_BADGE[company] || BRAND_BADGE["Industry"];
    return fn(brand.color);
  }

  /* Render the logo box. Priority:
       1) Logo_URL (real OEM logo from Company_Info)
       2) on <img> error: abstract brand badge (also used for Industry,
          which has Logo_URL = null by design)
     The container always renders something so layout doesn't shift. */
  function applyLogoMark(el, company, sizeClass = "") {
    const info = getCompanyInfo(state.fy, company);
    const url  = info && info.Logo_URL;
    const baseClass = `logo-mark ${sizeClass}`.trim();

    if (!url) {
      el.className = `${baseClass} logo-mark-badge`;
      el.removeAttribute("style");
      el.innerHTML = brandBadge(company);
      return;
    }

    el.className = `${baseClass} logo-mark-image`;
    el.removeAttribute("style");
    el.innerHTML = "";
    const img = document.createElement("img");
    img.alt = `${company} logo`;
    img.onerror = () => {
      el.className = `${baseClass} logo-mark-badge`;
      el.innerHTML = brandBadge(company);
    };
    img.src = url;
    el.appendChild(img);
  }

  /* Vehicle art — original abstract side-view silhouettes built from
     SVG primitives (paths, circles). Two body forms keep cards visually
     consistent while distinguishing tall (SUV / Sub-SUV / Utility) from
     low (Hatch / Sedan / MPV / EV) segments. They do not replicate any
     specific model's photograph or render. */
  function vehicleArt(segment) {
    const seg = (segment || "").toLowerCase();
    const tall = seg === "suv" || seg === "sub-suv" || seg === "utility";

    const body = tall
      ? `M14 40 L22 22 L40 18 L82 18 L100 22 L108 40 L108 42 L14 42 Z`
      : `M10 40 L22 28 L46 22 Q68 20 88 24 L102 30 L110 40 L110 42 L10 42 Z`;
    const window_ = tall
      ? `M26 22 L42 19 L82 19 L94 22 L94 30 L26 30 Z`
      : `M28 28 L46 23 Q66 21 84 24 L84 30 L28 30 Z`;
    const wheelL = tall ? 32 : 32;
    const wheelR = tall ? 92 : 92;

    return `
      <svg viewBox="0 0 120 50" preserveAspectRatio="xMidYMid meet" class="vehicle-art" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="va-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stop-color="#EAF2FF"/>
            <stop offset="100%" stop-color="#DCEBFF"/>
          </linearGradient>
          <linearGradient id="va-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stop-color="#3D7AE8"/>
            <stop offset="100%" stop-color="#1E4FB8"/>
          </linearGradient>
        </defs>
        <rect width="120" height="50" fill="url(#va-bg)"/>
        <path d="${body}" fill="url(#va-body)"/>
        <path d="${window_}" fill="#FFFFFF" opacity="0.42"/>
        <circle cx="${wheelL}" cy="42" r="5" fill="#0B1F33"/>
        <circle cx="${wheelL}" cy="42" r="2.2" fill="#94A3B8"/>
        <circle cx="${wheelR}" cy="42" r="5" fill="#0B1F33"/>
        <circle cx="${wheelR}" cy="42" r="2.2" fill="#94A3B8"/>
      </svg>`;
  }

  function renderIdentityRow() {
    const brand = BRAND[state.company];
    const isIndustry = state.company === "Industry";

    applyLogoMark($("#logo-mark"), state.company);

    $("#brand-box").innerHTML = `
      <div class="brand-box" style="--brand:${brand.color}">
        <span class="brand-eyebrow">${brand.label}</span>
        <span class="brand-name">${state.company}</span>
      </div>`;

    $("#fy-chip").innerHTML = `
      <span class="fy-chip-label">FY</span>
      <span class="fy-chip-value">${state.fy}</span>`;

    if (isIndustry) {
      $("#view-title").textContent = `Indian PV Industry Cockpit`;
      $("#view-subtitle").textContent = "Demand · mix · competitive shifts across OEMs.";
    } else {
      $("#view-title").textContent = `${state.company} — buy-side snapshot`;
      const info = getCompanyInfo(state.fy, state.company);
      $("#view-subtitle").textContent = info
        ? `CEO ${info.CEO} · CFO ${info.CFO || "—"} · ${info.Credit_Rating}`
        : "Company governance info pending.";
    }

    $("#yoy-base").textContent = prevFY(state.fy) || "—";
  }

  /* ---------- sparkline ---------- */
  function sparkline(values, options = {}) {
    const numeric = values.filter(v => typeof v === "number");
    if (numeric.length < 2) {
      return `<div class="kpi-spark-empty">Limited history</div>`;
    }
    const w = 200, h = 28, padX = 3, padY = 4;
    let min = Math.min(...numeric), max = Math.max(...numeric);
    if (min === max) { min -= 1; max += 1; }
    const x = (i) => padX + i * ((w - padX*2) / Math.max(values.length - 1, 1));
    const y = (v) => padY + (1 - (v - min) / (max - min)) * (h - padY*2);

    let pts = [];
    let path = "";
    values.forEach((v, i) => {
      if (typeof v !== "number") return;
      pts.push([i, v]);
      const cmd = path === "" ? "M" : "L";
      path += `${cmd}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    });
    if (!pts.length) return `<div class="kpi-spark-empty">No history</div>`;

    const firstI = pts[0][0], lastI = pts[pts.length-1][0];
    const lastV = pts[pts.length-1][1];
    const baseY = h - padY;
    const areaPath = `${path} L${x(lastI).toFixed(1)} ${baseY.toFixed(1)} L${x(firstI).toFixed(1)} ${baseY.toFixed(1)} Z`;

    let benchPath = "";
    if (options.bench && options.bench.length === values.length) {
      let bp = "";
      options.bench.forEach((v, i) => {
        if (typeof v !== "number") return;
        const cmd = bp === "" ? "M" : "L";
        bp += `${cmd}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      });
      if (bp) benchPath = `<path class="spark-bench" d="${bp}"/>`;
    }

    return `<svg class="sparkline-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path class="spark-area" d="${areaPath}"/>
      ${benchPath}
      <path class="spark-line" d="${path}"/>
      <circle class="spark-dot" cx="${x(lastI).toFixed(1)}" cy="${y(lastV).toFixed(1)}" r="2.5"/>
    </svg>`;
  }

  /* ---------- KPI strip ---------- */
  function renderKpiStrip() {
    const grid = $("#kpi-strip");
    const isIndustry = state.company === "Industry";
    const list = isIndustry ? D.INDUSTRY_KPIS : D.OEM_KPIS;

    grid.innerHTML = list.map((metric, idx) => {
      const r = isIndustry
        ? getIndustryMetric(state.fy, metric)
        : getCompanyMetric(state.fy, state.company, metric);

      const val = r ? r.Value : null;
      const yoy = r ? r.YoY_Change : null;
      const sig = r ? r.Signal : "Neutral";
      const lu  = r ? r.Last_Updated : null;
      const stalePending = !r || val === null || freshness(lu) === "Missing";

      const valDisplay = formatMetricValue(metric, val);
      let deltaDisplay = "—", deltaClass = "delta-flat";
      if (typeof yoy === "number") {
        const suffix = isPctMetric(metric) ? "pp" : (metric === "Stock Price (31-Mar)" ? "%" : "");
        deltaDisplay = fmtDelta(yoy, suffix);
        deltaClass = yoy > 0 ? "delta-up" : yoy < 0 ? "delta-down" : "delta-flat";
      }

      const tinted = idx % 2 === 1 ? "tinted" : "";

      return `
        <div class="kpi-card ${tinted}" data-metric="${metric}">
          <div class="flex items-start justify-between mb-1.5">
            <span class="kpi-icon">${iconFor(metric)}</span>
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${signalClass(sig)}">${sig}</span>
          </div>
          <div class="text-[10.5px] uppercase tracking-wider text-inkMuted font-semibold">${metric}</div>
          <div class="text-[22px] font-semibold text-navy leading-tight tabular-nums mt-0.5">${valDisplay}</div>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-[11.5px] ${deltaClass} tabular-nums font-semibold">${deltaDisplay}</span>
            <span class="text-[10px] text-inkMuted">YoY</span>
            ${stalePending ? '<span class="ml-auto text-[9px] text-warn bg-warnSoft px-1.5 py-0.5 rounded font-medium">Pending</span>' : ''}
          </div>
        </div>`;
    }).join("");

    grid.querySelectorAll(".kpi-card").forEach(el => {
      const metric = el.dataset.metric;
      const trendable = D.TREND_METRICS.has(metric)
        || (state.company === "Industry" && metric !== "Top Gaining OEM");
      if (!trendable) { el.style.cursor = "default"; return; }
      el.addEventListener("click", () => openTrendModal(metric));
      attachHoverTip(el);
    });
  }

  /* ---------- main-page chart helpers ----------
     Numbers no longer render inline; each bar / stack segment / line
     point gets a `class="bar hover-target"` (or invisible overlay rect
     for line charts) carrying data-fy / data-series / data-value /
     data-unit / data-color. bindChartHovers() wires those into the
     shared #chart-tooltip element after the SVG is mounted. */

  const ATTR = (s) => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/"/g,"&quot;");

  function lineChart(series, options = {}) {
    const w = 480, h = options.height || 220, padL = 44, padR = 16, padT = 14, padB = 28;
    const labels = options.xLabels || [];
    const allVals = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
    if (!allVals.length) return `<div class="text-xs text-inkMuted py-6 text-center">No data available</div>`;
    let yMin = Math.min(...allVals, 0), yMax = Math.max(...allVals, 1);
    const span = yMax - yMin || 1;
    yMin -= span * 0.1; yMax += span * 0.18;

    const x = (i) => padL + i * ((w - padL - padR) / Math.max(labels.length - 1, 1));
    const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);

    const grid = [0,0.25,0.5,0.75,1].map(t => {
      const yy = padT + t * (h - padT - padB);
      const val = yMax - t * (yMax - yMin);
      return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#EEF1F5"/>
              <text x="${padL-6}" y="${yy+3}" text-anchor="end" font-size="10" fill="#6B7280">${val.toFixed(0)}${options.yUnit||""}</text>`;
    }).join("");

    let lines = "";
    series.forEach((s, idx) => {
      const points = s.values.map((v, i) => v === null || v === undefined ? null : [x(i), y(v)]);
      let path = "";
      points.forEach((p, i) => {
        if (!p) return;
        const cmd = path === "" ? "M" : (points[i-1] ? "L" : "M");
        path += `${cmd} ${p[0]} ${p[1]} `;
      });
      if (options.area && idx === 0) {
        const firstIdx = points.findIndex(Boolean);
        const lastIdx  = points.length - 1 - points.slice().reverse().findIndex(Boolean);
        if (firstIdx >= 0) {
          const areaPath = `${path} L ${x(lastIdx)} ${y(yMin)} L ${x(firstIdx)} ${y(yMin)} Z`;
          lines += `<path class="area" d="${areaPath}" fill="${s.color}"/>`;
        }
      }
      lines += `<path class="line-path" d="${path}" stroke="${s.color}"/>`;
      points.forEach((p) => {
        if (!p) return;
        lines += `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3.2" fill="${s.color}"/>`;
      });
    });

    const xAxis = labels.map((l, i) =>
      `<text x="${x(i)}" y="${h-8}" text-anchor="middle" font-size="10" fill="#6B7280">${l}</text>`).join("");

    /* Hover targets: invisible column rects covering each FY's vertical
       slice. Always tied to the primary (idx=0) series — secondary
       series are typically benchmarks displayed alongside. */
    const colW = (w - padL - padR) / Math.max(labels.length - 1, 1);
    const primary = series[0] || {};
    const hovers = labels.map((l, i) => {
      const v = primary.values && primary.values[i];
      if (v === null || v === undefined) return "";
      return `<rect class="hover-target" x="${x(i) - colW/2}" y="${padT}" width="${colW}" height="${h - padT - padB}" fill="transparent"
        data-fy="${ATTR(l)}" data-series="${ATTR(primary.name||"")}" data-value="${ATTR(v)}"
        data-unit="${ATTR(options.yUnit||"")}" data-color="${ATTR(primary.color||"#2563EB")}"/>`;
    }).join("");

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <g class="grid">${grid}</g>${lines}<g class="axis">${xAxis}</g>${hovers}
    </svg>`;
  }

  function stackedBarChart(series, labels, options = {}) {
    const w = 480, h = 220, padL = 44, padR = 16, padT = 14, padB = 28;
    const groupW = (w - padL - padR) / labels.length;
    const barW = Math.min(groupW * 0.55, 60);
    const totals = labels.map((_, i) => series.reduce((s, ss) => s + (ss.values[i] || 0), 0));
    const yMax = Math.max(...totals, 1) * 1.18;
    const yScale = (v) => padT + (1 - v / yMax) * (h - padT - padB);
    const MIN_SEG_PX = 5;   // minimum visible thickness for tiny non-zero segments (e.g. 0.4% EV)

    const grid = [0,0.25,0.5,0.75,1].map(t => {
      const yy = padT + t * (h - padT - padB);
      const val = yMax * (1 - t);
      return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#EEF1F5"/>
              <text x="${padL-6}" y="${yy+3}" text-anchor="end" font-size="10" fill="#6B7280">${val.toFixed(0)}${options.yUnit||""}</text>`;
    }).join("");

    let bars = "";
    labels.forEach((label, i) => {
      let cum = 0;
      const cx = padL + groupW * (i + 0.5);
      series.forEach((s) => {
        const v = s.values[i] || 0;
        if (v <= 0) { /* skip exact-zero segments — no forced bar */ cum += v; return; }
        const yBot = yScale(cum);
        let yTop  = yScale(cum + v);
        let hh = Math.max(0, yBot - yTop);
        if (hh < MIN_SEG_PX) { hh = MIN_SEG_PX; yTop = yBot - MIN_SEG_PX; }
        bars += `<rect class="bar hover-target" x="${cx - barW/2}" y="${yTop}" width="${barW}" height="${hh}" fill="${s.color}" rx="2"
          data-fy="${ATTR(label)}" data-series="${ATTR(s.name)}" data-value="${ATTR(v)}"
          data-unit="${ATTR(options.yUnit||"")}" data-color="${ATTR(s.color)}"/>`;
        cum += v;
      });
      bars += `<text x="${cx}" y="${h-8}" text-anchor="middle" font-size="10" fill="#6B7280">${label}</text>`;
    });
    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
  }

  function groupedBarChart(series, labels, options = {}) {
    const w = 480, h = 220, padL = 44, padR = 16, padT = 14, padB = 28;
    const groupW = (w - padL - padR) / labels.length;
    const barW = Math.min((groupW * 0.7) / series.length, 28);
    const allVals = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
    let yMin = Math.min(...allVals, 0), yMax = Math.max(...allVals, 1);
    if (yMin > 0) yMin = 0;
    yMax *= 1.18;
    const yScale = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);
    const zeroY = yScale(0);

    const grid = [0,0.25,0.5,0.75,1].map(t => {
      const yy = padT + t * (h - padT - padB);
      const val = yMax - t * (yMax - yMin);
      return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#EEF1F5"/>
              <text x="${padL-6}" y="${yy+3}" text-anchor="end" font-size="10" fill="#6B7280">${val.toFixed(0)}${options.yUnit||""}</text>`;
    }).join("");

    let bars = "";
    labels.forEach((label, i) => {
      const cx = padL + groupW * (i + 0.5);
      const startX = cx - (series.length * barW) / 2;
      series.forEach((s, si) => {
        const v = s.values[i];
        if (v === null || v === undefined) return;
        const yy = yScale(v);
        const hh = Math.abs(yy - zeroY);
        const yTop = v >= 0 ? yy : zeroY;
        bars += `<rect class="bar hover-target" x="${startX + si*barW}" y="${yTop}" width="${barW - 2}" height="${hh}" fill="${s.color}" rx="2"
          data-fy="${ATTR(label)}" data-series="${ATTR(s.name)}" data-value="${ATTR(v)}"
          data-unit="${ATTR(options.yUnit||"")}" data-color="${ATTR(s.color)}"/>`;
      });
      bars += `<text x="${cx}" y="${h-8}" text-anchor="middle" font-size="10" fill="#6B7280">${label}</text>`;
    });
    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
  }

  /* Bind hover-only tooltips to any chart container's hover targets. */
  function bindChartHovers(rootEl) {
    if (!rootEl) return;
    const tip = $("#chart-tooltip");
    rootEl.querySelectorAll(".hover-target").forEach(el => {
      el.addEventListener("mouseenter", (e) => showChartTip(e, el));
      el.addEventListener("mousemove",  (e) => positionTip(tip, e));
      el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
    });
  }
  function showChartTip(e, el) {
    const tip = $("#chart-tooltip");
    const fy   = el.dataset.fy || "";
    const name = el.dataset.series || "";
    const raw  = parseFloat(el.dataset.value);
    const unit = el.dataset.unit || "";
    const colour = el.dataset.color || "#2563EB";
    let formatted;
    if (Number.isNaN(raw)) {
      formatted = "—";
    } else if (unit === "%") {
      formatted = (raw >= 0 ? "+" : "") + raw.toFixed(1) + "%";
    } else if (Math.abs(raw) >= 1000) {
      formatted = Math.round(raw).toLocaleString("en-IN");
    } else {
      formatted = raw.toFixed(1);
    }
    $("#cht-fy").textContent     = fy;
    $("#cht-series").textContent = name;
    $("#cht-value").textContent  = formatted;
    $("#cht-swatch").style.background = colour;
    tip.classList.remove("hidden");
    positionTip(tip, e);
  }

  const legendChip = (color, label) =>
    `<span class="inline-flex items-center gap-1.5">
       <span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${color}"></span>${label}
     </span>`;

  /* ---------- main-page charts ---------- */
  function renderCharts() {
    const isIndustry = state.company === "Industry";
    const fyHistory = D.FYS;

    if (isIndustry) {
      $("#chart1-title").textContent = "PV industry volume trend";
      $("#chart1-help").textContent  = "Aggregate domestic PV demand across FYs.";
      $("#chart1-sub").textContent   = "Lakhs · units";

      const indVol = fyHistory.map(fy => {
        const r = getIndustryMetric(fy, "Total PV Volume");
        return r ? r.Value / 100000 : null;
      });
      $("#chart1").innerHTML = lineChart([
        { name: "Industry volume", color: COLOR.navy, values: indVol },
      ], { xLabels: fyHistory, area: true });
      $("#chart1-legend").innerHTML = legendChip(COLOR.navy, "PV industry volume (lakh units)");

      $("#chart2-title").textContent = "OEM market share";
      $("#chart2-help").textContent  = "Selected FY share alongside the prior FY.";
      $("#chart2-sub").textContent   = state.fy + " · %";

      const oems = ["Maruti", "Hyundai", "M&M", "Tata Motors PV"];
      const sharesPrev = oems.map(o => (getCompanyMetric(prevFY(state.fy) || state.fy, o, "Market Share %")||{}).Value || 0);
      const sharesCurr = oems.map(o => (getCompanyMetric(state.fy, o, "Market Share %")||{}).Value || 0);
      $("#chart2").innerHTML = groupedBarChart([
        { name: prevFY(state.fy) || state.fy, color: COLOR.greySft, values: sharesPrev },
        { name: state.fy,                      color: COLOR.blue,    values: sharesCurr },
      ], oems, { yUnit: "%" });
      $("#chart2-legend").innerHTML =
        legendChip(COLOR.greySft, prevFY(state.fy) || "Prev FY") + legendChip(COLOR.blue, state.fy);

    } else {
      $("#chart1-title").textContent = `${state.company} growth vs PV industry`;
      $("#chart1-help").textContent  = "Are we outperforming the industry?";
      $("#chart1-sub").textContent   = "Volume growth %";

      const oemVals = fyHistory.map(fy => (getCompanyMetric(fy, state.company, "Volume Growth %")||{}).Value ?? null);
      const indVals = fyHistory.map(fy => (getIndustryMetric(fy, "PV Volume Growth %")||{}).Value ?? null);
      $("#chart1").innerHTML = groupedBarChart([
        { name: "PV industry", color: COLOR.greySft, values: indVals },
        { name: state.company, color: COLOR.blue,    values: oemVals },
      ], fyHistory, { yUnit: "%" });
      $("#chart1-legend").innerHTML =
        legendChip(COLOR.greySft, "PV industry") + legendChip(COLOR.blue, state.company);

      $("#chart2-title").textContent = "Mix shift";
      $("#chart2-help").textContent  = "Quality of growth — SUV / EV / Export contribution.";
      $("#chart2-sub").textContent   = "Volume mix · %";

      const suvVals = fyHistory.map(fy => (getCompanyMetric(fy, state.company, "SUV Volume %")||{}).Value || 0);
      const evVals  = fyHistory.map(fy => (getCompanyMetric(fy, state.company, "EV Volume %")||{}).Value  || 0);
      const expVals = fyHistory.map(fy => (getCompanyMetric(fy, state.company, "Export Volume %")||{}).Value || 0);

      $("#chart2").innerHTML = stackedBarChart([
        { name: "SUV",    color: COLOR.blue,    values: suvVals },
        { name: "EV",     color: COLOR.teal,    values: evVals  },
        { name: "Export", color: COLOR.warn,    values: expVals },
      ], fyHistory, { yUnit: "%" });
      $("#chart2-legend").innerHTML =
        legendChip(COLOR.blue, "SUV volume %") +
        legendChip(COLOR.teal, "EV volume %") +
        legendChip(COLOR.warn, "Export volume %");
    }

    bindChartHovers($("#chart1"));
    bindChartHovers($("#chart2"));
  }

  /* ---------- buy-side signal box ---------- */
  function renderSignalBox() {
    const box = $("#signal-box");
    if (state.company === "Industry") {
      const fy = state.fy;
      const volR = getIndustryMetric(fy, "PV Volume Growth %");
      const suvR = getIndustryMetric(fy, "SUV Share %");
      const evR  = getIndustryMetric(fy, "EV Share %");
      const expR = getIndustryMetric(fy, "Export Share %");
      const topR = getIndustryMetric(fy, "Top Gaining OEM");

      const demand = !volR ? "—" :
        volR.Value > 10 ? "Improving" : volR.Value > 4 ? "Stable" : "Slowing";
      const mixBits = [];
      if (suvR && suvR.YoY_Change > 0) mixBits.push("SUV improving");
      if (evR  && evR.YoY_Change  > 0) mixBits.push("EV improving");
      if (expR && expR.YoY_Change > 0) mixBits.push("Exports improving");
      const mix = mixBits.length ? mixBits.join(", ") : "Mix flat";

      const rows = [
        ["Demand",      demand],
        ["Mix",         mix],
        ["Competition", topR ? `${topR.Value} gaining most` : "—"],
        ["Risk",        "Sub-Rs10L hatch demand soft"],
        ["Trigger",     "Festive demand, EV launches"],
      ];
      box.innerHTML = rows.map(([k, v]) => `
        <div class="bsr"><span class="bsr-label">${k}</span><span class="bsr-pill">${v}</span></div>`).join("");
      return;
    }
    const bs = getBuySide(state.fy, state.company);
    if (!bs) {
      box.innerHTML = `<div class="text-xs text-inkMuted py-6 text-center">Data pending for ${state.company} — ${state.fy}</div>`;
      return;
    }
    const rows = [
      ["Share", bs.Share_Read], ["Growth", bs.Growth_Read], ["Margin", bs.Margin_Read],
      ["Mix", bs.Mix_Read], ["Risk", bs.Risk_Read], ["Trigger", bs.Trigger_Read],
    ];
    box.innerHTML = rows.map(([k, v]) => `
      <div class="bsr"><span class="bsr-label">${k}</span><span class="bsr-pill">${v}</span></div>`).join("");
  }

  /* ---------- vehicle cards ---------- */
  /* Build an expand-row only if the field has a real value.
     Returns "" for null/undefined/empty so the row is skipped. */
  function vehRow(label, value) {
    if (value === null || value === undefined || value === "") return "";
    return `<div class="veh-row">
      <span class="veh-row-key">${label}</span>
      <span class="veh-row-val">${value}</span>
    </div>`;
  }

  function renderVehicleCards() {
    const section = $("#vehicle-section");
    if (state.company === "Industry") { section.style.display = "none"; return; }
    section.style.display = "";

    const grid = $("#vehicle-grid");
    /* Drive the brand-tinted accent + hover state through a CSS var
       on the grid container — read by .veh-card / .veh-card::before
       via rgba(var(--veh-rgb), …). Defaults to primary blue if the
       brand color is missing. */
    const brand = BRAND[state.company] || {};
    grid.style.setProperty("--veh-rgb", hexToRgb(brand.color));

    const defaults = D.DEFAULT_VEHICLES[state.company] || [];
    const data = getVehicles(state.fy, state.company);
    const byName = Object.fromEntries(data.map(r => [r.Vehicle, r]));

    grid.innerHTML = defaults.map(name => {
      const r = byName[name];
      const placeholder = !r;
      const sig = r ? r.Signal : "Neutral";
      const sigLabel = sig === "Positive" ? "Gain" : sig === "Negative" ? "Loss" : "Stable";
      const fresh = r ? freshness(r.Last_Updated) : "Missing";

      /* Vehicle image only appears inside the hover-expand panel —
         never on the default card. Fades in via CSS once the expand
         panel opens. On <img> load error the entire image block is
         removed so the expand layout closes up cleanly. */
      const expandImage = (r && r.Image_URL)
        ? `<div class="veh-expand-image"><img src="${r.Image_URL}" alt="${name}"
             onerror="this.parentElement.remove();"></div>`
        : "";

      /* Expand rows — data-centric. Each row is rendered only when
         the underlying field has a real value (vehRow returns "" for
         null), so the panel never shows "Pending" placeholders. */
      const launchVal = r ? formatVehicleDate(r.Launch_Date) : null;
      const faceliftVal = (r && r.Facelift_Status)
        ? (r.Facelift_Date
            ? `${r.Facelift_Status} · ${formatVehicleDate(r.Facelift_Date)}`
            : r.Facelift_Status)
        : null;

      const expandRows = !placeholder ? [
        vehRow("Demand",       r.Demand_Read),
        vehRow("Launch",       launchVal),
        vehRow("Facelift",     faceliftVal),
        vehRow("Segment rank", r.Segment_Rank ? `#${r.Segment_Rank}${r.Segment ? " " + r.Segment : ""}` : null),
        vehRow("Key driver",   r.Key_Driver),
      ].filter(Boolean) : [];

      const insightHtml = (!placeholder && r.Vehicle_Insight)
        ? `<div class="veh-insight-box">${r.Vehicle_Insight}</div>`
        : "";

      const dividerHtml = (expandRows.length || insightHtml)
        ? `<div class="veh-divider"></div>` : "";

      /* Source link — small icon + name. Native title carries
         Source_URL + last-updated for unobtrusive hover detail.
         Renders only when the row has a real source. */
      const srcShow = r && r.Source && r.Source !== "Pending";
      const srcUpdated = r && r.Last_Updated
        ? new Date(r.Last_Updated).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })
        : null;
      const srcTitle = srcShow
        ? `${r.Source}${r.Source_URL ? ` — ${r.Source_URL}` : ""}${srcUpdated ? ` — Updated ${srcUpdated}` : ""}`
        : "";
      const srcLink = srcShow
        ? (r.Source_URL
            ? `<a class="src-link" href="${r.Source_URL}" target="_blank" rel="noopener" title="${ATTR(srcTitle)}" onclick="event.stopPropagation();">ⓘ ${ATTR(r.Source)}</a>`
            : `<span class="src-link" title="${ATTR(srcTitle)}">ⓘ ${ATTR(r.Source)}</span>`)
        : "";

      const expandSection = `
        <div class="veh-expand">
          ${expandImage}
          ${dividerHtml}
          ${expandRows.join("")}
          ${insightHtml}
          <div class="veh-foot">
            ${srcLink}
            <span class="veh-cta">View detail →</span>
          </div>
        </div>`;

      return `
        <div class="veh-card-wrap" data-vehicle="${name}">
          <div class="veh-card">
            <div class="flex items-start justify-between mb-1">
              <div>
                <div class="text-sm font-semibold text-navy leading-tight">${name}</div>
                <div class="text-[10.5px] text-inkMuted mt-0.5">${r ? r.Segment : "—"}</div>
              </div>
              <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${signalClass(sig)}">${sigLabel}</span>
            </div>
            <div class="text-[18px] font-semibold text-ink tabular-nums leading-tight">
              ${placeholder ? "—" : fmtNum(r.Volume)}
            </div>
            <div class="flex items-center justify-between mt-1">
              <span class="text-[10.5px] text-inkMuted">${state.fy} units</span>
              <span class="text-[11px] tabular-nums ${
                !placeholder && r.YoY_Growth > 0 ? "delta-up" :
                !placeholder && r.YoY_Growth < 0 ? "delta-down" : "delta-flat"
              }">${placeholder || r.YoY_Growth === null ? "—" : fmtDelta(r.YoY_Growth, "%")}</span>
            </div>
            ${placeholder
              ? `<div class="text-[9.5px] text-warn bg-warnSoft mt-2 px-1.5 py-0.5 rounded inline-block font-medium">Data pending</div>`
              : (fresh === "Stale"
                  ? `<div class="text-[9.5px] text-warn bg-warnSoft mt-2 px-1.5 py-0.5 rounded inline-block font-medium">Stale</div>`
                  : "")}
            ${expandSection}
          </div>
        </div>`;
    }).join("");

    grid.querySelectorAll(".veh-card-wrap").forEach(el => {
      el.addEventListener("click", () => openVehicleModal(state.company, el.dataset.vehicle));
    });
  }

  /* ---------- tabs ----------
     TABS_OEM and TABS_INDUSTRY are sourced from
     data/config/company_config.json at boot time (see init). */
  function renderTabs() {
    const isIndustry = state.company === "Industry";
    const tabs = isIndustry ? TABS_INDUSTRY : TABS_OEM;
    const tabNames = Object.keys(tabs);
    if (!tabNames.includes(state.activeTab)) state.activeTab = tabNames[0];

    $("#tab-bar").innerHTML = tabNames.map(t =>
      `<button class="tab-btn ${t === state.activeTab ? "active" : ""}" data-tab="${t}">${t}</button>`
    ).join("");
    document.querySelectorAll(".tab-btn").forEach(btn =>
      btn.addEventListener("click", () => { state.activeTab = btn.dataset.tab; renderTabs(); })
    );

    const body = $("#tab-body");
    const fyCurrent = state.fy;
    const fyPrior   = prevFY(state.fy);

    if (!isIndustry && state.activeTab === "Governance") {
      const info = getCompanyInfo(fyCurrent, state.company);
      if (!info) {
        body.innerHTML = `<div class="text-sm text-inkMuted">Governance data pending for ${state.company} — ${fyCurrent}</div>`;
        return;
      }
      const fields = [
        ["CEO", info.CEO], ["CFO", info.CFO], ["COO", info.COO],
        ["Credit Rating", info.Credit_Rating],
        ["Employees", fmtNum(info.Employees)],
        ["Dealers",   fmtNum(info.Dealers)],
      ];
      body.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4">
          ${fields.map(([k,v]) => `
            <div>
              <div class="text-[10.5px] uppercase tracking-wider text-inkMuted font-semibold">${k}</div>
              <div class="text-sm text-ink mt-0.5">${v ?? "—"}</div>
            </div>`).join("")}
        </div>
        <div class="text-[10.5px] text-inkMuted mt-5">
          Source: ${(info.Source && info.Source !== "Pending") ? info.Source : "—"} · Last updated ${new Date(info.Last_Updated).toLocaleDateString("en-GB")}
        </div>`;
      return;
    }

    const metrics = tabs[state.activeTab];
    const rows = metrics.map(metric => {
      const r      = isIndustry ? getIndustryMetric(fyCurrent, metric) : getCompanyMetric(fyCurrent, state.company, metric);
      const rPrior = fyPrior ? (isIndustry ? getIndustryMetric(fyPrior, metric) : getCompanyMetric(fyPrior, state.company, metric)) : null;
      const yoy = r ? r.YoY_Change : null;
      const sig = r ? r.Signal : "Neutral";
      const isClickable = !isIndustry && D.TREND_METRICS.has(metric);

      return `
        <tr class="${isClickable ? "clickable" : ""}" ${isClickable ? `data-metric="${metric}"` : ""}>
          <td>${metric}${isClickable ? ' <span class="text-[10px] text-blue ml-1">↗</span>' : ''}</td>
          <td class="num">${formatMetricValue(metric, rPrior ? rPrior.Value : null)}</td>
          <td class="num font-semibold text-navy">${formatMetricValue(metric, r ? r.Value : null)}</td>
          <td class="num ${yoy > 0 ? "delta-up" : yoy < 0 ? "delta-down" : "delta-flat"}">
            ${yoy === null || yoy === undefined ? "—" : fmtDelta(yoy, isPctMetric(metric) ? "pp" : "")}
          </td>
          <td>
            <span class="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full ${signalClass(sig)}">
              ${signalDot(sig)}${sig}
            </span>
          </td>
          <td class="text-[10.5px] text-inkMuted">${(r && r.Source && r.Source !== "Pending") ? r.Source : "—"}</td>
        </tr>`;
    }).join("");

    body.innerHTML = `
      <table class="dd-table">
        <thead>
          <tr><th>Metric</th><th>${fyPrior || "Prev FY"}</th><th>${fyCurrent}</th>
              <th>YoY</th><th>Signal</th><th>Source</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6" class="text-inkMuted">No metrics defined</td></tr>`}</tbody>
      </table>`;
    document.querySelectorAll(".dd-table tr.clickable").forEach(tr => {
      tr.addEventListener("click", () => openTrendModal(tr.dataset.metric));
      attachHoverTip(tr);
    });
  }

  /* ====================================================
     TREND MODAL
     ==================================================== */
  function trendChart(values, labels, options = {}) {
    const benchValues = options.bench || null;
    const w = 720, h = 320, padL = 50, padR = 22, padT = 18, padB = 32;

    const allVals = [...values, ...(benchValues || [])].filter(v => v !== null && v !== undefined);
    if (!allVals.length) return `<div class="text-sm text-inkMuted py-10 text-center">Data pending from agents.</div>`;
    let yMin = Math.min(...allVals, 0), yMax = Math.max(...allVals, 1);
    const span = yMax - yMin || 1;
    yMin -= span * 0.10; yMax += span * 0.18;

    const x = (i) => padL + i * ((w - padL - padR) / Math.max(labels.length - 1, 1));
    const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);

    const grid = [0,0.25,0.5,0.75,1].map(t => {
      const yy = padT + t * (h - padT - padB);
      const val = yMax - t * (yMax - yMin);
      return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#EEF1F5"/>
              <text x="${padL-8}" y="${yy+3}" text-anchor="end" font-size="10.5" fill="#6B7280">${val.toFixed(0)}${options.yUnit||""}</text>`;
    }).join("");

    const points = values.map((v, i) => v === null || v === undefined ? null : [x(i), y(v)]);
    let path = "";
    points.forEach((p, i) => {
      if (!p) return;
      const cmd = path === "" ? "M" : (points[i-1] ? "L" : "M");
      path += `${cmd} ${p[0].toFixed(1)} ${p[1].toFixed(1)} `;
    });

    const firstIdx = points.findIndex(Boolean);
    const lastIdx  = points.length - 1 - points.slice().reverse().findIndex(Boolean);
    const areaPath = firstIdx >= 0
      ? `${path} L ${x(lastIdx).toFixed(1)} ${y(yMin).toFixed(1)} L ${x(firstIdx).toFixed(1)} ${y(yMin).toFixed(1)} Z`
      : "";

    const defs = `
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="#DBEAFE" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#DBEAFE" stop-opacity="0"/>
        </linearGradient>
      </defs>`;

    let benchSvg = "";
    if (benchValues) {
      const bp = benchValues.map((v, i) => v === null || v === undefined ? null : [x(i), y(v)]);
      let bpath = "";
      bp.forEach((p, i) => {
        if (!p) return;
        const cmd = bpath === "" ? "M" : (bp[i-1] ? "L" : "M");
        bpath += `${cmd} ${p[0].toFixed(1)} ${p[1].toFixed(1)} `;
      });
      if (bpath) benchSvg = `<path class="trend-bench" d="${bpath}"/>`;
    }

    let dotsSvg = "";
    points.forEach((p, i) => {
      if (!p) return;
      const isLast = i === lastIdx;
      const prev = i > 0 && points[i-1] ? values[i-1] : null;
      const curr = values[i];
      let dotColor;
      if (isLast) dotColor = "#F59E0B";
      else if (prev === null || prev === undefined) dotColor = COLOR.blue;
      else if (curr > prev) dotColor = COLOR.pos;
      else if (curr < prev) dotColor = COLOR.neg;
      else dotColor = COLOR.blue;

      if (isLast) dotsSvg += `<circle class="trend-halo" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="11"/>`;
      const r = isLast ? 5.5 : 4;
      const cls = isLast ? "trend-dot-current" : "trend-dot";
      dotsSvg += `<circle class="${cls}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r}" fill="${dotColor}"/>`;
    });

    const xAxis = labels.map((l, i) =>
      `<text x="${x(i)}" y="${h-10}" text-anchor="middle" font-size="11" fill="#6B7280">${l}</text>`).join("");

    const colW = (w - padL - padR) / Math.max(labels.length, 1);
    const hover = labels.map((l, i) => `
      <rect class="hover-target" data-i="${i}"
            x="${(padL + i * (w - padL - padR) / Math.max(labels.length-1,1)) - colW/2}"
            y="${padT}" width="${colW}" height="${h - padT - padB}"/>`).join("");

    return `
      <svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
        ${defs}
        <g class="grid">${grid}</g>
        ${areaPath ? `<path d="${areaPath}" fill="url(#trendGrad)"/>` : ""}
        ${benchSvg}
        <path class="trend-line" d="${path}"/>
        ${dotsSvg}
        <g class="axis">${xAxis}</g>
        ${hover}
      </svg>`;
  }

  function bindTrendHover(rootEl, labels, values, metric, benchValues) {
    const tip = $("#trend-tooltip");
    rootEl.querySelectorAll(".hover-target").forEach(el => {
      el.addEventListener("mouseenter", (e) => showTrendTip(e, el, labels, values, metric, benchValues));
      el.addEventListener("mousemove",  (e) => showTrendTip(e, el, labels, values, metric, benchValues));
      el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
    });
  }
  function showTrendTip(e, el, labels, values, metric, benchValues) {
    const tip = $("#trend-tooltip");
    const i = +el.dataset.i;
    const v = values[i];
    const fy = labels[i];
    if (v === null || v === undefined) { tip.classList.add("hidden"); return; }
    const prev = i > 0 ? values[i-1] : null;
    let yoyText = "—";
    if (typeof prev === "number") {
      const diff = v - prev;
      const isPct = isPctMetric(metric);
      yoyText = (diff >= 0 ? "+" : "") + diff.toFixed(1) + (isPct ? "pp YoY" : " YoY");
    }
    $("#trend-tt-fy").textContent = fy;
    $("#trend-tt-val").textContent = formatMetricValue(metric, v);
    $("#trend-tt-yoy").textContent = yoyText;
    if (benchValues && typeof benchValues[i] === "number") {
      $("#trend-tt-yoy").textContent += `  ·  Industry: ${formatMetricValue(metric, benchValues[i])}`;
    }
    tip.classList.remove("hidden");
    tip.style.left = (e.clientX + 14) + "px";
    tip.style.top  = (e.clientY + 14) + "px";
  }

  function openTrendModal(metric) {
    const isIndustry = state.company === "Industry";
    const company = state.company;
    const brand = BRAND[company];
    const history = getMetricHistory(company, metric, 10, state.fy);
    const valued  = history.filter(r => r.Value !== null && r.Value !== undefined && typeof r.Value === "number");

    applyLogoMark($("#modal-logo"), company, "logo-mark-sm");

    $("#modal-title").textContent   = `${metric}  |  ${company}  |  10-Year Trend`;
    $("#modal-context").textContent = `Selected FY ${state.fy} · YoY base ${prevFY(state.fy) || "—"}`;

    if (!valued.length) {
      $("#modal-chart").innerHTML = `<div class="text-sm text-inkMuted py-10 text-center">Data pending from agents.</div>`;
      $("#modal-chart-title").textContent = "";
      $("#modal-chart-sub").textContent   = "";
      $("#modal-chart-legend").innerHTML  = "";
      $("#modal-stats").innerHTML         = "";
      $("#modal-insight").textContent     = "No history available yet for this metric.";
      $("#modal-source").textContent      = "—";
      $("#modal-updated").textContent     = "—";
      openModal();
      return;
    }

    const labels = valued.map(r => r.FY);
    const values = valued.map(r => r.Value);

    let benchValues = null;
    const benchMetric = !isIndustry && (
      metric === "Volume Growth %" ? "PV Volume Growth %"
      : metric === "SUV Revenue %" ? "SUV Share %"
      : metric === "EV Revenue %"  ? "EV Share %"
      : null
    );
    if (benchMetric) {
      const benchHist = getMetricHistory("Industry", benchMetric, 10, state.fy);
      const benchByFY = Object.fromEntries(benchHist.map(r => [r.FY, r.Value]));
      benchValues = labels.map(fy => benchByFY[fy] ?? null);
      if (!benchValues.some(v => v !== null && v !== undefined)) benchValues = null;
    }

    $("#modal-chart-title").textContent = company + (benchValues ? " vs PV industry" : "");
    $("#modal-chart-sub").textContent   = `${labels[0]} – ${labels[labels.length-1]} · ${labels.length} year${labels.length>1?"s":""}` + (valued.length < 10 ? " · limited history available" : "");
    $("#modal-chart").innerHTML = trendChart(values, labels, { bench: benchValues, yUnit: isPctMetric(metric) ? "%" : "" });

    $("#modal-chart-legend").innerHTML = [
      `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-[3px] rounded-sm" style="background:${COLOR.blue}"></span>${company}</span>`,
      benchValues ? `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-0" style="border-top:2px dashed ${COLOR.grey}"></span>PV industry</span>` : "",
      `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-2 h-2 rounded-full" style="background:${COLOR.pos}"></span>YoY up</span>`,
      `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-2 h-2 rounded-full" style="background:${COLOR.neg}"></span>YoY down</span>`,
      `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${COLOR.amber}"></span>Current FY</span>`,
    ].filter(Boolean).join("");

    const high = Math.max(...values);
    const low  = Math.min(...values);
    const cur  = values[values.length - 1];
    const lastRow = history[history.length-1];
    const yoy  = (typeof lastRow.YoY_Change === "number")
      ? lastRow.YoY_Change
      : (values.length >= 2 ? +(values[values.length-1] - values[values.length-2]).toFixed(2) : null);
    const sig  = lastRow.Signal || "Neutral";
    const yoySuffix = isPctMetric(metric) ? "pp" : (metric === "Stock Price (31-Mar)" ? "" : "");
    const yoyClass  = (typeof yoy === "number") ? (yoy > 0 ? "stat-tile-pos" : yoy < 0 ? "stat-tile-neg" : "") : "";

    $("#modal-stats").innerHTML = `
      <div class="stat-tile stat-tile-amber">
        <div class="stat-tile-label">Current (${state.fy})</div>
        <div class="stat-tile-value">${formatMetricValue(metric, cur)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile-label">10y high</div>
        <div class="stat-tile-value">${formatMetricValue(metric, high)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile-label">10y low</div>
        <div class="stat-tile-value">${formatMetricValue(metric, low)}</div>
      </div>
      <div class="stat-tile ${yoyClass}">
        <div class="stat-tile-label">Latest YoY</div>
        <div class="stat-tile-value">${typeof yoy === "number" ? fmtDelta(yoy, yoySuffix) : "—"}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile-label">Signal</div>
        <span class="inline-flex items-center gap-1.5 text-[12px] mt-1.5 px-2.5 py-1 rounded-full ${signalClass(sig)} font-semibold">
          ${signalDot(sig)}${sig}
        </span>
      </div>`;

    $("#modal-insight").textContent = generateInsight(metric, values, labels, valued.length < 10);
    $("#modal-source").textContent  = (lastRow.Source && lastRow.Source !== "Pending") ? lastRow.Source : "—";
    $("#modal-updated").textContent = lastRow.Last_Updated
      ? new Date(lastRow.Last_Updated).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })
      : "—";

    openModal();
    bindTrendHover($("#modal-chart"), labels, values, metric, benchValues);
  }

  function generateInsight(metric, values, labels, limited) {
    const first = values[0], last = values[values.length-1];
    const pctChange = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
    const stable = Math.abs(pctChange) < 8;
    const direction = stable ? "stayed broadly stable" : (last > first ? "improved" : "declined");
    const period = `${labels[0]}–${labels[labels.length-1]}`;
    const limitedNote = limited ? " (limited history available)" : "";

    const flavors = {
      "Market Share %":         d => `Market share has ${d} between ${period}${limitedNote}, reflecting ${d === "improved" ? "share gains, especially in SUV" : d === "declined" ? "competitive pressure" : "a steady competitive position"}.`,
      "Volume Growth %":        d => `Volume growth has ${d} over ${period}${limitedNote}; volatility around the FY21 base reflects COVID-related demand disruption.`,
      "Revenue Growth %":       d => `Revenue growth has ${d} over ${period}${limitedNote}, ${d === "improved" ? "supported by mix and pricing" : d === "declined" ? "with mix and price gains tapering" : "tracking volume closely"}.`,
      "EBITDA Margin %":        d => `EBITDA margin has ${d} over ${period}${limitedNote}, ${d === "improved" ? "indicating better operating leverage and mix improvement" : d === "declined" ? "reflecting cost or pricing headwinds" : "with operating leverage broadly intact"}.`,
      "SUV Revenue %":          d => `SUV revenue mix has ${d} over ${period}${limitedNote}, ${d === "improved" ? "improving the quality of growth" : d === "declined" ? "a sign of mix erosion" : "showing a stable structural mix"}.`,
      "Stock Price (31-Mar)":   d => `Stock has ${d} between ${period}${limitedNote}; year-end values move with earnings momentum and share trajectory.`,
      "Gross Margin %":         d => `Gross margin has ${d} over ${period}${limitedNote}, signalling ${d === "improved" ? "RM tailwinds and richer mix" : d === "declined" ? "input-cost or discount pressure" : "broadly steady unit economics"}.`,
      "EV Revenue %":           d => `EV revenue contribution has ${d} over ${period}${limitedNote}, ${d === "improved" ? "indicating a credible electrification runway" : d === "declined" ? "suggesting an EV reset" : "with EV scale building gradually"}.`,
      "Export Revenue %":       d => `Export contribution has ${d} over ${period}${limitedNote}, ${d === "improved" ? "diversifying the revenue base" : d === "declined" ? "with international demand softer" : "stable as a share of revenue"}.`,
      "Capacity Utilisation %": d => `Capacity utilisation has ${d} over ${period}${limitedNote}, a useful read on demand-pull and operating leverage.`,
      "Working Capital Days":   d => `Working capital days have ${d} over ${period}${limitedNote}, ${last < 0 ? "with negative working capital reflecting strong supplier and dealer terms" : "with the cash conversion cycle a watch item"}.`,
      "Capex (Rs Cr)":          d => `Capex has ${d} over ${period}${limitedNote}, consistent with ${d === "improved" ? "an investment-led growth phase" : d === "declined" ? "a moderating capex cycle" : "a steady investment cadence"}.`,
      "Realisation Growth %":   d => `Realisation growth has ${d} over ${period}${limitedNote}, ${d === "improved" ? "reflecting pricing and mix tailwinds" : d === "declined" ? "with weak pricing power" : "tracking inflation broadly"}.`,
    };
    const fn = flavors[metric];
    return fn ? fn(direction) : `${metric} has ${direction} over ${period}${limitedNote}.`;
  }

  /* ---------- modal open/close ---------- */
  function openModal() {
    const overlay = $("#modal-overlay");
    overlay.classList.remove("hidden");
    requestAnimationFrame(() => overlay.classList.add("open"));
  }
  function closeModal() {
    const overlay = $("#modal-overlay");
    overlay.classList.remove("open");
    setTimeout(() => overlay.classList.add("hidden"), 220);
    $("#trend-tooltip").classList.add("hidden");
  }

  /* ====================================================
     VEHICLE DETAIL MODAL
     ==================================================== */
  function openVMod() {
    const overlay = $("#vmodal-overlay");
    overlay.classList.remove("hidden");
    requestAnimationFrame(() => overlay.classList.add("open"));
  }
  function closeVMod() {
    const overlay = $("#vmodal-overlay");
    overlay.classList.remove("open");
    setTimeout(() => overlay.classList.add("hidden"), 220);
    $("#trend-tooltip").classList.add("hidden");
  }

  /* Tile that renders only when there's a real value. Returns "" for
     null / undefined / empty so the caller can build a tile array
     and join the survivors — no "Pending" tiles in the UI. */
  function statTile(label, value, opts = {}) {
    if (value === null || value === undefined || value === "") return "";
    const cls = opts.cls || "stat-tile";
    return `<div class="${cls}">
      <div class="stat-tile-label">${label}</div>
      <div class="stat-tile-value">${value}</div>
    </div>`;
  }

  /* "10 Jul 2023" / "Jul 2023" / "2023" depending on input precision. */
  function formatVehicleDate(s) {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d)) return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
    }
    if (/^\d{4}-\d{2}$/.test(s)) {
      const [y, m] = s.split("-");
      return new Date(+y, +m - 1, 1).toLocaleDateString("en-GB", { month:"short", year:"numeric" });
    }
    if (/^\d{4}$/.test(s)) return s;
    return s;
  }

  function openVehicleModal(company, vehicleName) {
    const brand = BRAND[company] || {};
    const allRows = D.Vehicle_FY_Metrics
      .filter(r => r.Company === company && r.Vehicle === vehicleName)
      .sort((a, b) => D.FYS_FULL.indexOf(a.FY) - D.FYS_FULL.indexOf(b.FY));

    const current = allRows.find(r => r.FY === state.fy)
                || allRows[allRows.length - 1]
                || null;

    /* Header image — Image_URL with smooth fade-in (is-loaded class
       added on load), and silent collapse on error. */
    const imgEl = $("#vmodal-image");
    if (current && current.Image_URL) {
      imgEl.className = "vmod-image has-image";
      imgEl.innerHTML = "";
      const img = document.createElement("img");
      img.alt = vehicleName;
      img.onload = () => img.classList.add("is-loaded");
      img.onerror = () => {
        imgEl.className = "vmod-image";
        imgEl.innerHTML = "";
      };
      img.src = current.Image_URL;
      imgEl.appendChild(img);
    } else {
      imgEl.className = "vmod-image";
      imgEl.innerHTML = "";
    }

    $("#vmodal-title").textContent   = `${vehicleName} — ${company}`;
    const segLabel = current && current.Segment ? current.Segment : "Segment pending";
    const rankLbl  = current && current.Segment_Rank ? `· #${current.Segment_Rank} in segment` : "";
    $("#vmodal-context").textContent = `${segLabel} ${rankLbl} · Selected FY ${state.fy}`;

    /* Volume trend chart — uses the trendChart renderer */
    const labels = allRows.map(r => r.FY);
    const values = allRows.map(r => (typeof r.Volume === "number" ? r.Volume : null));
    const valued = values.filter(v => typeof v === "number");

    if (!valued.length) {
      $("#vmodal-chart").innerHTML = `<div class="text-sm text-inkMuted py-8 text-center">Volume history pending.</div>`;
      $("#vmodal-chart-sub").textContent = "";
      $("#vmodal-chart-legend").innerHTML = "";
    } else {
      $("#vmodal-chart").innerHTML = trendChart(values, labels, { yUnit: "" });
      $("#vmodal-chart-sub").textContent =
        `${labels[0]} – ${labels[labels.length-1]} · ${labels.length} year${labels.length>1?"s":""}` +
        (valued.length < 3 ? " · limited history" : "");
      $("#vmodal-chart-legend").innerHTML = [
        `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-4 h-[3px] rounded-sm" style="background:${COLOR.blue}"></span>${vehicleName} units</span>`,
        `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-2 h-2 rounded-full" style="background:${COLOR.pos}"></span>YoY up</span>`,
        `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-2 h-2 rounded-full" style="background:${COLOR.neg}"></span>YoY down</span>`,
        `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${COLOR.amber}"></span>Current FY</span>`,
      ].join("");
      bindTrendHover($("#vmodal-chart"), labels, values, "Volume", null);
    }

    /* Stat tiles */
    const yoyClass = current && typeof current.YoY_Growth === "number"
      ? (current.YoY_Growth > 0 ? "stat-tile stat-tile-pos"
        : current.YoY_Growth < 0 ? "stat-tile stat-tile-neg"
        : "stat-tile")
      : "stat-tile";
    const yoyValue = current && typeof current.YoY_Growth === "number"
      ? fmtDelta(current.YoY_Growth, "%") : null;

    /* Pre-compute the data-centric tile values. statTile hides any
       null/empty tile so the user only sees populated fields — no
       repeated "Pending" placeholders. Volume / YoY / Signal still
       render in the card itself, so hiding them in the modal is fine
       when the source row is missing. */
    const launchVal = current ? formatVehicleDate(current.Launch_Date) : null;
    const faceliftVal = (current && current.Facelift_Status)
      ? (current.Facelift_Date
          ? `${current.Facelift_Status} · ${formatVehicleDate(current.Facelift_Date)}`
          : current.Facelift_Status)
      : null;
    const signalPill = (current && current.Signal)
      ? `<span class="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full ${signalClass(current.Signal)} font-semibold">${signalDot(current.Signal)}${current.Signal}</span>`
      : null;

    $("#vmodal-stats").innerHTML = [
      statTile(`Volume (${state.fy})`,
               current && typeof current.Volume === "number" ? fmtNum(current.Volume) : null,
               { cls: "stat-tile stat-tile-amber" }),
      statTile("Latest YoY", yoyValue, { cls: yoyClass }),
      statTile("Segment rank",
               current && current.Segment_Rank ? `#${current.Segment_Rank} ${current.Segment || ""}`.trim() : null),
      statTile("Demand",   current ? current.Demand_Read : null, { cls: "stat-tile stat-tile-blue" }),
      statTile("Launch",   launchVal),
      statTile("Facelift", faceliftVal),
      statTile("Key driver", current ? current.Key_Driver : null),
      statTile("Signal",   signalPill),
    ].filter(Boolean).join("");

    /* Segment peer comparison */
    const segment = current && current.Segment;
    let peerHTML = `<div class="text-xs text-inkMuted py-3 text-center">No peers available for this segment / FY.</div>`;
    if (segment) {
      const peers = D.Vehicle_FY_Metrics
        .filter(r => r.FY === state.fy && r.Segment === segment && typeof r.Volume === "number")
        .sort((a, b) => b.Volume - a.Volume);
      if (peers.length) {
        const rows = peers.map((p, i) => `
          <tr class="${p.Vehicle === vehicleName && p.Company === company ? "is-current" : ""}">
            <td class="num text-inkMuted">#${i + 1}</td>
            <td>${p.Vehicle}</td>
            <td class="text-[11px] text-inkMuted">${p.Company}</td>
            <td class="num">${fmtNum(p.Volume)}</td>
            <td class="num ${typeof p.YoY_Growth === "number" && p.YoY_Growth > 0 ? "delta-up"
                          : typeof p.YoY_Growth === "number" && p.YoY_Growth < 0 ? "delta-down" : "delta-flat"}">
              ${typeof p.YoY_Growth === "number" ? fmtDelta(p.YoY_Growth, "%") : "—"}
            </td>
          </tr>`).join("");
        peerHTML = `
          <table class="vmod-peer-table">
            <thead><tr><th>Rank</th><th>Vehicle</th><th>OEM</th><th>${state.fy} units</th><th>YoY</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      }
    }
    $("#vmodal-peer-fy").textContent = state.fy;
    $("#vmodal-peers").innerHTML = peerHTML;

    /* Insight */
    const insight = current && current.Vehicle_Insight ? current.Vehicle_Insight : null;
    const ie = $("#vmodal-insight");
    if (insight) {
      ie.classList.remove("text-inkMuted");
      ie.style.fontStyle = "";
      ie.textContent = insight;
    } else {
      ie.classList.add("text-inkMuted");
      ie.style.fontStyle = "italic";
      ie.textContent = "Buy-side insight pending — populate Vehicle_Insight from primary sources (OEM investor presentations, annual report MD&A, or sales disclosures).";
    }

    /* Source / updated — render as a real link when Source_URL exists,
       so a click opens the citation page. Plain text otherwise. */
    const srcOk  = current && current.Source && current.Source !== "Pending";
    const srcEl  = $("#vmodal-source");
    if (srcOk && current.Source_URL) {
      srcEl.innerHTML = `<a href="${current.Source_URL}" target="_blank" rel="noopener" class="text-blue hover:underline">${current.Source}</a>`;
    } else {
      srcEl.textContent = srcOk ? current.Source : "—";
    }
    $("#vmodal-updated").textContent = current && current.Last_Updated
      ? new Date(current.Last_Updated).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })
      : "—";

    openVMod();
  }

  /* ---------- KPI hover tooltip ---------- */
  function attachHoverTip(el) {
    const tip = $("#hover-tip");
    el.addEventListener("mouseenter", (e) => { tip.classList.remove("hidden"); positionTip(tip, e); });
    el.addEventListener("mousemove", (e) => positionTip(tip, e));
    el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
  }
  function positionTip(tip, e) {
    tip.style.left = (e.clientX + 12) + "px";
    tip.style.top  = (e.clientY + 14) + "px";
  }

  /* Render the small "Last refreshed" line in the footer.
     Reads D._meta written by scripts/write-meta.mjs in the workflow.
     Shows status colour + per-fetcher tooltip + link to the run. */
  function renderRefreshStatus() {
    const el = $("#refresh-status");
    if (!el || !D || !D._meta) return;
    const m = D._meta;
    const ts = m.last_refresh ? new Date(m.last_refresh) : null;
    if (!ts || isNaN(ts.valueOf())) { el.textContent = ""; return; }

    const mins = Math.max(0, Math.floor((Date.now() - ts.getTime()) / 60000));
    const ago = mins < 1 ? "just now"
              : mins < 60 ? `${mins} min ago`
              : mins < 60 * 24 ? `${Math.floor(mins / 60)}h ago`
              : `${Math.floor(mins / (60 * 24))}d ago`;

    const colour = m.status === "ok"     ? "#2E7D32"
                 : m.status === "partial" ? "#B45309"
                 : m.status === "error"  ? "#C62828"
                 : "#6B7280";
    const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:999px;background:${colour};margin-right:6px;vertical-align:middle"></span>`;

    const fetcherStatus = m.fetchers
      ? Object.entries(m.fetchers).map(([k, v]) => `${k}: ${v}`).join(" · ")
      : "";
    const tip = `Fetcher status — ${fetcherStatus}`;

    const linkPart = m.run_url
      ? ` · <a href="${m.run_url}" target="_blank" rel="noopener" class="hover:underline" style="color:#2563EB">view run</a>`
      : "";
    const errPart = m.status === "error"
      ? ' <span style="color:#C62828">· refresh failed</span>'
      : m.status === "partial"
        ? ' <span style="color:#B45309">· some fetchers errored</span>'
        : "";

    el.innerHTML = `${dot}<span title="${tip}">Data refreshed ${ago}</span>${errPart}${linkPart}`;
  }

  /* ---------- master render ---------- */
  function renderAll() {
    renderTopBar();
    renderIdentityRow();
    renderKpiStrip();
    renderCharts();
    renderVehicleCards();
    renderTabs();
    renderRefreshStatus();
  }

  /* ---------- listeners ---------- */
  function wire() {
    $("#fy-select").addEventListener("change", (e) => {
      state.fy = e.target.value;
      renderAll();
    });
    $("#company-select").addEventListener("change", (e) => {
      state.company = e.target.value;
      const tabs = state.company === "Industry" ? TABS_INDUSTRY : TABS_OEM;
      if (!Object.keys(tabs).includes(state.activeTab)) state.activeTab = Object.keys(tabs)[0];
      renderAll();
    });
    $("#modal-close").addEventListener("click", closeModal);
    $("#modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeModal();
    });
    $("#vmodal-close").addEventListener("click", closeVMod);
    $("#vmodal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "vmodal-overlay") closeVMod();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeModal(); closeVMod(); }
    });
  }

  /* ---------- boot ----------
     Async load via PV_LOADER. The boot loader overlay stays visible
     until data resolves; on failure we show the boot-error card and
     never render — the dashboard with no data would be misleading. */
  async function init() {
    const loader = $("#boot-loader");
    const errEl  = $("#boot-error");
    const errMsg = $("#boot-error-msg");

    if (!window.PV_LOADER) {
      if (loader) loader.classList.add("hidden");
      if (errEl)  errEl.classList.remove("hidden");
      if (errMsg) errMsg.textContent = "Data loader script failed to register.";
      return;
    }

    const result = await window.PV_LOADER.loadAll();
    if (!result.ok) {
      if (loader) loader.classList.add("hidden");
      if (errEl)  errEl.classList.remove("hidden");
      if (errMsg) errMsg.textContent = (result.error && result.error.message) || "Cached configs were not reachable.";
      return;
    }

    D = result.data;
    window.PV_DATA = D;
    BRAND = D.BRANDS;
    TABS_OEM      = D.TABS && D.TABS.oem      ? D.TABS.oem      : {};
    TABS_INDUSTRY = D.TABS && D.TABS.industry ? D.TABS.industry : {};

    wire();
    renderAll();
    if (loader) loader.remove();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
