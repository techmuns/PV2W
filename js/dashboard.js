/* =================================================================
   Dashboard rendering — single reusable template.
   Reads exclusively from window.PV_DATA tables.
   ================================================================= */
(function () {
  const D = window.PV_DATA;

  const COLOR = {
    blue:    "#2563EB",
    blueSft: "#93B4F4",
    teal:    "#0F766E",
    navy:    "#0B1F33",
    grey:    "#94A3B8",
    greySft: "#CBD5E1",
    pos:     "#16A34A",
    neg:     "#DC2626",
    warn:    "#B45309",
    amber:   "#F59E0B",
    neu:     "#64748B",
  };

  /* Brand colors per company. Used in: logo mark, brand box, header
     dropdown dot. Never used to recolor the rest of the dashboard. */
  const BRAND = {
    "Maruti":         { color: "#C95A5A", label: "OEM",       initials: "MS" },
    "Hyundai":        { color: "#0F3D75", label: "OEM",       initials: "HM" },
    "M&M":            { color: "#7A2E3A", label: "OEM",       initials: "M&M" },
    "Tata Motors PV": { color: "#1E4E8C", label: "OEM",       initials: "TM" },
    "Industry":       { color: "#334E68", label: "Aggregate", initials: "PV" },
  };

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

  /* ---------- identity row ---------- */
  function logoMarkHTML(company, sizeClass = "") {
    const brand = BRAND[company];
    const info  = getCompanyInfo(state.fy, company);
    const url   = info ? info.Logo_URL : null;
    const isIndustry = company === "Industry";
    if (isIndustry) {
      return {
        cls: `logo-mark logo-mark-aggregate ${sizeClass}`.trim(),
        style: `--brand:${brand.color}`,
        inner: `<span class="logo-initials">${brand.initials}</span>`,
      };
    }
    if (url) {
      return {
        cls: `logo-mark ${sizeClass}`.trim(),
        style: `--brand:${brand.color}`,
        inner: `<img src="${url}" alt="${company} logo"
                     onerror="this.parentElement.classList.add('logo-mark-pending');this.parentElement.innerHTML='&lt;span class=&quot;logo-pending-text&quot;&gt;Logo pending&lt;/span&gt;';">`,
      };
    }
    return {
      cls: `logo-mark logo-mark-pending ${sizeClass}`.trim(),
      style: `--brand:${brand.color}`,
      inner: `<span class="logo-pending-text">Logo pending</span>`,
    };
  }

  function applyLogoMark(el, company, sizeClass = "") {
    const spec = logoMarkHTML(company, sizeClass);
    el.className = spec.cls;
    el.setAttribute("style", spec.style);
    el.innerHTML = spec.inner;
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

      const history = getMetricHistory(state.company, metric, 10, state.fy);
      const sparkValues = history.map(r => typeof r.Value === "number" ? r.Value : null);
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
          <div class="kpi-spark">${typeof val === "string" ? `<div class="kpi-spark-empty">—</div>` : sparkline(sparkValues)}</div>
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

  /* ---------- main-page chart helpers ---------- */
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

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <g class="grid">${grid}</g>${lines}<g class="axis">${xAxis}</g>
    </svg>`;
  }

  function stackedBarChart(series, labels, options = {}) {
    const w = 480, h = 220, padL = 44, padR = 16, padT = 14, padB = 28;
    const groupW = (w - padL - padR) / labels.length;
    const barW = Math.min(groupW * 0.55, 60);
    const totals = labels.map((_, i) => series.reduce((s, ss) => s + (ss.values[i] || 0), 0));
    const yMax = Math.max(...totals, 1) * 1.18;
    const yScale = (v) => padT + (1 - v / yMax) * (h - padT - padB);

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
        const yTop = yScale(cum + v);
        const yBot = yScale(cum);
        const hh = Math.max(0, yBot - yTop);
        bars += `<rect class="bar" x="${cx - barW/2}" y="${yTop}" width="${barW}" height="${hh}" fill="${s.color}" rx="2"/>`;
        cum += v;
      });
      bars += `<text x="${cx}" y="${h-8}" text-anchor="middle" font-size="10" fill="#6B7280">${label}</text>`;
      bars += `<text x="${cx}" y="${yScale(cum) - 4}" text-anchor="middle" font-size="10" fill="#102A43" font-weight="500">${cum.toFixed(0)}${options.yUnit||""}</text>`;
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
        bars += `<rect class="bar" x="${startX + si*barW}" y="${yTop}" width="${barW - 2}" height="${hh}" fill="${s.color}" rx="2"/>`;
      });
      bars += `<text x="${cx}" y="${h-8}" text-anchor="middle" font-size="10" fill="#6B7280">${label}</text>`;
    });
    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
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
      $("#chart2-sub").textContent   = "Revenue mix · %";

      const suvVals = fyHistory.map(fy => (getCompanyMetric(fy, state.company, "SUV Revenue %")||{}).Value || 0);
      const evVals  = fyHistory.map(fy => (getCompanyMetric(fy, state.company, "EV Revenue %")||{}).Value  || 0);
      const expVals = fyHistory.map(fy => (getCompanyMetric(fy, state.company, "Export Revenue %")||{}).Value || 0);

      $("#chart2").innerHTML = stackedBarChart([
        { name: "SUV",    color: COLOR.blue,    values: suvVals },
        { name: "EV",     color: COLOR.teal,    values: evVals  },
        { name: "Export", color: COLOR.warn,    values: expVals },
      ], fyHistory, { yUnit: "%" });
      $("#chart2-legend").innerHTML =
        legendChip(COLOR.blue, "SUV revenue %") +
        legendChip(COLOR.teal, "EV revenue %") +
        legendChip(COLOR.warn, "Export revenue %");
    }
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
  function renderVehicleCards() {
    const section = $("#vehicle-section");
    if (state.company === "Industry") { section.style.display = "none"; return; }
    section.style.display = "";

    const grid = $("#vehicle-grid");
    const defaults = D.DEFAULT_VEHICLES[state.company] || [];
    const data = getVehicles(state.fy, state.company);
    const byName = Object.fromEntries(data.map(r => [r.Vehicle, r]));

    grid.innerHTML = defaults.map(name => {
      const r = byName[name];
      const placeholder = !r;
      const sig = r ? r.Signal : "Neutral";
      const sigLabel = sig === "Positive" ? "Gain" : sig === "Negative" ? "Loss" : "Stable";
      const fresh = r ? freshness(r.Last_Updated) : "Missing";
      const imgUrl = r ? r.Image_URL : null;

      const imageSlot = imgUrl
        ? `<div class="veh-image-slot has-image"><img class="veh-image" src="${imgUrl}" alt="${name}"
              onerror="this.parentElement.classList.remove('has-image');this.parentElement.innerHTML='Image pending';"></div>`
        : `<div class="veh-image-slot">Image pending</div>`;

      return `
        <div class="veh-card">
          ${imageSlot}
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
        </div>`;
    }).join("");
  }

  /* ---------- tabs ---------- */
  const TABS_OEM = {
    "Growth":     ["Revenue Growth %", "Volume Growth %", "Realisation Growth %"],
    "Margins":    ["Gross Margin %", "EBITDA Margin %"],
    "Mix":        ["SUV Volume %", "SUV Revenue %", "EV Volume %", "EV Revenue %", "Export Volume %", "Export Revenue %"],
    "Operations": ["Capacity (units)", "Capacity Utilisation %", "Capex (Rs Cr)", "Working Capital Days"],
    "Product":    ["New Model Launches", "Facelift Launches", "Top Selling Model"],
    "Governance": [],
  };
  const TABS_INDUSTRY = {
    "Demand":      ["Total PV Volume", "PV Volume Growth %"],
    "Mix":         ["SUV Share %", "EV Share %", "Export Share %"],
    "Competition": ["Top Gaining OEM"],
  };

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
          Source: ${info.Source} · Last updated ${new Date(info.Last_Updated).toLocaleDateString("en-GB")}
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
          <td class="text-[10.5px] text-inkMuted">${r ? r.Source : "—"}</td>
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
    $("#modal-source").textContent  = lastRow.Source || "—";
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

  /* ---------- master render ---------- */
  function renderAll() {
    renderTopBar();
    renderIdentityRow();
    renderKpiStrip();
    renderCharts();
    renderSignalBox();
    renderVehicleCards();
    renderTabs();
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
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    renderAll();
  });
})();
