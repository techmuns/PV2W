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
    company:   "Industry",         // Industry view is the default landing page
    activeTab: "Growth",
    mixView:     "product",  // product | export | powertrain — drives chart2 for OEM view
    productView: "segment",  // segment | suv — sub-toggle when mixView === 'product'
    selectedCategory: "Growth",  // category whose metrics drive the side-panel trend chart
    /* Industry-view shared controls (left trend + right OEM split) */
    indMetric:    "volume",  // see IND_METRICS registry
    indYearRight: "FY25",
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
      <svg viewBox="0 0 96 32" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        <!-- Cockpit-intelligence motif drawn in the dashboard's
             deep-purple token (#6D28D9 / #4F46E5) so it reads
             against the soft lavender panel. -->

        <!-- Filled gauge wedge for body -->
        <path d="M 16 24 A 12 12 0 0 1 30 13 L 28 24 Z"
              fill="#6D28D9" opacity="0.18"/>
        <!-- Faint full arc -->
        <path d="M 16 24 A 12 12 0 0 1 40 24"
              fill="none" stroke="#6D28D9" stroke-width="2.0"
              stroke-linecap="round" opacity="0.45"/>
        <!-- Bright partial sweep — saturated purple, full opacity -->
        <path d="M 16 24 A 12 12 0 0 1 32.8 14.2"
              fill="none" stroke="#4F46E5" stroke-width="2.6"
              stroke-linecap="round"/>
        <!-- Ticks -->
        <line x1="16" y1="24"   x2="14"   y2="24"   stroke="#6D28D9" stroke-width="1.6" opacity="0.75"/>
        <line x1="40" y1="24"   x2="42"   y2="24"   stroke="#6D28D9" stroke-width="1.6" opacity="0.75"/>
        <line x1="28" y1="12"   x2="28"   y2="10"   stroke="#6D28D9" stroke-width="1.6" opacity="0.75"/>
        <!-- Needle + hub -->
        <line x1="28" y1="24" x2="35" y2="14.5"
              stroke="#4F46E5" stroke-width="2.4"
              stroke-linecap="round"/>
        <circle cx="28" cy="24" r="2.6" fill="#4F46E5"/>

        <!-- Analytics trend: dark indigo line with halo'd nodes -->
        <path d="M52 21 L60 17 L68 18.5 L76 12 L84 9"
              fill="none" stroke="#4F46E5" stroke-width="2.2"
              stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="52" cy="21"   r="3.2" fill="#6D28D9" opacity="0.18"/>
        <circle cx="52" cy="21"   r="1.8" fill="#6D28D9" opacity="0.92"/>
        <circle cx="60" cy="17"   r="3.2" fill="#6D28D9" opacity="0.18"/>
        <circle cx="60" cy="17"   r="1.8" fill="#6D28D9" opacity="0.95"/>
        <circle cx="68" cy="18.5" r="3.2" fill="#6D28D9" opacity="0.18"/>
        <circle cx="68" cy="18.5" r="1.8" fill="#6D28D9"/>
        <circle cx="76" cy="12"   r="3.4" fill="#4F46E5" opacity="0.22"/>
        <circle cx="76" cy="12"   r="1.9" fill="#4F46E5"/>
        <circle cx="84" cy="9"    r="3.6" fill="#4F46E5" opacity="0.28"/>
        <circle cx="84" cy="9"    r="2.2" fill="#4F46E5"/>

        <!-- Hairline baseline tying the two halves together -->
        <line x1="14" y1="27" x2="86" y2="27"
              stroke="#6D28D9" stroke-width="1.1" opacity="0.32"/>
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

    /* Preserve any caller-applied modifier classes (e.g.
       .logo-mark-header on the snapshot header tile) — only swap
       between the badge / image variants this function manages. */
    const PRESERVE = new Set(["logo-mark", "logo-mark-sm", "logo-mark-header", "logo-mark-aggregate", "logo-mark-pending"]);
    const keep = Array.from(el.classList).filter(c => PRESERVE.has(c));
    const baseSet = new Set(keep);
    baseSet.add("logo-mark");
    if (sizeClass) sizeClass.split(/\s+/).forEach(c => c && baseSet.add(c));
    el.removeAttribute("style");

    if (!url) {
      baseSet.add("logo-mark-badge");
      el.className = Array.from(baseSet).join(" ");
      el.innerHTML = brandBadge(company);
      return;
    }

    baseSet.add("logo-mark-image");
    el.className = Array.from(baseSet).join(" ");
    el.innerHTML = "";
    const img = document.createElement("img");
    img.alt = `${company} logo`;
    img.onerror = () => {
      baseSet.delete("logo-mark-image");
      baseSet.add("logo-mark-badge");
      el.className = Array.from(baseSet).join(" ");
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
    const isIndustry = state.company === "Industry";

    applyLogoMark($("#logo-mark"), state.company);

    $("#fy-chip").innerHTML = `
      <span class="fy-chip-label">FY</span>
      <span class="fy-chip-value">${state.fy}</span>`;

    /* Two-line text stack: company / "Buy-side snapshot".
       Industry is its own headline. */
    if (isIndustry) {
      $("#view-title").textContent    = "Indian PV Industry Cockpit";
      $("#view-subtitle").textContent = "Demand · mix · competitive shifts across OEMs";
    } else {
      $("#view-title").textContent    = state.company;
      $("#view-subtitle").textContent = "Buy-side snapshot";
    }
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
    if (!grid) return;   /* KPI strip retired in favour of Investor Lens table */
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
            ${stalePending ? '<span class="ml-auto text-[9px] text-warn bg-warnSoft px-1.5 py-0.5 rounded font-medium">Source TBC</span>' : ''}
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
    const w = 480, h = options.height || 220, padL = 26, padR = 12, padT = 14, padB = 28;
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

    /* Per-series gradient defs for the area fill — fades the line
       colour from ~40% at the top to transparent at the baseline,
       which reads more premium than a flat opacity rectangle. */
    let defs = "";
    series.forEach((s, idx) => {
      defs += `<linearGradient id="ln-grad-${idx}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stop-color="${s.color}" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="${s.color}" stop-opacity="0"/>
      </linearGradient>`;
    });

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
          lines += `<path d="${areaPath}" fill="url(#ln-grad-${idx})"/>`;
        }
      }
      lines += `<path class="line-path" d="${path}" stroke="${s.color}"/>`;
      /* Highlight the latest non-null point with a slightly larger
         dot + outer ring, so the eye lands on 'where we are now'. */
      const lastFilledIdx = points.length - 1 - [...points].reverse().findIndex(Boolean);
      points.forEach((p, i) => {
        if (!p) return;
        const isLatest = i === lastFilledIdx;
        if (isLatest) {
          lines += `<circle cx="${p[0]}" cy="${p[1]}" r="6.5" fill="${s.color}" opacity="0.18"/>`;
          lines += `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="4" fill="${s.color}"/>`;
        } else {
          lines += `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3" fill="${s.color}"/>`;
        }
      });
    });

    const xAxis = labels.map((l, i) =>
      `<text x="${x(i)}" y="${h-8}" text-anchor="middle" font-size="10" fill="#6B7280">${l}</text>`).join("");

    /* Hover targets: invisible column rects covering each FY's vertical
       slice. Each rect carries a *multi-line* payload — every series'
       value at that FY — so the tooltip can show all lines together
       instead of just the primary series. */
    const colW = (w - padL - padR) / Math.max(labels.length - 1, 1);
    const hovers = labels.map((l, i) => {
      const segments = series
        .map(s => {
          const v = s.values[i];
          if (v === null || v === undefined) return null;
          /* Carry the prior-FY value so the tooltip can render the
             YoY change next to the absolute. */
          const prev = i > 0 ? s.values[i - 1] : null;
          return {
            label: s.name || "",
            value: v,
            prev: (prev === null || prev === undefined) ? null : prev,
            color: s.color || "#2563EB",
          };
        })
        .filter(Boolean);
      if (!segments.length) return "";
      const payload = JSON.stringify({
        kind: "multi-line",
        fy: l,
        /* Pass the unit used by the helper for axis ticks (yUnit)
           AND the analyst-facing unit phrase from the caller
           (axisLabel takes priority for the tooltip suffix). */
        unit: options.tooltipUnit || options.yUnit || "",
        segments,
      });
      return `<rect class="hover-target" x="${x(i) - colW/2}" y="${padT}" width="${colW}" height="${h - padT - padB}" fill="transparent"
        data-fy="${ATTR(l)}" data-rich="${ATTR(payload)}"/>`;
    }).join("");

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <defs>${defs}</defs>
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
      /* Multi-bar payload — hovering any bar in the column shows
         every series's value for that FY (e.g. PV industry +X.X%
         and selected company +Y.Y%). */
      const segs = series
        .map(s => {
          const v = s.values[i];
          if (v === null || v === undefined) return null;
          return { label: s.name || "", value: v, color: s.color || "#2563EB" };
        })
        .filter(Boolean);
      const groupPayload = JSON.stringify({
        kind: "multi-line",
        fy: label,
        unit: options.yUnit || "",
        segments: segs,
      });
      series.forEach((s, si) => {
        const v = s.values[i];
        if (v === null || v === undefined) return;
        const yy = yScale(v);
        const hh = Math.abs(yy - zeroY);
        const yTop = v >= 0 ? yy : zeroY;
        bars += `<rect class="bar hover-target" x="${startX + si*barW}" y="${yTop}" width="${barW - 2}" height="${hh}" fill="${s.color}" rx="2"
          data-fy="${ATTR(label)}" data-series="${ATTR(s.name)}" data-value="${ATTR(v)}"
          data-unit="${ATTR(options.yUnit||"")}" data-color="${ATTR(s.color)}" data-rich="${ATTR(groupPayload)}"/>`;
      });
      bars += `<text x="${cx}" y="${h-8}" text-anchor="middle" font-size="10" fill="#6B7280">${label}</text>`;
    });
    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
  }

  /* ---------- Pie chart ----------
     Slices ordered by value; an inline % label sits inside each
     slice >5%. Legend renders to the right of the pie with the
     OEM name + share %. */
  /* ---------- Ranked horizontal-of-vertical bar chart ----------
     One bar per item, value label above each bar, name below.
     Used for non-additive OEM comparisons (margins, growth %,
     launch counts) where pie charts are misleading. */
  function rankedBarChart(items, options = {}) {
    const w = 480, h = options.height || 240, padL = 38, padR = 12, padT = 24, padB = 38;
    if (!items.length) return `<div class="text-xs text-inkMuted py-12 text-center">No data available</div>`;
    const vals = items.map(x => (x.value == null ? 0 : x.value));
    let yMax = Math.max(...vals, 0.0001);
    let yMin = Math.min(...vals, 0);
    const pad = (yMax - yMin) * 0.18 || 1;
    if (yMax > 0) yMax += pad;
    if (yMin < 0) yMin -= pad;
    if (yMax === yMin) yMax = yMin + 1;
    const yScale = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);
    const groupW = (w - padL - padR) / items.length;
    const barW = Math.min(groupW * 0.55, 56);
    const zeroY = yScale(0);

    const grid = [0,0.25,0.5,0.75,1].map(t => {
      const yy = padT + t * (h - padT - padB);
      const val = yMax - t * (yMax - yMin);
      return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#EEF1F5"/>
              <text x="${padL-6}" y="${yy+3}" text-anchor="end" font-size="10" fill="#6B7280">${val.toFixed(0)}${options.yUnit||""}</text>`;
    }).join("");

    /* Shared rich payload for every bar — total + per-OEM share so
       the tooltip shows the same composition view regardless of
       which bar is hovered. Only include it when the metric is
       additive (yUnit blank or units) — for non-additive % metrics
       skip the share % so we don't show fake math. */
    const total = items.reduce((s, it) => s + Math.max(it.value || 0, 0), 0);
    const isShareMetric = total > 0 && options.yUnit !== "%";
    const richSegments = items
      .filter(it => it.value != null)
      .map(it => ({
        label: it.name,
        value: it.value,
        pct: isShareMetric ? (it.value / total) * 100 : null,
        color: it.color,
        context: it.context || null,
      }));
    const richPayload = isShareMetric
      ? JSON.stringify({
          kind: "ranked-share",
          fy: options.fy || "",
          total,
          totalLabel: options.totalLabel || `Total ${options.yUnit || ""}`.trim(),
          unit: options.yUnit || "",
          metric: options.metric || "",
          metricBase: options.metricBase || "",
          segments: richSegments,
        })
      : JSON.stringify({
          kind: "ranked-list",
          fy: options.fy || "",
          unit: options.yUnit || "",
          metric: options.metric || "",
          metricBase: options.metricBase || "",
          segments: richSegments,
        });

    let bars = "";
    items.forEach((item, i) => {
      const cx = padL + groupW * (i + 0.5);
      const v = item.value == null ? 0 : item.value;
      const yy = yScale(v);
      const hh = Math.abs(yy - zeroY);
      const yTop = v >= 0 ? yy : zeroY;
      bars += `<rect class="bar hover-target" x="${cx - barW/2}" y="${yTop}" width="${barW}" height="${hh}" fill="${item.color}" rx="3"
        data-fy="${ATTR(options.fy || "")}" data-series="${ATTR(item.name)}" data-value="${ATTR(v)}"
        data-unit="${ATTR(options.yUnit||"")}" data-color="${ATTR(item.color)}" data-rich="${ATTR(richPayload)}"/>`;
      const label = item.value == null ? "—" : (Number.isInteger(v) ? v : v.toFixed(1)) + (options.yUnit || "");
      bars += `<text x="${cx}" y="${(v >= 0 ? yTop - 6 : yTop + hh + 12)}" text-anchor="middle" font-size="11" font-weight="600" fill="#1F2A37">${label}</text>`;
      bars += `<text x="${cx}" y="${h-12}" text-anchor="middle" font-size="10" fill="#475569">${item.name}</text>`;
    });

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
  }

  /* ---------- Industry view: shared-control performance module ----------
     Metric registry. Each entry maps a user-facing label to:
       - the industry_fy_metrics row name (left card 10-yr trend)
       - the company_fy_metrics row name (right card OEM split)
     `additive`: true = pie chart of contribution; false = ranked bar.
     `oemBase: 'share-of-industry'` derives per-OEM volume from
       (Market Share % × industry total). */
  /* Every metric is now `additive: true` so the right-card always
     renders as an industry-mix pie with an Others slice. The pie
     shows each OEM's contribution to the industry-level total of
     that metric (defined per-id below in METRIC_PIE). */
  /* `oem` field carries the per-OEM metric name used by the
     left-card trend fallback when no single industry series
     exists. Without it the left card collapses to the empty
     'series not currently tracked' state. */
  const IND_METRICS = [
    { id: "volume",     label: "PV Volume",            unit: "lakh units",       industry: "Total PV Volume",       oem: null,                    additive: true },
    { id: "growth",     label: "Volume Growth %",      unit: "%",                industry: "PV Volume Growth %",    oem: "Volume Growth %",       additive: true },
    { id: "marketshare",label: "Market Share %",       unit: "%",                industry: null,                    oem: "Market Share %",        additive: true },
    { id: "export",     label: "Export Volume %",      unit: "%",                industry: "Export Share %",        oem: "Export Volume %",       additive: true },
    { id: "ev",         label: "EV Volume %",          unit: "%",                industry: "EV Share %",            oem: "EV Volume %",           additive: true },
    { id: "suv",        label: "SUV Volume %",         unit: "%",                industry: "SUV Share %",           oem: "SUV Volume %",          additive: true },
    { id: "rev_growth", label: "Revenue Growth %",     unit: "%",                industry: null,                    oem: "Revenue Growth %",      additive: true },
    { id: "ebitda",     label: "EBITDA Margin %",      unit: "%",                industry: null,                    oem: "EBITDA Margin %",       additive: true },
    { id: "real_growth",label: "Realisation Growth %", unit: "%",                industry: null,                    oem: "Realisation Growth %",  additive: true },
    { id: "capex",      label: "Capex (Rs Cr)",        unit: "₹ Cr",             industry: null,                    oem: "Capex (Rs Cr)",         additive: true },
    { id: "newlaunches",label: "New Launches",         unit: "count",            industry: null,                    oem: "New Model Launches",    additive: true },
    { id: "facelifts",  label: "Facelifts",            unit: "count",            industry: null,                    oem: "Facelift Launches",     additive: true },
  ];

  /* Per-metric pie-data resolver. Each entry returns:
       contribution(co, fy) → number   (OEM's absolute contribution)
       industryTotal(fy)   → number    (denominator for Others slice)
       unit                → string    (lakh units / ₹ Cr / count / %)
       title / subtitle    → strings   (chart header copy)
     Same shape used everywhere so the right-card pie + tooltip
     stay consistent for all 12 metrics. */
  const fyChange = (co, fy, metric) => {
    const prev = prevFY(fy); if (!prev) return null;
    const cur = getCompanyMetric(fy, co, metric);
    const pre = getCompanyMetric(prev, co, metric);
    return (cur && pre && cur.Value != null && pre.Value != null)
      ? (cur.Value - pre.Value) : null;
  };
  const oemAbsVolume = (co, fy) => {
    const indRow = getIndustryMetric(fy, "Total PV Volume");
    const ms = getCompanyMetric(fy, co, "Market Share %");
    if (!indRow || ms == null || ms.Value == null) return null;
    return indRow.Value * ms.Value / 100;
  };
  const oemRevenueAbs = (co, fy) => {
    const r = getCompanyMetric(fy, co, "Net Sales (Rs Cr)");
    return (r && r.Value != null) ? r.Value : null;
  };
  const METRIC_PIE = {
    volume: {
      chartKind: "pie",
      contribution: (co, fy) => oemAbsVolume(co, fy),
      industryTotal: (fy) => {
        const r = getIndustryMetric(fy, "Total PV Volume");
        return (r && r.Value != null) ? r.Value : null;
      },
      unit: "lakh units", scale: 1/1e5,
      sliceTitle: "Industry volume mix by OEM",
      subtitle: "Each OEM's share of total industry PV volume",
    },
    growth: {
      /* Rate metric → ranked bar, not pie. Each bar is the OEM's
         YoY volume growth %. */
      chartKind: "bar",
      barValue: (co, fy) => {
        const r = getCompanyMetric(fy, co, "Volume Growth %");
        return (r && r.Value != null) ? r.Value : null;
      },
      unit: "%", scale: 1,
      sliceTitle: "Industry volume growth by OEM",
      subtitle: "Year-on-year volume growth per OEM vs prior FY",
    },
    marketshare: {
      chartKind: "pie",
      contribution: (co, fy) => {
        const r = getCompanyMetric(fy, co, "Market Share %");
        return (r && r.Value != null) ? r.Value : null;
      },
      industryTotal: () => 100,
      unit: "%", scale: 1,
      sliceTitle: "Industry market share by OEM",
      subtitle: "Each OEM's share of total industry PV volume",
    },
    export: {
      chartKind: "pie",
      contribution: (co, fy) => {
        const tot = getCompanyMetric(fy, co, "Total Sales Volume");
        const exp = getCompanyMetric(fy, co, "Export Volume %");
        return (tot && tot.Value != null && exp && exp.Value != null)
          ? (tot.Value * exp.Value / 100) : null;
      },
      industryTotal: (fy) => {
        const ind = getIndustryMetric(fy, "Total PV Volume");
        const expShare = getIndustryMetric(fy, "Export Share %");
        return (ind && expShare && ind.Value != null && expShare.Value != null)
          ? (ind.Value * expShare.Value / 100) : null;
      },
      unit: "lakh units", scale: 1/1e5,
      sliceTitle: "Industry export mix by OEM",
      subtitle: "Each OEM's share of total industry PV exports",
    },
    ev: {
      chartKind: "pie",
      contribution: (co, fy) => {
        const tot = getCompanyMetric(fy, co, "Total Sales Volume");
        const evP = getCompanyMetric(fy, co, "EV Volume %");
        return (tot && tot.Value != null && evP && evP.Value != null)
          ? (tot.Value * evP.Value / 100) : null;
      },
      industryTotal: (fy) => {
        const ind = getIndustryMetric(fy, "Total PV Volume");
        const evShare = getIndustryMetric(fy, "EV Share %");
        return (ind && evShare && ind.Value != null && evShare.Value != null)
          ? (ind.Value * evShare.Value / 100) : null;
      },
      unit: "lakh units", scale: 1/1e5,
      sliceTitle: "Industry EV mix by OEM",
      subtitle: "Each OEM's share of total industry BEV volume",
    },
    suv: {
      chartKind: "pie",
      contribution: (co, fy) => {
        const tot = getCompanyMetric(fy, co, "Total Sales Volume");
        const suvP = getCompanyMetric(fy, co, "SUV Volume %");
        return (tot && tot.Value != null && suvP && suvP.Value != null)
          ? (tot.Value * suvP.Value / 100) : null;
      },
      industryTotal: (fy) => {
        const ind = getIndustryMetric(fy, "Total PV Volume");
        const suvShare = getIndustryMetric(fy, "SUV Share %");
        return (ind && suvShare && ind.Value != null && suvShare.Value != null)
          ? (ind.Value * suvShare.Value / 100) : null;
      },
      unit: "lakh units", scale: 1/1e5,
      sliceTitle: "Industry SUV mix by OEM",
      subtitle: "Each OEM's share of total industry SUV / UV volume",
    },
    rev_growth: {
      /* Rate metric → bar. */
      chartKind: "bar",
      barValue: (co, fy) => {
        const r = getCompanyMetric(fy, co, "Revenue Growth %");
        return (r && r.Value != null) ? r.Value : null;
      },
      unit: "%", scale: 1,
      sliceTitle: "Industry revenue growth by OEM",
      subtitle: "Year-on-year revenue growth per OEM vs prior FY",
    },
    ebitda: {
      /* Rate metric → bar. */
      chartKind: "bar",
      barValue: (co, fy) => {
        const r = getCompanyMetric(fy, co, "EBITDA Margin %");
        return (r && r.Value != null) ? r.Value : null;
      },
      unit: "%", scale: 1,
      sliceTitle: "Industry EBITDA margin by OEM",
      subtitle: "EBITDA as % of revenue per OEM",
    },
    real_growth: {
      /* Rate metric → bar. */
      chartKind: "bar",
      barValue: (co, fy) => {
        const r = getCompanyMetric(fy, co, "Realisation Growth %");
        return (r && r.Value != null) ? r.Value : null;
      },
      unit: "%", scale: 1,
      sliceTitle: "Industry realisation growth by OEM",
      subtitle: "Year-on-year change in per-unit revenue per OEM",
    },
    capex: {
      chartKind: "pie",
      contribution: (co, fy) => {
        const r = getCompanyMetric(fy, co, "Capex (Rs Cr)");
        return (r && r.Value != null) ? r.Value : null;
      },
      industryTotal: () => null,
      unit: "₹ Cr", scale: 1,
      sliceTitle: "Industry capex mix by OEM",
      subtitle: "Each OEM's share of tracked-OEM total annual capex",
    },
    newlaunches: {
      chartKind: "pie",
      contribution: (co, fy) => {
        const r = getCompanyMetric(fy, co, "New Model Launches");
        return (r && r.Value != null) ? r.Value : null;
      },
      industryTotal: () => null,
      unit: "count", scale: 1,
      sliceTitle: "Industry new launches mix by OEM",
      subtitle: "Each OEM's share of tracked-OEM total new model launches",
    },
    facelifts: {
      chartKind: "pie",
      contribution: (co, fy) => {
        const r = getCompanyMetric(fy, co, "Facelift Launches");
        return (r && r.Value != null) ? r.Value : null;
      },
      industryTotal: () => null,
      unit: "count", scale: 1,
      sliceTitle: "Industry facelifts mix by OEM",
      subtitle: "Each OEM's share of tracked-OEM total facelifts",
    },
  };
  /* Backfill chartKind for the two pie entries that pre-date the
     flag so we never hit an undefined branch downstream. */
  if (METRIC_PIE.newlaunches) METRIC_PIE.newlaunches.chartKind = "pie";

  /* Per-metric meaning / base / phrasing — drives chart titles,
     subtitles, context strip, and tooltip rows so the user can
     immediately see "% of what?" without guessing. Keys match
     IND_METRICS[].id. */
  const METRIC_DEF = {
    volume: {
      kind: "absolute", titleNoun: "PV volume",
      subtitle: "Total domestic PV sales volume per OEM",
      sliceTitle: "PV volume · OEM mix", growthTitle: null,
    },
    growth: {
      kind: "yoy",      titleNoun: "Volume growth",
      subtitle: "YoY growth in each OEM's domestic PV sales volume vs the previous FY",
      growthTitle: "Volume Growth % · OEM YoY comparison",
      base: "Current FY volume vs previous FY volume",
      benchmarkMetric: "PV Volume Growth %",
      sourceMetric: "Total Sales Volume",
    },
    marketshare: {
      kind: "share",    titleNoun: "Market share",
      subtitle: "Each OEM's domestic PV volume as % of total industry domestic PV volume",
      sliceTitle: "Market Share % · industry mix",
      base: "Company domestic PV volume / total industry domestic PV volume",
    },
    export: {
      kind: "ratio",    titleNoun: "Export share",
      subtitle: "Exports as % of each OEM's total dispatches (vs industry exports as % of PV production)",
      growthTitle: "Export Volume % · OEM comparison",
      base: "Exports / total dispatches",
      benchmarkMetric: "Export Share %",
    },
    ev: {
      kind: "ratio",    titleNoun: "EV share",
      subtitle: "BEV volume as % of each OEM's total domestic PV volume (vs industry BEV / total PV)",
      growthTitle: "EV Volume % · OEM comparison",
      base: "BEV volume / total domestic PV volume",
      benchmarkMetric: "EV Share %",
    },
    suv: {
      kind: "ratio",    titleNoun: "SUV share",
      subtitle: "SUV / UV volume as % of each OEM's total domestic PV volume (vs industry SUV / total PV)",
      growthTitle: "SUV Volume % · OEM comparison",
      base: "SUV / UV volume / total domestic PV volume",
      benchmarkMetric: "SUV Share %",
    },
    rev_growth: {
      kind: "yoy",      titleNoun: "Revenue growth",
      subtitle: "YoY growth in each OEM's net revenue from operations",
      growthTitle: "Revenue Growth % · OEM YoY comparison",
      base: "Current FY revenue vs previous FY revenue",
    },
    ebitda: {
      kind: "margin",   titleNoun: "EBITDA margin",
      subtitle: "EBITDA as % of each OEM's revenue",
      growthTitle: "EBITDA Margin % · OEM comparison",
      base: "EBITDA / Revenue",
    },
    real_growth: {
      kind: "yoy",      titleNoun: "Realisation growth",
      subtitle: "YoY growth in net realisation per unit (revenue / volume)",
      growthTitle: "Realisation Growth % · OEM YoY comparison",
      base: "(1 + Revenue Growth) / (1 + Volume Growth) − 1",
    },
    capex: {
      kind: "absolute", titleNoun: "Capex",
      subtitle: "Annual capex from each OEM's cash flow statement, in ₹ crore",
      growthTitle: "Capex · OEM comparison",
    },
    newlaunches: {
      kind: "count",    titleNoun: "New model launches",
      subtitle: "Count of new models launched in the FY per OEM",
      growthTitle: "New Launches · OEM comparison",
    },
    facelifts: {
      kind: "count",    titleNoun: "Facelifts",
      subtitle: "Count of model facelifts / refreshes in the FY per OEM",
      growthTitle: "Facelifts · OEM comparison",
    },
  };

  const fmtUnits = {
    "lakh units": (v) => `${(v / 1e5).toFixed(2)} lakh units`,
    "%":          (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
    "₹ Cr":       (v) => `₹${Math.round(v).toLocaleString("en-IN")} Cr`,
    "count":      (v) => `${Math.round(v)}`,
  };
  /* Coordinated buy-side palette — restrained tones, sufficient
     contrast against white and the soft-purple page background.
     Maruti deep navy, Hyundai indigo-blue, M&M warm amber,
     Tata teal, Others slate-grey. */
  const OEM_COLOR = {
    "Maruti":         "#1E3A5F",
    "Hyundai":        "#5B7CFA",
    "M&M":            "#E9A23B",
    "Tata Motors PV": "#4FB7A8",
    "Others":         "#CBD5E1",
  };

  /* Populate (once) the metric + year selects in #industry-controls
     and wire them to state. Called every Industry render — the
     `wired` flag guards against re-binding listeners. */
  function ensureIndustryControls() {
    const mSel = $("#ind-metric-select");
    const ySel = $("#ind-year-select");
    if (!mSel || !ySel) return;

    if (!mSel.dataset.wired) {
      mSel.innerHTML = IND_METRICS.map(m =>
        `<option value="${m.id}">${m.label}</option>`
      ).join("");
      mSel.addEventListener("change", () => {
        state.indMetric = mSel.value;
        renderIndustryPerformance();
      });
      mSel.dataset.wired = "1";
    }
    if (!ySel.dataset.wired) {
      ySel.innerHTML = D.FYS_FULL.slice().reverse().map(fy =>
        `<option value="${fy}">${fy}</option>`
      ).join("");
      ySel.addEventListener("change", () => {
        state.indYearRight = ySel.value;
        renderIndustryPerformance();
      });
      ySel.dataset.wired = "1";
    }
    /* Sync select values to state (handles FY/company switches that
       reset values out of band). */
    mSel.value = state.indMetric;
    ySel.value = state.indYearRight;
  }

  /* Render the Industry view's two-card module driven by
     state.indMetric + state.indYearRight. Called from renderCharts(). */
  function renderIndustryPerformance() {
    const def = IND_METRICS.find(m => m.id === state.indMetric) || IND_METRICS[0];
    const fyTrend = D.FYS_FULL;
    const fy = state.indYearRight;

    /* Common chart-2 grooming */
    $("#chart2-toggle").classList.add("hidden");
    $("#chart2-product-sub").style.visibility = "hidden";
    const chart2 = $("#chart2");
    chart2.removeAttribute("style");
    /* Soft swap: tag both chart-panel sections with is-swapping
       so the title, subtitle, meta strip, chart, legend and
       source line all fade together. Layout stays put because
       the panel + canvas heights are CSS-locked. */
    const chart1El = $("#chart1");
    const panels = document.querySelectorAll('.chart-panel');
    panels.forEach(p => p.classList.add("is-swapping"));
    [chart1El, chart2].forEach(el => el && el.classList.add("is-swapping"));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panels.forEach(p => p.classList.remove("is-swapping"));
        [chart1El, chart2].forEach(el => el && el.classList.remove("is-swapping"));
      });
    });

    /* ── Left card: 10-yr trend ── */
    if (def.industry) {
      /* Scale: volume metric stores raw units (e.g. 4,300,000) but
         the trend chart axis labels in lakh units. Compute scale
         from the metric's unit string so we don't need a per-metric
         flag. */
      const trendScale = (def.unit === "lakh units") ? 1/1e5 : 1;
      const series = fyTrend.map(fyx => {
        const r = getIndustryMetric(fyx, def.industry);
        const v = r && r.Value != null && typeof r.Value === "number" ? r.Value : null;
        return v == null ? null : +(v * trendScale).toFixed(2);
      });
      $("#chart1-title").textContent  = `${def.label} · industry trend`;
      $("#chart1-help").textContent   = "10-year history (SIAM domestic PV)";
      $("#chart1-sub").textContent    = def.unit;
      $("#chart1").innerHTML = lineChart([
        { name: def.label, color: COLOR.navy, values: series },
      ], { xLabels: fyTrend, yUnit: def.unit === "%" ? "%" : "",
           tooltipUnit: def.unit, area: true });
      $("#chart1-legend").innerHTML  = legendChip(COLOR.navy, def.label);
      $("#chart1-source").textContent = "Source: SIAM yearbook / monthly press releases.";
    } else if (def.oem) {
      /* No single industry-level series for this metric (e.g. Market
         Share %, EBITDA Margin %) — render every tracked OEM as its
         own line so the trend card still shows a structurally-useful
         picture of how OEM positions have moved over time. */
      const oemList = ["Maruti", "Hyundai", "M&M", "Tata Motors PV"];
      const series = oemList.map(co => ({
        name: co,
        color: OEM_COLOR[co],
        values: fyTrend.map(fyx => {
          const r = getCompanyMetric(fyx, co, def.oem);
          return r && r.Value != null && typeof r.Value === "number" ? r.Value : null;
        }),
      })).filter(s => s.values.some(v => v != null));

      $("#chart1-title").textContent  = `${def.label} · industry trend`;
      $("#chart1-help").textContent   = "Per-OEM 10-year history";
      $("#chart1-sub").textContent    = def.unit;
      if (!series.length) {
        $("#chart1").innerHTML = `<div class="text-xs text-inkMuted py-12 text-center">No OEM history available for this metric yet.</div>`;
        $("#chart1-legend").innerHTML  = "";
        $("#chart1-source").textContent = "";
      } else {
        $("#chart1").innerHTML = lineChart(series, { xLabels: fyTrend, yUnit: def.unit === "%" ? "%" : "", tooltipUnit: def.unit });
        $("#chart1-legend").innerHTML  = series.map(s => legendChip(s.color, s.name)).join("");
        $("#chart1-source").textContent = `Source: company filings (annual reports + Q4 investor presentations); ${def.label} per OEM across FY16-${fyTrend[fyTrend.length-1]}.`;
      }
    } else {
      $("#chart1-title").textContent  = `${def.label} · industry trend`;
      $("#chart1-help").textContent   = "Industry-level series not currently tracked";
      $("#chart1-sub").textContent    = "";
      $("#chart1").innerHTML = `<div class="text-xs text-inkMuted py-12 text-center">Industry-level series not available for this metric. The right-hand card still shows the OEM-by-OEM split for ${fy}.</div>`;
      $("#chart1-legend").innerHTML  = "";
      $("#chart1-source").textContent = "";
    }

    /* ── Right card: industry-mix pie for the selected metric ──
       Unified path. Every metric routes through METRIC_PIE which
       returns each OEM's absolute contribution + the industry
       total. Slices use absolute values; the donut therefore
       always sums to the industry total and adds an 'Others'
       slice when the industry total exceeds the sum of tracked
       OEMs. */
    const oems = ["Maruti", "Hyundai", "M&M", "Tata Motors PV"];
    let items = [];
    const piedef = METRIC_PIE[def.id] || null;
    const chartKind = (piedef && piedef.chartKind) || "pie";
    let industryAbs = null;

    if (piedef && chartKind === "pie") {
      let trackedSum = 0;
      oems.forEach(co => {
        const v = piedef.contribution(co, fy);
        if (v == null || !Number.isFinite(v)) return;
        const item = { name: co, value: v, color: OEM_COLOR[co] };
        items.push(item);
        if (v > 0) trackedSum += v;
      });
      industryAbs = piedef.industryTotal(fy);
      /* Always add 'Others' when industry total > tracked sum
         (clamp negative residuals to 0). When no industry total is
         known, fall back to tracked sum so the pie still totals
         100% across tracked OEMs (Capex / EBITDA / Launches paths). */
      if (industryAbs != null && Number.isFinite(industryAbs) && industryAbs > trackedSum) {
        items.push({
          name: "Others",
          value: +Math.max(0, industryAbs - trackedSum).toFixed(2),
          color: OEM_COLOR.Others,
        });
      } else if (industryAbs == null) {
        industryAbs = trackedSum;
      }
    } else if (piedef && chartKind === "bar") {
      /* Rate-metric path: ranked bar of each OEM's %. */
      oems.forEach(co => {
        const v = piedef.barValue(co, fy);
        if (v == null || !Number.isFinite(v)) return;
        items.push({ name: co, value: v, color: OEM_COLOR[co] });
      });
    }

    /* Title / subtitle now describe what the % means and what the
       base/denominator is. 'Split' wording reserved for true
       composition charts (additive). For YoY / margin / ratio
       metrics use 'comparison' instead. */
    const mDef = METRIC_DEF[def.id] || {};
    /* All metrics now render as industry-mix pies; titles/subtitles
       come from METRIC_PIE primarily (consistent 'industry mix' /
       'OEM contribution' wording), with METRIC_DEF as fallback. */
    let title = (piedef && piedef.sliceTitle) || mDef.sliceTitle
      || `${def.label} · industry mix (${fy})`;
    if (!title.includes(`(${fy})`)) title += ` (${fy})`;
    $("#chart2-title").textContent = title;
    $("#chart2-help").textContent  = (piedef && piedef.subtitle) || mDef.subtitle
      || "Share of industry";
    /* Hide the redundant 'FY · unit' line — that information now
       lives in the fixed 4-slot meta strip below. */
    $("#chart2-sub").textContent   = "";
    $("#chart2-sub").classList.add("hidden");

    /* Fixed 4-slot meta strip — same order every metric:
         FY · UNIT · INDUSTRY TOTAL · YOY VS PRIOR FY
       Missing slots show '—' to preserve alignment. */
    const prevFyLabel = prevFY(fy);
    const unitTxt = (piedef && piedef.unit) || def.unit || "—";
    let industryTotalTxt = "—";
    const indVolRow = getIndustryMetric(fy, "Total PV Volume");
    if (chartKind === "pie" && industryAbs != null && Number.isFinite(industryAbs)) {
      /* Show industry total in the metric's own unit. */
      const scale = (piedef && piedef.scale) || 1;
      const scaled = industryAbs * scale;
      if (piedef && piedef.unit === "lakh units") industryTotalTxt = `${scaled.toFixed(1)} lakh units`;
      else if (piedef && piedef.unit === "₹ Cr")    industryTotalTxt = `₹${Math.round(scaled).toLocaleString("en-IN")} Cr`;
      else if (piedef && piedef.unit === "count")   industryTotalTxt = `${Math.round(scaled)}`;
      else if (piedef && piedef.unit === "%")       industryTotalTxt = "100.0%";
      else                                          industryTotalTxt = `${scaled.toFixed(1)}`;
    } else if (chartKind === "bar") {
      /* Bar metrics show an industry-level RATE in the same slot,
         relabelled as INDUSTRY (rate) so it doesn't read as a
         total. E.g. Volume Growth shows industry's PV Volume
         Growth %. Margin / Revenue Growth / Realisation Growth
         have no industry-level rate published → '—'. */
      if (def.id === "growth") {
        const indGrowth = getIndustryMetric(fy, "PV Volume Growth %");
        if (indGrowth && indGrowth.Value != null) {
          industryTotalTxt = `${indGrowth.Value > 0 ? "+" : ""}${indGrowth.Value.toFixed(1)}%`;
        }
      }
    }
    let yoyTxt = "—";
    let yoyLabel = prevFyLabel ? `YoY vs ${prevFyLabel}` : "YoY";
    if (prevFyLabel) {
      if (mDef.benchmarkMetric) {
        const indBench = getIndustryMetric(fy, mDef.benchmarkMetric);
        if (indBench && indBench.Value != null) {
          const sign = indBench.Value > 0 ? "+" : "";
          yoyTxt = `${sign}${indBench.Value.toFixed(1)}%`;
        }
      } else if (def.id === "growth" || def.id === "volume") {
        const cur = getIndustryMetric(fy, "Total PV Volume");
        const pre = getIndustryMetric(prevFyLabel, "Total PV Volume");
        if (cur && pre && cur.Value != null && pre.Value != null && pre.Value !== 0) {
          const yoy = ((cur.Value / pre.Value) - 1) * 100;
          yoyTxt = `${yoy > 0 ? "+" : ""}${yoy.toFixed(1)}%`;
        }
      }
    }
    /* Three-slot strip — FY (just the year, no eyebrow label),
       INDUSTRY TOTAL (folds the unit in), YOY VS prior FY. The
       'FY' slot uses an empty key so only the value renders. */
    const industryLabel = chartKind === "bar" ? "Industry" : "Industry total";
    const metaPairs = [
      ["", fy],
      [industryLabel, industryTotalTxt],
      [yoyLabel, yoyTxt],
    ];

    let ctxEl = document.getElementById("chart2-context");
    if (!ctxEl) {
      ctxEl = document.createElement("div");
      ctxEl.id = "chart2-context";
      ctxEl.style.cssText = "display:flex;gap:20px;flex-wrap:wrap;font-size:11px;color:#475569;margin:6px 0 10px;line-height:1.45";
      const subEl = $("#chart2-sub");
      if (subEl && subEl.parentElement) subEl.parentElement.appendChild(ctxEl);
    }
    ctxEl.innerHTML = metaPairs.map(([k, v]) => {
      const eyebrow = k
        ? `<span style="color:#94A3B8;text-transform:uppercase;font-size:9.5px;letter-spacing:0.04em;font-weight:600">${k}</span>`
        : "";
      return `<span style="display:inline-flex;align-items:baseline;gap:6px">
        ${eyebrow}
        <span style="color:${v === "—" ? "#94A3B8" : "#1F2A37"};font-weight:600">${v}</span>
      </span>`;
    }).join("");

    /* Dispatch on chartKind — pie for mix/share metrics, ranked
       bar for rate/ratio metrics (growth %, margin %). */
    if (chartKind === "bar") {
      const ranked = items.slice().sort((a, b) => (b.value || 0) - (a.value || 0));
      if (!ranked.length) {
        chart2.innerHTML = `<div class="text-xs text-inkMuted py-12 text-center">No OEM data for this metric in ${fy}.</div>`;
        $("#chart2-legend").innerHTML = "";
      } else {
        chart2.innerHTML = rankedBarChart(ranked, {
          yUnit: "%", fy,
          metric: piedef.sliceTitle.split(" by ")[0] || def.label,
          metricBase: piedef.subtitle || "",
        });
        $("#chart2-legend").innerHTML = ranked
          .map(r => legendChip(r.color, r.name)).join("");
      }
    } else {
      /* Pie path. Sort tracked OEMs by value desc; pin Others last. */
      const others = items.find(s => s.name === "Others");
      const slices = items.filter(s => s.name !== "Others" && s.value > 0)
                          .sort((a, b) => b.value - a.value);
      if (others && others.value > 0) slices.push(others);

      if (!slices.length) {
        chart2.innerHTML = `<div class="text-xs text-inkMuted py-12 text-center">No OEM data for this metric in ${fy}.</div>`;
        $("#chart2-legend").innerHTML = "";
      } else {
        const unit = (piedef && piedef.unit) || def.unit;
        chart2.innerHTML = pieChart(slices, {
          fy,
          totalLabel: `Total ${def.label.toLowerCase()} · ${fy}`,
          unit,
          shareMode: true,
          industryAbsolute: industryAbs,
          industryUnit: unit,
          industryScale: (piedef && piedef.scale) || 1,
        });
        $("#chart2-legend").innerHTML = "";
      }
    }
    /* Source line — credit SIAM for industry totals + company filings
       for the OEM-level numbers (market share for additive splits,
       audited per-OEM values for non-additive metrics). */
    if (def.additive && def.industry) {
      $("#chart2-source").textContent = `Source: SIAM domestic PV ${def.industry.toLowerCase()} for ${fy}, sliced by audited OEM market shares (company annual reports + investor presentations); the residual is captured under "Others".`;
    } else if (def.oem) {
      $("#chart2-source").textContent = `Source: ${def.label} per OEM, ${fy} — company annual reports + quarterly investor presentations; SIAM where industry-derived.`;
    } else {
      $("#chart2-source").textContent = "";
    }

    /* Re-bind hover tooltips after every Industry-view re-render
       (the metric / year dropdowns trigger this without going
       through renderCharts, so we need to wire chart1 + chart2's
       new hover-targets here too). */
    bindChartHovers($("#chart1"));
    bindChartHovers($("#chart2"));
  }

  function pieChart(slices, options = {}) {
    if (!slices.length) return `<div class="text-xs text-inkMuted py-12 text-center">No data</div>`;
    const w = 480, h = 240;
    const cx = 130, cy = 120, r = 92;
    const total = slices.reduce((s, x) => s + (x.value || 0), 0);
    if (total <= 0) return `<div class="text-xs text-inkMuted py-12 text-center">No share data</div>`;

    /* Build a single rich payload listing every slice + total so the
       tooltip shows the same composition view regardless of which
       slice is hovered. */
    const richPayload = JSON.stringify({
      kind: "pie-share",
      fy: options.fy || "",
      total,
      totalLabel: options.totalLabel || "Total",
      unit: options.unit || "",
      segments: slices.map(s => ({
        label: s.name, value: s.value || 0,
        pct: ((s.value || 0) / total) * 100,
        /* For Market Share %-style donuts, the value IS already the
           share — carry the absolute volume separately so the tooltip
           can show 'XX lakh units · 41.4%' without a redundant
           parenthetical. */
        volumeLakh: s.volumeLakh != null ? s.volumeLakh : null,
        color: s.color,
      })),
      /* Flag: when set the tooltip shows absolute + actual share
         (no within-visible re-normalisation parenthesis). */
      shareMode: !!options.shareMode,
      industryAbsolute: options.industryAbsolute ?? null,
      industryUnit:     options.industryUnit ?? options.unit ?? "",
      industryScale:    options.industryScale ?? 1,
    });

    let angle = -Math.PI / 2;          // start at 12 o'clock
    let body = "";
    const positioned = [];
    slices.forEach(s => {
      const v = s.value || 0;
      const sweep = (v / total) * Math.PI * 2;
      const start = angle;
      const end   = angle + sweep;
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const largeArc = sweep > Math.PI ? 1 : 0;
      const path = sweep >= Math.PI * 2 - 0.0001
        ? `M ${cx} ${(cy - r).toFixed(2)} A ${r} ${r} 0 1 1 ${cx} ${(cy + r).toFixed(2)} A ${r} ${r} 0 1 1 ${cx} ${(cy - r).toFixed(2)} Z`
        : `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      const mid = (start + end) / 2;
      const labelR = r * 0.62;
      const lx = cx + labelR * Math.cos(mid);
      const ly = cy + labelR * Math.sin(mid);
      const pct = (v / total) * 100;
      body += `<path class="bar hover-target" d="${path}" fill="${s.color}" stroke="#FFFFFF" stroke-width="2"
        data-fy="${ATTR(options.fy || "")}" data-series="${ATTR(s.name)}" data-value="${ATTR(v)}"
        data-unit="%" data-color="${ATTR(s.color)}" data-rich="${ATTR(richPayload)}"/>`;
      /* In-slice percent labels removed — the hover tooltip already
         shows volume + share for every slice, and the side legend
         carries the share %. Cleaner visual without two readouts of
         the same number. */
      positioned.push({ name: s.name, color: s.color, pct });
      angle = end;
    });

    /* Legend rail to the right of the pie. */
    const lx = 250, ly0 = 36, lh = 26;
    let legend = "";
    positioned.forEach((p, i) => {
      const yy = ly0 + i * lh;
      legend += `
        <rect x="${lx}" y="${yy - 9}" width="12" height="12" fill="${p.color}" rx="2"/>
        <text x="${lx + 20}" y="${yy + 1.5}" font-size="12" fill="#1F2A37">${p.name}</text>
        <text x="${w - 14}" y="${yy + 1.5}" text-anchor="end" font-size="12" fill="#1F2A37" font-weight="600" font-variant-numeric="tabular-nums">${p.pct.toFixed(1)}%</text>`;
    });

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      ${body}${legend}
    </svg>`;
  }

  /* ---------- Volume + Mix-split bar chart ----------
     One bar per FY whose total height encodes the FY's total sales
     volume; the bar is split into mutually exclusive segments
     (e.g. Domestic vs Export) by the caller. Rich tooltip on hover
     shows total + every segment with units and percentage. */
  function volumeMixBarChart(bars, options = {}) {
    /* bars: [{ fy, total, segments: [{label, value, pct, color}] }]
       options: { yUnit, yLabel, fmtTotal, basisNote, unavailableMsg } */
    const w = 480, h = 240, padL = 56, padR = 16, padT = 16, padB = 32;
    if (!bars.length || bars.every(b => b.total == null)) {
      return `<div class="flex items-center justify-center text-xs text-inkMuted py-12">${options.unavailableMsg || "Data not available for selected mix"}</div>`;
    }
    const groupW = (w - padL - padR) / bars.length;
    const barW = Math.min(groupW * 0.5, 64);
    const yMaxRaw = Math.max(...bars.map(b => b.total || 0), 1);
    const yMax = yMaxRaw * 1.15;
    const yScale = (v) => padT + (1 - v / yMax) * (h - padT - padB);
    const fmtVal = options.fmtTotal || (v => v.toFixed(2));
    const MIN_SEG_PX = 4;

    const grid = [0,0.25,0.5,0.75,1].map(t => {
      const yy = padT + t * (h - padT - padB);
      const val = yMax * (1 - t);
      return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#E7EDF4"/>
              <text x="${padL-6}" y="${yy+3}" text-anchor="end" font-size="10" fill="#6B7280">${fmtVal(val)}</text>`;
    }).join("");

    let bodies = "";
    bars.forEach((b, i) => {
      const cx = padL + groupW * (i + 0.5);
      bodies += `<text x="${cx}" y="${h-10}" text-anchor="middle" font-size="11" fill="#94A3B8" font-weight="500">${b.fy}</text>`;
      if (b.total == null) {
        bodies += `<text x="${cx}" y="${(h-padB+padT)/2}" text-anchor="middle" font-size="10" fill="#94A3B8">no data</text>`;
        return;
      }
      bodies += `<text x="${cx}" y="${yScale(b.total) - 6}" text-anchor="middle" font-size="11" fill="#1F2A37" font-weight="600" class="tabular-nums">${fmtVal(b.total)}</text>`;
      const tipPayload = JSON.stringify({
        fy: b.fy, total: b.total, totalLabel: options.totalLabel || "Total sales volume",
        unit: options.yUnit || "", basis: b.basisNote || options.basisNote || null,
        segments: b.segments.map(s => ({ label: s.label, value: s.value, pct: s.pct, color: s.color }))
      });
      let cum = 0;
      b.segments.forEach((s) => {
        const v = s.value || 0;
        if (v <= 0) return;
        const yBot = yScale(cum);
        let yTop  = yScale(cum + v);
        let hh = Math.max(0, yBot - yTop);
        if (hh < MIN_SEG_PX) { hh = MIN_SEG_PX; yTop = yBot - MIN_SEG_PX; }
        bodies += `<rect class="bar hover-target" x="${cx - barW/2}" y="${yTop}" width="${barW}" height="${hh}" fill="${s.color}" rx="2"
          data-rich="${ATTR(tipPayload)}"/>`;
        cum += v;
      });
    });

    const yLabel = options.yLabel
      ? `<text x="14" y="${(h-padB+padT)/2}" transform="rotate(-90 14 ${(h-padB+padT)/2})" text-anchor="middle" font-size="10.5" fill="#1F2A37" font-weight="600">${options.yLabel}</text>`
      : "";

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <g class="grid">${grid}</g>${yLabel}${bodies}
    </svg>`;
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
    const tip    = $("#chart-tooltip");
    const simple = $("#cht-simple");
    const rich   = $("#cht-rich");

    /* Rich payload — multi-row tooltip. Two flavours:
         kind === 'multi-line' (line charts): FY title + one row per
                                              series with signed value
         default / 'volume-mix' (mix bars):   FY + total + segments
                                              with units + pct + basis  */
    if (el.dataset.rich) {
      let p; try { p = JSON.parse(el.dataset.rich); } catch { p = null; }

      /* Composition charts (pie, ranked bars where total adds up,
         volume-mix bars). One total + per-segment row with dot,
         absolute, and share %. */
      if (p && (p.kind === "pie-share" || p.kind === "ranked-share")) {
        $("#cht-fy").textContent = p.fy || "";
        simple.classList.add("hidden");
        const fmtVol = (v) => v.toFixed(2) + " lakh units";
        const fmt = (v) => {
          if (p.unit === "%")        return v.toFixed(1) + "%";
          if (p.unit === "lakh units" || p.unit === " L" || p.unit === "L")
                                     return fmtVol(v);
          if (p.unit === "₹ Cr" || p.unit === "Rs Cr")
                                     return "₹" + Math.round(v).toLocaleString("en-IN") + " Cr";
          if (Math.abs(v) >= 1000)   return Math.round(v).toLocaleString("en-IN");
          return v.toFixed(2);
        };

        /* Share-mode (industry-mix pie): each segment carries an
           absolute value. Tooltip renders 'X.XX <unit> · YY.Y%'
           with no redundant within-visible-slice parenthesis. */
        if (p.shareMode) {
          const indUnit  = p.industryUnit || p.unit || "";
          const indScale = p.industryScale || 1;
          /* When the metric's unit is '%' the value IS already the
             share — showing both 'absolute' and 'share' columns
             prints the same number twice ('41.4% 41.4%'). Collapse
             to a single share-only column in that case. */
          const valueIsShare = indUnit === "%";
          const fmtAbs = (v) => {
            if (v == null) return "";
            const sv = v * indScale;
            if (indUnit === "lakh units") return sv.toFixed(2) + " lakh units";
            if (indUnit === "₹ Cr" || indUnit === "Rs Cr")
              return "₹" + Math.round(sv).toLocaleString("en-IN") + " Cr";
            if (indUnit === "%")          return sv.toFixed(1) + "%";
            if (indUnit === "count")      return Math.round(sv).toString();
            if (Math.abs(sv) >= 1000)     return Math.round(sv).toLocaleString("en-IN");
            return sv.toFixed(2);
          };
          const indTotalAbs = p.industryAbsolute != null
            ? p.industryAbsolute
            : p.segments.reduce((s, x) => s + (x.value || 0), 0);
          /* Total row: when value already IS the share, omit the
             redundant '· 100.0%'. */
          const totalValueDisplay = valueIsShare
            ? `${fmtAbs(indTotalAbs)}`
            : `${fmtAbs(indTotalAbs)} · 100.0%`;
          const totalRow = indTotalAbs != null
            ? `<div class="flex items-baseline justify-between gap-4">
                 <span class="text-[11px]" style="color:#6B7280;">${p.totalLabel || "Total"}</span>
                 <span class="text-[13px] font-semibold tabular-nums" style="color:#1F2A37;">${totalValueDisplay}</span>
               </div>`
            : "";
          const segs = p.segments
            .filter(s => s.value != null && s.value !== 0)
            .map(s => {
              const sharePct = indTotalAbs ? (s.value / indTotalAbs) * 100 : 0;
              const valueCol = valueIsShare
                ? `<span class="font-semibold" style="color:#1F2A37;">${sharePct.toFixed(1)}%</span>`
                : `<span class="font-normal mr-2" style="color:#1F2A37;">${fmtAbs(s.value)}</span>
                   <span class="font-semibold" style="color:#1F2A37;">${sharePct.toFixed(1)}%</span>`;
              return `
              <div class="flex items-center gap-2.5">
                <span class="inline-block w-2 h-2 rounded-sm flex-shrink-0" style="background:${s.color}"></span>
                <span class="text-[11.5px]" style="color:#1F2A37;">${s.label}</span>
                <span class="text-[12px] tabular-nums ml-auto whitespace-nowrap">${valueCol}</span>
              </div>`;
            }).join("");
          rich.innerHTML = totalRow
            + `<div class="space-y-1.5 mt-2 pt-2" style="border-top:1px solid #EEF1F5;">${segs}</div>`;
          rich.classList.remove("hidden");
          tip.classList.remove("hidden");
          positionTip(tip, e);
          return;
        }

        /* Default composition mode (volume mix etc.) — abs value
           and pct in parentheses. */
        const totalRow = p.total
          ? `<div class="flex items-baseline justify-between gap-4">
               <span class="text-[11px]" style="color:#6B7280;">${p.totalLabel || "Total"}</span>
               <span class="text-[13px] font-semibold tabular-nums" style="color:#1F2A37;">${fmt(p.total)}</span>
             </div>`
          : "";
        const segs = p.segments
          .filter(s => s.value != null && s.value !== 0)
          .map(s => `
            <div class="flex items-center gap-2.5">
              <span class="inline-block w-2 h-2 rounded-sm flex-shrink-0" style="background:${s.color}"></span>
              <span class="text-[11.5px]" style="color:#1F2A37;">${s.label}</span>
              <span class="text-[12px] tabular-nums ml-auto whitespace-nowrap">
                <span class="font-semibold" style="color:#1F2A37;">${fmt(s.value)}</span>
                ${s.pct != null && p.unit !== "%"
                  ? `<span class="font-normal ml-1" style="color:#6B7280;">(${s.pct.toFixed(1)}%)</span>`
                  : ""}
              </span>
            </div>`).join("");
        rich.innerHTML = totalRow
          + `<div class="space-y-1.5 mt-2 pt-2" style="border-top:1px solid #EEF1F5;">${segs}</div>`;
        rich.classList.remove("hidden");
        tip.classList.remove("hidden");
        positionTip(tip, e);
        return;
      }

      /* Non-additive list (e.g. EBITDA Margin %, Volume Growth %)
         where ranking matters but no total / share applies. */
      if (p && p.kind === "ranked-list") {
        $("#cht-fy").textContent = p.fy || "";
        simple.classList.add("hidden");
        const unit = p.unit || "";
        const fmtVal = (v) => {
          const sign = v > 0 ? "+" : "";
          const body = unit === "%"
            ? v.toFixed(1)
            : (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1));
          return `${sign}${body}${unit}`;
        };
        /* Find which segment was hovered → show its full context
           block (prev FY value, industry benchmark, base formula). */
        const hoveredName = el.dataset.series || "";
        const hovered = p.segments.find(s => s.label === hoveredName);
        const ctx = hovered && hovered.context;
        const metricLine = p.metric
          ? `<div class="text-[10.5px] mt-0.5" style="color:#6B7280">${p.metric}${p.metricBase ? ` · ${p.metricBase}` : ""}</div>`
          : "";
        const segs = p.segments.map(s => {
          const isHovered = s.label === hoveredName;
          return `
          <div class="flex items-center gap-2.5${isHovered ? " font-semibold" : ""}">
            <span class="inline-block w-2 h-2 rounded-sm flex-shrink-0" style="background:${s.color}"></span>
            <span class="text-[11.5px]" style="color:#1F2A37;">${s.label}</span>
            <span class="text-[12px] tabular-nums ml-auto font-semibold whitespace-nowrap" style="color:#1F2A37;">${fmtVal(s.value)}</span>
          </div>`;
        }).join("");
        let footer = "";
        if (ctx && (ctx.curUnits || ctx.preUnits || ctx.industryValue != null)) {
          const lines = [];
          if (ctx.curUnits)  lines.push(`<span style="color:#6B7280">${p.fy} volume:</span> <b>${ctx.curUnits}</b>`);
          if (ctx.preUnits)  lines.push(`<span style="color:#6B7280">Prior FY volume:</span> <b>${ctx.preUnits}</b>`);
          if (ctx.industryValue != null)
            lines.push(`<span style="color:#6B7280">Industry ${unit === "%" ? "benchmark" : "total"}:</span> <b>${ctx.industryValue > 0 ? "+" : ""}${ctx.industryValue.toFixed(1)}${unit}</b>`);
          footer = `<div class="text-[10.5px] mt-2 pt-2 leading-relaxed" style="color:#1F2A37; border-top:1px solid #EEF1F5;">${lines.join("<br>")}</div>`;
        }
        rich.innerHTML = metricLine
          + `<div class="space-y-1.5 mt-1">${segs}</div>`
          + footer;
        rich.classList.remove("hidden");
        tip.classList.remove("hidden");
        positionTip(tip, e);
        return;
      }

      if (p && p.kind === "multi-line") {
        $("#cht-fy").textContent = p.fy;
        simple.classList.add("hidden");
        const unit = p.unit || "";
        const isDelta = unit === "%" || /Δ|growth/i.test(unit);
        const fmtVal = (v) => {
          const sign = (isDelta && v > 0) ? "+" : "";
          let body;
          if (unit === "%") body = v.toFixed(1);
          else if (Math.abs(v) >= 1000) body = Math.round(v).toLocaleString("en-IN");
          else body = v.toFixed(2);
          const suffix = unit ? ` ${unit}` : "";
          return `${sign}${body}${suffix}`;
        };
        /* For absolute-value series, also render the YoY change
           next to the value so analysts see the trajectory at a
           glance. Skip when prev is missing (first FY) or when
           the metric itself is already a % (avoids double %).  */
        const fmtYoY = (cur, prev) => {
          if (prev == null || prev === 0) return "";
          const dPct = ((cur - prev) / Math.abs(prev)) * 100;
          const sign = dPct >= 0 ? "+" : "";
          const colour = dPct >= 0 ? "#15803D" : "#B91C1C";
          return `<span class="ml-1.5 text-[11px] font-medium" style="color:${colour}">${sign}${dPct.toFixed(1)}%</span>`;
        };
        const segs = p.segments.map(s => `
          <div class="flex items-center gap-2.5">
            <span class="inline-block w-2 h-2 rounded-sm flex-shrink-0" style="background:${s.color}"></span>
            <span class="text-[11.5px]" style="color:#1F2A37;">${s.label}</span>
            <span class="text-[12px] tabular-nums ml-auto whitespace-nowrap">
              <span class="font-semibold" style="color:#1F2A37;">${fmtVal(s.value)}</span>${unit !== "%" ? fmtYoY(s.value, s.prev) : ""}
            </span>
          </div>`).join("");
        rich.innerHTML = `<div class="space-y-1.5 mt-1">${segs}</div>`;
        rich.classList.remove("hidden");
        tip.classList.remove("hidden");
        positionTip(tip, e);
        return;
      }
      if (p) {
        $("#cht-fy").textContent = p.fy;
        simple.classList.add("hidden");
        const fmtVol = (v) => `${v.toFixed(2)} lakh units`;
        const totalLine = `<div class="flex items-baseline justify-between gap-4">
          <span class="text-[11px]" style="color:#6B7280;">${p.totalLabel}</span>
          <span class="text-[13px] font-semibold tabular-nums" style="color:#1F2A37;">${fmtVol(p.total)}</span>
        </div>`;
        const segs = p.segments.map(s => `
          <div class="flex items-center gap-2.5">
            <span class="inline-block w-2 h-2 rounded-sm flex-shrink-0" style="background:${s.color}"></span>
            <span class="text-[11.5px]" style="color:#1F2A37;">${s.label}</span>
            <span class="text-[12px] tabular-nums ml-auto whitespace-nowrap">
              <span class="font-semibold" style="color:#1F2A37;">${fmtVol(s.value)}</span>
              <span class="font-normal ml-1" style="color:#6B7280;">(${s.pct.toFixed(1)}%)</span>
            </span>
          </div>`).join("");
        const basis = p.basis
          ? `<div class="text-[10.5px] mt-2 pt-2" style="color:#94A3B8; border-top:1px solid #EEF1F5;">${p.basis}</div>`
          : "";
        rich.innerHTML = totalLine
          + `<div class="space-y-1.5 mt-2 pt-2" style="border-top:1px solid #EEF1F5;">${segs}</div>`
          + basis;
        rich.classList.remove("hidden");
        tip.classList.remove("hidden");
        positionTip(tip, e);
        return;
      }
    }

    /* Simple single-row tooltip — existing path. */
    rich.classList.add("hidden");
    rich.innerHTML = "";
    simple.classList.remove("hidden");
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
      /* Show industry shared controls + dispatch the metric-driven
         two-card module. */
      const ctl = $("#industry-controls");
      if (ctl) { ctl.classList.remove("hidden"); ctl.classList.add("flex"); }
      ensureIndustryControls();
      renderIndustryPerformance();

    } else {
      const ctl = $("#industry-controls");
      if (ctl) { ctl.classList.add("hidden"); ctl.classList.remove("flex"); }

      /* 10-year rolling window: trailing 10 FYs from D.FYS_FULL,
         which is already extended automatically each April by
         scripts/extend-fys.mjs. */
      const ROLL_YEARS = 10;
      const fyWindow = (D.FYS_FULL || []).slice(-ROLL_YEARS);
      const limitedNote = fyWindow.length < ROLL_YEARS ? " · Limited history available" : "";

      $("#chart1-title").textContent = `${state.company} growth vs PV industry`;
      $("#chart1-help").textContent  = fyWindow.length
        ? `Volume Growth % · ${fyWindow[0]}–${fyWindow[fyWindow.length-1]}${limitedNote}`
        : "Volume growth comparison";
      $("#chart1-sub").textContent   = "%";

      /* Null = missing data (gap in the chart). Never substitute 0. */
      const oemVals = fyWindow.map(fy => {
        const r = getCompanyMetric(fy, state.company, "Volume Growth %");
        return (r && r.Value != null && typeof r.Value === "number") ? r.Value : null;
      });
      const indVals = fyWindow.map(fy => {
        const r = getIndustryMetric(fy, "PV Volume Growth %");
        return (r && r.Value != null && typeof r.Value === "number") ? r.Value : null;
      });

      $("#chart1").innerHTML = groupedBarChart([
        { name: "PV industry",   color: COLOR.greySft, values: indVals },
        { name: state.company,   color: COLOR.blue,    values: oemVals },
      ], fyWindow, { yUnit: "%" });
      $("#chart1-legend").innerHTML =
        legendChip(COLOR.greySft, "PV industry") + legendChip(COLOR.blue, state.company);

      /* Dynamic source line — pulls the most recent Source label
         off the company's Volume Growth % row so it credits the
         actual feed (Annual Report / Q4 IP / Screener etc.). */
      const latestRow = (D.Company_FY_Metrics || [])
        .filter(r => r.Company === state.company && r.Metric === "Volume Growth %" && r.Source && r.Source !== "Pending")
        .sort((a, b) => (a.FY > b.FY ? 1 : -1))
        .pop();
      const oemSrc = latestRow && latestRow.Source
        ? latestRow.Source
        : `${state.company} Annual Reports / Q4 Investor Presentations`;
      $("#chart1-source").textContent = `Source: SIAM (industry volume growth); ${oemSrc}.`;

      $("#chart2-title").textContent = `Where ${state.company}'s volume is coming from`;
      $("#chart2-help").textContent  = "Total sales volume by selected mix";
      $("#chart2-sub").textContent   = "";
      $("#chart2-sub").classList.add("hidden");
      $("#chart2-toggle").classList.remove("hidden");
      renderVolumeMixChart();
    }

    bindChartHovers($("#chart1"));
    bindChartHovers($("#chart2"));
  }

  /* ---------- Volume + Mix-split chart (chart2 for OEM view) ----------
     Shows a bar per FY whose total height = total sales volume,
     internally split by the selected mix mode. Chart only renders
     bars for FYs where Total Sales Volume is available; FYs missing
     a clean total stay blank rather than fabricated. */
  const MIX_VIEW_FYS = ["FY23", "FY24", "FY25"];

  /* Soothing, low-saturation palette for the mix chart. The single
     dark navy in each view (SUV / UV in product, SUV in regrouped,
     no equivalent in Export / Powertrain) acts as the visual anchor
     so attention lands on the institutional highlight. */
  const MIX_PALETTE = {
    product: {
      mini:    "#A7B8FF",
      compact: "#5B7CFA",
      midSize: "#8AA4D6",
      uv:      "#173B63",   // dark anchor — buy-side highlight
      vans:    "#4DB6AC",
      lcv:     "#E7A64A",
      other:   "#C9D2DF",
    },
    suv: {
      suv:    "#173B63",
      nonSuv: "#B9C6D8",
    },
    export: {
      domestic: "#5B7CFA",
      export:   "#4DB6AC",
    },
    powertrain: {
      ice:    "#8AA4D6",
      cng:    "#4DB6AC",
      hybrid: "#A78BFA",
      bev:    "#7DD3FC",
    },
  };

  function renderVolumeMixChart() {
    const view = state.mixView;
    const company = state.company;

    /* Pull total volume + the relevant share for each FY */
    const data = MIX_VIEW_FYS.map(fy => {
      const totalRow = getCompanyMetric(fy, company, "Total Sales Volume");
      const expRow   = getCompanyMetric(fy, company, "Export Volume %");
      const evRow    = getCompanyMetric(fy, company, "EV Volume %");
      const suvRow   = getCompanyMetric(fy, company, "SUV Volume %");
      return {
        fy,
        total:    totalRow && totalRow.Value !== null ? totalRow.Value : null,
        exportP:  expRow   && expRow.Value   !== null ? expRow.Value   : null,
        evP:      evRow    && evRow.Value    !== null ? evRow.Value    : null,
        suvP:     suvRow   && suvRow.Value   !== null ? suvRow.Value   : null,
      };
    });


    /* Highlight the active top-level toggle. The Product sub-toggle
       row is always mounted (so the card height doesn't jump when
       leaving Product); we just hide its content via visibility
       when not in Product. */
    document.querySelectorAll("#chart2-toggle .mix-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.mix === view);
    });
    const subToggle = $("#chart2-product-sub");
    /* Detailed segment view is only available for Maruti (only OEM
       publishing SIAM segment-wise units monthly). For other OEMs we
       show only the SUV / Non-SUV chip and pin productView to 'suv'. */
    const hasSegmentMix = view === "product" && state.company === "Maruti";
    if (view === "product") {
      subToggle.style.visibility = "visible";
      document.querySelectorAll("#chart2-product-sub .prod-btn").forEach(btn => {
        const v = btn.dataset.productView;
        const showBtn = hasSegmentMix || v === "suv";
        btn.style.display = showBtn ? "" : "none";
        const activeView = hasSegmentMix ? state.productView : "suv";
        btn.classList.toggle("active", v === activeView);
      });
    } else {
      subToggle.style.visibility = "hidden";
    }

    /* Source line — always rendered with a placeholder so its
       row stays in the layout even when company has no source. */
    const sourceEl = $("#chart2-source");
    /* Per-OEM powertrain source notes — what each company actually
       discloses about CNG / Hybrid / BEV vs ICE in its filings. */
    const POWERTRAIN_SRC = {
      "Maruti":         "Maruti Suzuki Annual Reports + Q4 Investor Presentations — CNG units disclosed FY24 (482,717), Hybrid units disclosed FY23-FY25, BEV launches FY26 (e VITARA). Residual = Petrol / Diesel / Other ICE.",
      "Hyundai":        "Hyundai Motor India Q4 FY25 Investor Presentation + DRHP — BEV % from disclosed Ioniq 5 + Kona EV + Creta Electric volumes. Hyundai does not separately publish CNG / Hybrid in PV; CNG is captured within the ICE residual.",
      "M&M":            "Mahindra & Mahindra Q4 FY25 Investor Presentation — BEV % from disclosed XUV400 + BE 6 + XEV 9e volumes. ICE residual covers Bolero / Scorpio / Thar / XUV diesel + petrol; M&M PV is largely diesel and CNG share is negligible.",
      "Tata Motors PV": "Tata Motors Q4 Investor Presentations (PV segment) — EV % from disclosed Nexon EV + Tigor EV + Punch EV + Tiago EV volumes. Tata PV CNG mix is not separately disclosed and is captured within the ICE residual.",
    };
    const co = state.company;

    if (view === "powertrain") {
      sourceEl.textContent = "Source: " + (POWERTRAIN_SRC[co]
        || `${co} Annual Report / Investor Presentations — BEV % from disclosed EV-model volumes; CNG / Hybrid where separately published; residual is Petrol / Diesel / Other ICE.`);
    } else if (co === "Maruti") {
      sourceEl.textContent = "Source: Maruti Suzuki Q4 FY23, Q4 FY24 Investor Presentations; FY25 Annual Report.";
    } else if (view === "product") {
      sourceEl.textContent = `Source: ${co} Annual Report / Investor Presentations — SUV share applied to total dispatches (${co} doesn't publish SIAM segment-wise monthly units).`;
    } else if (view === "export") {
      sourceEl.textContent = `Source: ${co} Annual Report / Investor Presentations — exports % of total dispatches.`;
    } else {
      sourceEl.textContent = " ";
    }

    const TO_LAKH = (n) => n / 1e5;

    let bars, legendItems;

    if (view === "export") {
      const P = MIX_PALETTE.export;
      bars = data.map(d => {
        if (d.total == null || d.exportP == null) return { fy: d.fy, total: null, segments: [] };
        const totalLakh = TO_LAKH(d.total);
        const expLakh   = totalLakh * d.exportP / 100;
        const domLakh   = totalLakh - expLakh;
        return {
          fy: d.fy, total: totalLakh, segments: [
            { label: "Domestic", value: domLakh, pct: 100 - d.exportP, color: P.domestic },
            { label: "Export",   value: expLakh, pct: d.exportP,        color: P.export   },
          ],
        };
      });
      legendItems = legendChip(P.domestic, "Domestic") + legendChip(P.export, "Export");
    } else if (view === "powertrain") {
      /* Powertrain split — CNG / Hybrid / BEV / Petrol-Diesel-Other ICE.
         Volumes are in absolute units, sourced from Maruti AR + Q4 IP
         disclosures. The residual bucket absorbs whatever isn't
         explicitly disclosed (so for FY23, where CNG isn't broken
         out separately, the residual carries CNG too — bucket
         relabelled accordingly). */
      const PT = MIX_PALETTE.powertrain;
      const POWERTRAIN_MIX = {
        Maruti: {
          /* CNG / Hybrid / BEV in absolute units; null = not
             separately disclosed. */
          FY23: { cng: null,    hybrid: 10405,  bev: 0, cngBasis: null },
          FY24: { cng: 482717,  hybrid: 16219,  bev: 0, cngBasis: "Maruti Q4 FY24 IP — actual disclosed CNG units" },
          FY25: { cng: null,    hybrid: 20672,  bev: 0,
                  cngFromDomesticPct: 33.3,
                  cngBasis: "Maruti FY25 disclosure: ~1 in every 3 domestic cars sold was CNG → ~33.3% of domestic volume" },
        },
      };
      const mix = POWERTRAIN_MIX[company];
      bars = data.map(d => {
        const m = mix && mix[d.fy];
        if (!m || d.total == null) {
          /* No CNG/Hybrid/BEV breakdown available (Hyundai/M&M/Tata).
             Fall back to BEV vs ICE using EV Volume %. */
          if (d.total != null && d.evP != null) {
            const totalLakh = TO_LAKH(d.total);
            const bevLakh = totalLakh * d.evP / 100;
            const iceLakh = Math.max(0, totalLakh - bevLakh);
            return {
              fy: d.fy, total: totalLakh, segments: [
                { label: "BEV", value: bevLakh, pct: d.evP, color: PT.bev },
                { label: "Petrol / Diesel / CNG / Other ICE",
                  value: iceLakh, pct: 100 - d.evP, color: PT.ice },
              ],
            };
          }
          return { fy: d.fy, total: null, segments: [] };
        }
        const totalLakh = TO_LAKH(d.total);

        /* Resolve CNG: explicit units > %-of-domestic > null */
        let cngLakh = null;
        if (m.cng != null) {
          cngLakh = TO_LAKH(m.cng);
        } else if (m.cngFromDomesticPct != null && d.exportP != null) {
          const domLakh = totalLakh * (100 - d.exportP) / 100;
          cngLakh = domLakh * (m.cngFromDomesticPct / 100);
        }
        const hybridLakh = m.hybrid != null ? TO_LAKH(m.hybrid) : 0;
        const bevLakh    = m.bev    != null ? TO_LAKH(m.bev)    : 0;

        const segments = [];
        if (cngLakh != null) {
          segments.push({ label: "CNG",    value: cngLakh,    color: PT.cng });
        }
        segments.push({ label: "Hybrid", value: hybridLakh, color: PT.hybrid });
        segments.push({ label: "BEV",    value: bevLakh,    color: PT.bev });

        const accountedFor = (cngLakh || 0) + hybridLakh + bevLakh;
        const residualLakh = Math.max(0, totalLakh - accountedFor);
        const residualLabel = cngLakh == null
          ? "Petrol / Diesel / CNG / Other ICE"
          : "Petrol / Diesel / Other ICE";
        segments.push({ label: residualLabel, value: residualLakh, color: PT.ice });

        const segWithPct = segments.map(s => ({ ...s, pct: (s.value / totalLakh) * 100 }))
                                   .filter(s => s.value > 0 || s.label === "BEV");

        return {
          fy: d.fy, total: totalLakh, segments: segWithPct,
          basisNote: m.cngBasis || (cngLakh == null ? "CNG not separately disclosed for this FY — captured within the residual ICE bucket" : null),
        };
      });
      legendItems = legendChip(PT.cng, "CNG") + legendChip(PT.hybrid, "Hybrid") +
                    legendChip(PT.bev, "BEV") + legendChip(PT.ice, "Petrol / Diesel / Other ICE");
    } else if (view === "product") {
      /* Product mix.
         - Maruti publishes SIAM segment-wise volumes monthly
           (Mini / Compact / Mid / UV / Vans / LCV) → 'Detailed' view
           shows all 7 buckets, 'SUV / Non-SUV' regroups them.
         - Hyundai / M&M / Tata only publish SUV vs total split in
           their AR / IP disclosures (no segment-wise units), so the
           Detailed view is hidden for them and SUV / Non-SUV is
           computed from SUV Volume % × Total Sales Volume.
      */
      const PRODUCT_MIX = {
        Maruti: {
          FY23: { Mini: 144517, Compact: 870790, MidSize: 13596, UV: 339640, Vans: 161099, LCV: 30762 },
          FY24: { Mini: 121395, Compact: 802514, MidSize: 12118, UV: 627360, Vans: 134058, LCV: 30159 },
          FY25: { Mini: 65580,  Compact: 671737, MidSize: 583,   UV: 767728, Vans: 130167, LCV: 36167 },
        },
      };
      const PP = MIX_PALETTE.product;
      const SP = MIX_PALETTE.suv;
      const segDef = [
        { key: "Mini",    label: "Mini",                 color: PP.mini    },
        { key: "Compact", label: "Compact",              color: PP.compact },
        { key: "MidSize", label: "Mid-size",             color: PP.midSize },
        { key: "UV",      label: "UV / SUV",             color: PP.uv      },
        { key: "Vans",    label: "Vans",                 color: PP.vans    },
        { key: "LCV",     label: "LCV",                  color: PP.lcv     },
        { key: "Other",   label: "Exports + OEM supply", color: PP.other   },
      ];
      const mix = PRODUCT_MIX[company];
      const hasSegmentMix = !!mix;
      /* Force SUV view when no segment-level mix exists. */
      const effectiveView = hasSegmentMix ? state.productView : "suv";

      bars = data.map(d => {
        if (d.total == null) return { fy: d.fy, total: null, segments: [] };
        const totalLakh = TO_LAKH(d.total);

        if (effectiveView === "suv") {
          /* SUV units: prefer Maruti's audited UV-bucket count;
             otherwise derive from SUV Volume % × Total Sales Volume. */
          let suvLakh;
          const m = mix && mix[d.fy];
          if (m && m.UV != null) {
            suvLakh = TO_LAKH(m.UV);
          } else if (d.suvP != null) {
            suvLakh = totalLakh * d.suvP / 100;
          } else {
            return { fy: d.fy, total: null, segments: [] };
          }
          const nonSuvLakh = Math.max(0, totalLakh - suvLakh);
          return {
            fy: d.fy, total: totalLakh, segments: [
              { label: "Non-SUV", value: nonSuvLakh, pct: (nonSuvLakh / totalLakh) * 100, color: SP.nonSuv },
              { label: "SUV",     value: suvLakh,    pct: (suvLakh / totalLakh) * 100,    color: SP.suv    },
            ],
          };
        }

        /* Detailed segment view — Maruti only. */
        const m = mix && mix[d.fy];
        if (!m) return { fy: d.fy, total: null, segments: [] };
        const segVolsLakh = segDef.slice(0, 6).map(sd => TO_LAKH(m[sd.key] || 0));
        const sumSix = segVolsLakh.reduce((a,b) => a+b, 0);
        const otherLakh = Math.max(0, totalLakh - sumSix);
        const fullSegments = segDef.map((sd, i) => {
          const value = i < 6 ? segVolsLakh[i] : otherLakh;
          return { label: sd.label, value, pct: (value / totalLakh) * 100, color: sd.color };
        });
        return { fy: d.fy, total: totalLakh, segments: fullSegments.filter(s => s.value > 0) };
      });

      if (effectiveView === "suv") {
        legendItems = legendChip(SP.nonSuv, "Non-SUV") + legendChip(SP.suv, "SUV");
      } else {
        legendItems = segDef.map(sd => legendChip(sd.color, sd.label)).join("");
      }
    }

    const newSvg = volumeMixBarChart(bars, {
      yUnit: " L",
      yLabel: "Sales volume (lakh units)",
      totalLabel: "Total sales volume",
      fmtTotal: (v) => v.toFixed(2),
      unavailableMsg: "Data not available for selected mix",
    });
    crossFadeChart($("#chart2"), newSvg);
    $("#chart2-legend").innerHTML = legendItems;
  }

  /* Cross-fade swap for the volume-mix chart. New SVG is inserted
     absolutely-positioned over the old one; both are tweened in
     opposite directions so the bar feels like it's reclassifying
     itself. Hover targets get re-bound after the new layer is in. */
  function crossFadeChart(host, newHtml) {
    const DUR = 320;
    const cs = host.style;
    if (cs.position !== "relative") cs.position = "relative";
    if (!host.style.minHeight) host.style.minHeight = "240px";

    const incoming = document.createElement("div");
    incoming.className = "mix-chart-layer";
    incoming.style.cssText = `position:absolute;inset:0;opacity:0;transition:opacity ${DUR}ms cubic-bezier(0.4, 0, 0.2, 1);`;
    incoming.innerHTML = newHtml;

    /* Mark any existing layers as outgoing. */
    Array.from(host.querySelectorAll(".mix-chart-layer")).forEach(layer => {
      layer.style.transition = `opacity ${DUR}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      layer.style.opacity = "0";
      layer.classList.add("mix-chart-layer-leaving");
      setTimeout(() => layer.remove(), DUR + 40);
    });

    /* Drop any non-layer children left behind by a prior render
       path (e.g. the Industry-view groupedBarChart that sets
       innerHTML directly without wrapping in .mix-chart-layer).
       Without this, the old SVG stays underneath the new layer
       when the user toggles between Industry and OEM views. */
    Array.from(host.children).forEach(node => {
      if (!node.classList || !node.classList.contains("mix-chart-layer")) {
        node.remove();
      }
    });

    host.appendChild(incoming);
    /* Force a paint so the transition fires from opacity 0. */
    incoming.getBoundingClientRect();
    incoming.style.opacity = "1";

    bindChartHovers(incoming);
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

      const dividerHtml = expandRows.length ? `<div class="veh-divider"></div>` : "";

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
              ? `<div class="text-[9.5px] text-warn bg-warnSoft mt-2 px-1.5 py-0.5 rounded inline-block font-medium">Source TBC</div>`
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

  /* ---------- supporting data ----------
     OEM view shows a 2-layer hub:
       (a) Metric Hub  — clickable cards for trendable metrics
       (b) Product Facts — non-trend items + governance card
     Industry view falls back to the legacy tab structure since
     its categories (Demand / Mix / Competition) don't fit the
     hub model. */

  /* Single grouped table layout. Categories are banner rows
     inside the same <tbody>; each leaf entry is a metric row.
     `trend: true` means a sparkline + click opens the 10-yr modal;
     `kind: 'info'` pulls from company_info instead of fy_metrics. */
  const METRIC_TABLE_GROUPS = [
    { cat: "Growth", rows: [
      { metric: "Revenue Growth %",     trend: true },
      { metric: "Volume Growth %",      trend: true },
      { metric: "Realisation Growth %", trend: true },
    ]},
    { cat: "Margins", rows: [
      { metric: "Gross Margin %",  trend: true },
      { metric: "EBITDA Margin %", trend: true },
    ]},
    { cat: "Mix", rows: [
      { metric: "Export Volume %", trend: true },
      { metric: "SUV Volume %",    trend: true },
    ]},
    { cat: "Scale", rows: [
      { metric: "Capacity Utilisation %", trend: true },
      { metric: "Market Share %",         trend: true },
    ]},
    { cat: "Capital", rows: [
      { metric: "Capex (Rs Cr)",      trend: true },
      { metric: "Working Capital Days", trend: true },
    ]},
    { cat: "Network", rows: [
      { metric: "Dealers / Sales Outlets", trend: false, kind: "info", field: "Dealers" },
    ]},
    { cat: "Product Facts", rows: [
      { metric: "New Model Launches", trend: false },
      { metric: "Facelift Launches",  trend: false },
      { metric: "Top Selling Model",  trend: false },
    ]},
  ];

  /* Tiny sparkline for hub cards. Returns SVG string or empty if
     fewer than 2 numeric points. */
  function miniSparkline(values, color) {
    const pts = values.map((v, i) => v == null || typeof v === "string" ? null : [i, v]).filter(Boolean);
    if (pts.length < 2) return "";
    const w = 100, h = 24, pad = 2;
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const sx = (x) => pad + ((x - xMin) / xSpan) * (w - 2*pad);
    const sy = (y) => pad + (1 - (y - yMin) / ySpan) * (h - 2*pad);
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="w-full h-full">
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
    </svg>`;
  }

  function renderTabs() {
    const isIndustry = state.company === "Industry";
    /* On Industry view, the trend module + KPI strip already cover
       every metric the supporting-data tabs would have surfaced
       (Total PV Volume / Volume Growth / SUV / EV / Export / Top
       Gaining OEM). Hide the industry-tabs section to eliminate
       that duplication. */
    $("#industry-tabs").classList.add("hidden");
    $("#oem-hub").classList.toggle("hidden", isIndustry);
    if (!isIndustry) {
      renderMetricTable();
      renderGovernanceCard();
    }
  }

  function renderIndustryTabs() {
    const tabs = TABS_INDUSTRY;
    const tabNames = Object.keys(tabs);
    if (!tabNames.includes(state.activeTab)) state.activeTab = tabNames[0];

    $("#tab-bar").innerHTML = tabNames.map(t =>
      `<button class="tab-btn ${t === state.activeTab ? "active" : ""}" data-tab="${t}">${t}</button>`
    ).join("");
    document.querySelectorAll(".tab-btn").forEach(btn =>
      btn.addEventListener("click", () => { state.activeTab = btn.dataset.tab; renderIndustryTabs(); })
    );

    const fyCurrent = state.fy;
    const fyPrior   = prevFY(state.fy);
    const metrics = tabs[state.activeTab];
    const rows = metrics.map(metric => {
      const r      = getIndustryMetric(fyCurrent, metric);
      const rPrior = fyPrior ? getIndustryMetric(fyPrior, metric) : null;
      const yoy = r ? r.YoY_Change : null;
      const sig = r ? r.Signal : "Neutral";
      return `
        <tr>
          <td>${metric}</td>
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

    $("#tab-body").innerHTML = `
      <table class="dd-table">
        <thead>
          <tr><th>Metric</th><th>${fyPrior || "Prev FY"}</th><th>${fyCurrent}</th>
              <th>YoY</th><th>Signal</th><th>Source</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6" class="text-inkMuted">No metrics defined</td></tr>`}</tbody>
      </table>`;
  }

  function renderMetricTable() {
    /* 'Network' is excluded from the dropdown — coerce away from it. */
    if (state.selectedCategory === "Network") state.selectedCategory = "Growth";
    const fyCurrent = state.fy;
    const fyPrior   = prevFY(state.fy) || "FY24";
    const fyHistory = D.FYS_FULL;     // 10-year history for the side chart
    const company   = state.company;

    /* Resolve a row from the row spec — covers fy_metrics and
       company_info-backed entries (e.g. Dealers). */
    function pull(spec, fy) {
      if (spec.kind === "info") {
        const info = getCompanyInfo(fy, company);
        return info ? { Value: info[spec.field], Source: info.Source } : null;
      }
      return getCompanyMetric(fy, company, spec.metric);
    }

    /* Soft, low-contrast pills for the Read column. Map the raw
       Signal field (Positive / Neutral / Negative / Watch) to a
       muted style without dot or border. */
    function readPill(sig) {
      const label = sig || "Neutral";
      const cls = ({ Positive: "positive", Negative: "negative", Watch: "watch" })[label] || "neutral";
      return `<span class="read-pill ${cls}">${label}</span>`;
    }

    /* Flatten the grouped specs into a single ordered list; each
       entry knows its enclosing category. Used by the transposed
       layout where each metric becomes a column. */
    const allSpecs = [];
    METRIC_TABLE_GROUPS.forEach(group => {
      group.rows.forEach(spec => {
        allSpecs.push({ ...spec, cat: group.cat, catSpan: group.rows.length });
      });
    });

    const fmt = (spec, v) => {
      if (v == null) return "—";
      if (typeof v === "string") return v;
      if (spec.metric === "Stock Price (31-Mar)") return "₹" + fmtNum(v);
      if (spec.metric === "Capex (Rs Cr)") return "₹" + fmtNum(v) + " Cr";
      if (isPctMetric(spec.metric)) return v.toFixed(1) + "%";
      if (/Days/.test(spec.metric)) return v.toFixed(0) + " d";
      if (/Launches/.test(spec.metric)) return String(v);
      return fmtNum(v);
    };

    /* Per-metric computed cell values for the transposed view. */
    const cells = allSpecs.map(spec => {
      const rCurr  = pull(spec, fyCurrent);
      const rPrior = pull(spec, fyPrior);
      const curr   = rCurr  ? rCurr.Value  : null;
      const prior  = rPrior ? rPrior.Value : null;
      const yoy    = (rCurr && rCurr.YoY_Change != null) ? rCurr.YoY_Change : null;
      const sig    = rCurr && rCurr.Signal ? rCurr.Signal : "Neutral";

      let changeHtml;
      if (typeof curr === "string" || typeof prior === "string") {
        changeHtml = `<span class="change flat">—</span>`;
      } else if (yoy != null) {
        const dir = yoy > 0 ? "up" : yoy < 0 ? "down" : "flat";
        let suffix = "";
        if (isPctMetric(spec.metric))            suffix = "pp";
        else if (/Days/.test(spec.metric))       suffix = "d";
        else if (/Capex|Stock/.test(spec.metric)) suffix = "%";
        changeHtml = `<span class="change ${dir}">${yoy === 0 ? "—" : fmtDelta(yoy, suffix)}</span>`;
      } else if (typeof curr === "number" && typeof prior === "number") {
        const d = curr - prior;
        if (d === 0) {
          changeHtml = `<span class="change flat">—</span>`;
        } else {
          const dir = d > 0 ? "up" : "down";
          const sign = d > 0 ? "+" : "";
          changeHtml = `<span class="change ${dir}">${sign}${d}</span>`;
        }
      } else {
        changeHtml = `<span class="change flat">—</span>`;
      }

      return {
        spec, curr, prior, sig,
        currHtml: fmt(spec, curr),
        priorHtml: fmt(spec, prior),
        changeHtml,
        readHtml: readPill(sig),
        trendable: spec.trend && D.TREND_METRICS.has(spec.metric),
        sourceText: rCurr && rCurr.Source && rCurr.Source !== "Pending" ? rCurr.Source : "Primary source — see Sources tab",
      };
    });

    /* Filter to just the selected category's metrics. The dropdown
       drives both the table content and the side-panel chart. */
    const filteredCells = cells.filter(c => c.spec.cat === state.selectedCategory);

    /* The category selector lives inside the table's top-left corner.
       Wired once on first render. */
    /* 'Network' is intentionally excluded from the dropdown — its
       only metric (Dealers / Sales Outlets) is surfaced inside the
       Governance card instead. */
    function buildCatSelect() {
      const opts = METRIC_TABLE_GROUPS
        .filter(g => g.cat !== "Network")
        .map(g => `<option value="${g.cat}" ${g.cat === state.selectedCategory ? 'selected' : ''}>${g.cat}</option>`)
        .join("");
      return `<select id="cat-select-inline" class="cat-select-inline">${opts}</select>`;
    }

    /* Single-category banner header — the corner cell holds the
       dropdown; metric names sit in the rest of the thead row. */
    const headRow =
      `<th class="row-label-head">${buildCatSelect()}</th>` +
      filteredCells.map(c => `<th class="metric-col-head" title="${ATTR(c.sourceText)}">${c.spec.metric}</th>`).join("");

    const cellTd = (c, content, extra = "") =>
      `<td data-metric="${ATTR(c.spec.metric)}" class="${extra}" title="${ATTR(c.sourceText)}">${content}</td>`;

    const rowPrior  = `<tr><th class="row-label">${fyPrior}</th>${filteredCells.map(c => cellTd(c, c.priorHtml, "num prior")).join("")}</tr>`;
    const rowCurr   = `<tr><th class="row-label">${fyCurrent}</th>${filteredCells.map(c => cellTd(c, c.currHtml, "num curr")).join("")}</tr>`;
    const rowChange = `<tr><th class="row-label">Change</th>${filteredCells.map(c => cellTd(c, c.changeHtml, "num")).join("")}</tr>`;
    const rowRead   = `<tr><th class="row-label">Read</th>${filteredCells.map(c => cellTd(c, c.readHtml)).join("")}</tr>`;

    $("#metric-table").innerHTML = `
      <div class="mtbl-scroll">
        <table class="mtbl mtbl-transposed">
          <thead><tr>${headRow}</tr></thead>
          <tbody>
            ${rowPrior}${rowCurr}${rowChange}${rowRead}
          </tbody>
        </table>
      </div>
      <div class="mtbl-foot">Source: ${company === "Maruti"
        ? "Maruti Suzuki Annual Reports / Q4 Investor Presentations; SIAM (market share / industry); Maruti monthly sales press releases (segment volumes)."
        : "Company filings; Yahoo Finance (NSE close)."}</div>`;

    /* Re-bind the dropdown that just got rendered. */
    const inlineSel = $("#cat-select-inline");
    if (inlineSel) {
      inlineSel.addEventListener("change", () => {
        state.selectedCategory = inlineSel.value;
        renderMetricTable();
      });
    }

    renderCategoryChart(filteredCells);
  }

  /* Side-panel chart for the currently selected category — every
     metric in the category is one trend line, with distinct colors
     so the user can read them apart. */
  function renderCategoryChart(cells) {
    const PALETTE = ["#173B63", "#5B7CFA", "#4DB6AC", "#E7A64A", "#A78BFA", "#94A3B8"];
    const fyHistory = D.FYS_FULL;     // full 10-year window on the trend chart
    const company = state.company;
    const cat = state.selectedCategory;

    const titleEl  = $("#metric-chart-title");
    const helpEl   = $("#metric-chart-help");
    const currEl   = $("#metric-chart-current");
    const chartEl  = $("#metric-chart");
    const legendEl = $("#metric-chart-legend");
    const footEl   = $("#metric-chart-foot");
    if (!titleEl || !chartEl) return;

    titleEl.textContent = cat;
    currEl.textContent = state.fy;
    helpEl.textContent = ({
      "Growth":  "Revenue, volume, and realisation YoY %.",
      "Margins": "Gross margin (proxy) and EBITDA margin %.",
      "Mix":     "SUV / UV and export share of volume.",
      "Scale":   "Capacity utilisation and market share %.",
      "Capital": "Capex, capacity utilisation, working capital days. Capex shown ÷100 to share the axis.",
      "Network": "Dealer / sales-outlet count.",
      "Product Facts": "Launch counts (Top Selling Model excluded — non-numeric).",
    })[cat] || "";

    /* Resolve resolver for fy_metrics vs company_info-backed entries. */
    const pullSide = (spec, fy) => {
      if (spec.kind === "info") {
        const info = getCompanyInfo(fy, company);
        return info ? info[spec.field] : null;
      }
      const r = getCompanyMetric(fy, company, spec.metric);
      return r ? r.Value : null;
    };

    /* Build series — one per numeric metric in the category. */
    const series = [];
    let colorIdx = 0;
    cells.forEach(c => {
      const sample = pullSide(c.spec, state.fy);
      if (typeof sample === "string") return;          // skip Top Selling Model
      const scale = (cat === "Capital" && /Capex/.test(c.spec.metric)) ? 0.01 : 1;
      const label = scale === 1 ? c.spec.metric : c.spec.metric + " (÷ 100)";
      const values = fyHistory.map(fy => {
        const v = pullSide(c.spec, fy);
        if (typeof v !== "number") return null;
        return scale === 1 ? v : +(v * scale).toFixed(2);
      });
      series.push({ name: label, color: PALETTE[colorIdx++ % PALETTE.length], values });
    });

    if (!series.length) {
      crossFadeChart(chartEl, `<div class="text-xs text-inkMuted py-12 text-center">${
        cat === "Product Facts"
          ? "Top Selling Model is non-numeric — see the table for FY-by-FY values."
          : "No numeric trends available for this category."
      }</div>`);
      legendEl.innerHTML = "";
    } else {
      const yUnit = cat === "Network" ? "" : (cat === "Capital" || cat === "Product Facts" ? "" : "%");
      crossFadeChart(chartEl, lineChart(series, { xLabels: fyHistory, yUnit, height: 190 }));
      legendEl.innerHTML = series.map(s => legendChip(s.color, s.name)).join("");
    }

    footEl.textContent = "Source: " + (company === "Maruti"
      ? "Maruti Suzuki Annual Reports / Q4 Investor Presentations."
      : "Company filings.");
  }

  function renderGovernanceCard() {
    const info = getCompanyInfo(state.fy, state.company);
    const card = $("#governance-card");
    if (!info) {
      card.innerHTML = `<div class="text-sm text-inkMuted">Governance from primary sources — ${state.company} ${state.fy} disclosure not yet linked.</div>`;
      return;
    }
    /* Network metrics (Dealers / Employees) live alongside KMP roles
       as button-like info chips — purely presentational, not clickable. */
    const fmtCount = (v) => (v == null ? "—" : fmtNum(v));
    const chips = [
      { label: "CEO",            value: info.CEO || "—" },
      { label: "CFO",            value: info.CFO || "—" },
      { label: "COO",            value: info.COO || "—" },
      { label: "Credit Rating",  value: info.Credit_Rating || "—" },
      { label: "Sales Outlets",  value: fmtCount(info.Dealers) },
      { label: "Employees",      value: fmtCount(info.Employees) },
    ];
    card.innerHTML = `
      <div class="flex items-end justify-between mb-5">
        <h3 class="text-[13px] font-semibold text-navy">Governance & Network</h3>
        <span class="text-[10.5px] text-inkMuted">${state.fy} snapshot</span>
      </div>
      <div class="info-chip-grid">
        ${chips.map(c => `
          <div class="info-chip">
            <div class="info-chip-label">${c.label}</div>
            <div class="info-chip-value">${c.value}</div>
          </div>`).join("")}
      </div>
      <div class="text-[10.5px] text-inkMuted mt-5 leading-relaxed">
        Source: ${(info.Source && info.Source !== "Pending") ? info.Source : "—"}${info.Last_Updated ? ` · Last updated ${new Date(info.Last_Updated).toLocaleDateString("en-GB")}` : ""}
      </div>`;
  }

  /* ====================================================
     TREND MODAL
     ==================================================== */
  function trendChart(values, labels, options = {}) {
    const benchValues = options.bench || null;
    const w = 720, h = 320, padL = 50, padR = 22, padT = 18, padB = 32;

    const allVals = [...values, ...(benchValues || [])].filter(v => v !== null && v !== undefined);
    if (!allVals.length) return `<div class="text-sm text-inkMuted py-10 text-center">No history available from primary sources yet.</div>`;
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
    $("#trend-tt-fy").textContent  = fy;
    $("#trend-tt-label").textContent = metric;
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
      $("#modal-chart").innerHTML = `<div class="text-sm text-inkMuted py-10 text-center">No history available from primary sources yet.</div>`;
      $("#modal-chart-title").textContent = "";
      $("#modal-chart-sub").textContent   = "";
      $("#modal-chart-legend").innerHTML  = "";
      $("#modal-stats").innerHTML         = "";
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

    $("#modal-source").textContent  = (lastRow.Source && lastRow.Source !== "Pending") ? lastRow.Source : "—";
    $("#modal-updated").textContent = lastRow.Last_Updated
      ? new Date(lastRow.Last_Updated).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })
      : "—";

    openModal();
    bindTrendHover($("#modal-chart"), labels, values, metric, benchValues);
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
    const segLabel = current && current.Segment ? current.Segment : "Segment not classified";
    const rankLbl  = current && current.Segment_Rank ? `· #${current.Segment_Rank} in segment` : "";
    $("#vmodal-context").textContent = `${segLabel} ${rankLbl} · Selected FY ${state.fy}`;

    /* Volume trend chart — uses the trendChart renderer */
    const labels = allRows.map(r => r.FY);
    const values = allRows.map(r => (typeof r.Volume === "number" ? r.Volume : null));
    const valued = values.filter(v => typeof v === "number");

    if (!valued.length) {
      $("#vmodal-chart").innerHTML = `<div class="text-sm text-inkMuted py-8 text-center">No volume history available — primary-source disclosure required.</div>`;
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

    /* User-facing freshness only — internal fetcher names, run
       URLs, and per-step status stay out of the dashboard so the
       UI doesn't surface backend / GitHub plumbing. */
    el.innerHTML = `${dot}<span>Data refreshed ${ago}</span>`;
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
    /* Volume + Mix-split chart top-level toggle */
    document.querySelectorAll("#chart2-toggle .mix-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.mixView = btn.dataset.mix;
        renderVolumeMixChart();
      });
    });
    /* Product sub-toggle (Segment Mix vs SUV / Non-SUV) */
    document.querySelectorAll("#chart2-product-sub .prod-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.productView = btn.dataset.productView;
        renderVolumeMixChart();
      });
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
