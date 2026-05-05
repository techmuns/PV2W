/* =================================================================
   Dashboard rendering — single reusable template.
   Reads exclusively from window.PV_DATA tables.
   ================================================================= */
(function () {
  const D = window.PV_DATA;

  // ---------- state ----------
  const state = {
    fy:      "FY25",
    company: "Maruti",
    activeTab: "Growth",
  };

  // ---------- generic helpers ----------
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
  const fmtPct = (n) => (n === null || n === undefined) ? "—"
    : (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
  const fmtDelta = (n, suffix = "pp") => {
    if (n === null || n === undefined) return "—";
    return (n >= 0 ? "+" : "") + n.toFixed(1) + suffix;
  };
  const prevFY = (fy) => {
    const i = D.FYS.indexOf(fy);
    return i > 0 ? D.FYS[i - 1] : null;
  };
  const signalClass = (s) => ({
    "Positive": "signal-pos",
    "Negative": "signal-neg",
    "Neutral":  "signal-neu",
  }[s] || "signal-neu");
  const signalDot = (s) => {
    const colour = { "Positive": "#4A8B6F", "Negative": "#B5524A", "Neutral": "#6B7280" }[s] || "#6B7280";
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

  // ---------- table queries ----------
  const getCompanyMetric = (fy, company, metric) =>
    D.Company_FY_Metrics.find(r => r.FY === fy && r.Company === company && r.Metric === metric);

  const getIndustryMetric = (fy, metric) =>
    D.Industry_FY_Metrics.find(r => r.FY === fy && r.Metric === metric);

  const getBuySide = (fy, company) =>
    D.BuySide_Signals.find(r => r.FY === fy && r.Company === company);

  const getCompanyInfo = (fy, company) =>
    D.Company_Info.find(r => r.FY === fy && r.Company === company)
    || D.Company_Info.find(r => r.Company === company); // fallback to most recent

  const getVehicles = (fy, company) =>
    D.Vehicle_FY_Metrics.filter(r => r.FY === fy && r.Company === company);

  // Latest Last_Updated across the rows that drive the current view
  const computeLastUpdated = () => {
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
  };

  // ---------- top status bar ----------
  function renderTopBar() {
    // FY selector
    const fySel = $("#fy-select");
    fySel.innerHTML = D.FYS.map(f => `<option value="${f}" ${f===state.fy?"selected":""}>${f}</option>`).join("");

    // Company selector
    const cSel = $("#company-select");
    cSel.innerHTML = D.COMPANIES.map(c => `<option value="${c}" ${c===state.company?"selected":""}>${c}</option>`).join("");

    // Overall Signal
    let overall = "Neutral";
    if (state.company === "Industry") {
      // derive from PV Volume Growth metric signal
      const r = getIndustryMetric(state.fy, "PV Volume Growth %");
      overall = r ? r.Signal : "Neutral";
    } else {
      const bs = getBuySide(state.fy, state.company);
      overall = bs ? bs.Overall_Signal : "Neutral";
    }
    const sigEl = $("#overall-signal");
    sigEl.className = `text-xs font-medium px-2 py-0.5 rounded-full ${signalClass(overall)}`;
    sigEl.textContent = overall;

    // Last updated + freshness
    const lu = computeLastUpdated();
    $("#last-updated").textContent = lu ? new Date(lu).toLocaleDateString("en-GB",
      { day: "2-digit", month: "short", year: "numeric" }) : "—";

    const fresh = freshness(lu);
    const fEl = $("#freshness-badge");
    fEl.textContent = fresh;
    fEl.className = "text-xs font-medium px-2 py-0.5 rounded-full " +
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

    // View title
    const titleEl = $("#view-title");
    const subEl   = $("#view-subtitle");
    if (state.company === "Industry") {
      titleEl.textContent = `Indian PV Industry — ${state.fy}`;
      subEl.textContent   = "Demand, mix, and competitive shifts";
    } else {
      titleEl.textContent = `${state.company} — ${state.fy}`;
      const info = getCompanyInfo(state.fy, state.company);
      const yoyBase = prevFY(state.fy);
      subEl.textContent = info
        ? `CEO ${info.CEO} · ${info.Credit_Rating} · YoY base: ${yoyBase || "—"}`
        : `YoY base: ${yoyBase || "—"}`;
    }
  }

  // ---------- KPI strip ----------
  function renderKpiStrip() {
    const grid = $("#kpi-strip");
    const isIndustry = state.company === "Industry";
    const list = isIndustry ? D.INDUSTRY_KPIS : D.OEM_KPIS;

    grid.innerHTML = list.map(metric => {
      const r = isIndustry
        ? getIndustryMetric(state.fy, metric)
        : getCompanyMetric(state.fy, state.company, metric);

      const val = r ? r.Value : null;
      const yoy = r ? r.YoY_Change : null;
      const sig = r ? r.Signal : "Neutral";
      const lu  = r ? r.Last_Updated : null;
      const stalePending = !r || freshness(lu) === "Missing";

      let valDisplay;
      if (val === null || val === undefined) valDisplay = "—";
      else if (typeof val === "string") valDisplay = val;
      else if (metric === "Total PV Volume") valDisplay = fmtNum(val);
      else if (metric === "Stock Price (31-Mar)") valDisplay = "₹" + fmtNum(val);
      else if (metric === "Capacity (units)") valDisplay = fmtNum(val);
      else valDisplay = val.toFixed(1) + "%";

      let deltaDisplay = "—";
      let deltaClass = "delta-flat";
      if (yoy !== null && yoy !== undefined && typeof yoy === "number") {
        deltaDisplay = fmtDelta(yoy, metric.includes("%") || metric.includes("Share") || metric.includes("Margin") ? "pp" : (metric === "Stock Price (31-Mar)" ? "%" : ""));
        deltaClass = yoy > 0 ? "delta-up" : yoy < 0 ? "delta-down" : "delta-flat";
      }

      return `
        <div class="bg-card rounded-xl shadow-card border border-line p-4 hover:shadow-cardHover transition-shadow">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10.5px] uppercase tracking-wide text-inkMuted font-medium">${metric}</span>
            ${signalDot(sig)}
          </div>
          <div class="text-[22px] font-semibold text-navy leading-tight tabular-nums">${valDisplay}</div>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-[11px] ${deltaClass} tabular-nums font-medium">${deltaDisplay}</span>
            <span class="text-[10px] text-inkMuted">YoY</span>
            ${stalePending ? '<span class="ml-auto text-[9px] text-warn bg-warnSoft px-1.5 py-0.5 rounded">Pending</span>' : ''}
          </div>
        </div>`;
    }).join("");
  }

  // ---------- Chart helpers ----------
  function lineChart(svgId, series, options = {}) {
    const w = 480, h = 220, padL = 40, padR = 16, padT = 14, padB = 28;
    const labels = options.xLabels || [];
    const allVals = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
    let yMin = Math.min(...allVals, 0), yMax = Math.max(...allVals, 1);
    const span = yMax - yMin || 1;
    yMin -= span * 0.1; yMax += span * 0.15;

    const x = (i) => padL + i * ((w - padL - padR) / Math.max(labels.length - 1, 1));
    const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);

    const grid = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const yy = padT + t * (h - padT - padB);
      const val = yMax - t * (yMax - yMin);
      return `<line class="grid-line" x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#EEF0F3"/>
              <text x="${padL-6}" y="${yy+3}" text-anchor="end" font-size="10" fill="#6B7280">${val.toFixed(0)}${options.yUnit||""}</text>`;
    }).join("");

    const lines = series.map((s, idx) => {
      const path = s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
      const dots = s.values.map((v, i) =>
        `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${s.color}"/>`).join("");
      return `<path class="line-path" d="${path}" stroke="${s.color}"/>${dots}`;
    }).join("");

    const xAxis = labels.map((l, i) =>
      `<text x="${x(i)}" y="${h-8}" text-anchor="middle" font-size="10" fill="#6B7280">${l}</text>`).join("");

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <g class="grid">${grid}</g>
      ${lines}
      <g class="axis">${xAxis}</g>
    </svg>`;
  }

  function stackedBarChart(series, labels, options = {}) {
    const w = 480, h = 220, padL = 40, padR = 16, padT = 14, padB = 28;
    const groups = labels.length;
    const groupW = (w - padL - padR) / groups;
    const barW = Math.min(groupW * 0.55, 60);

    const totals = labels.map((_, i) => series.reduce((s, ss) => s + (ss.values[i] || 0), 0));
    const yMax = Math.max(...totals, 1) * 1.15;

    const yScale = (v) => padT + (1 - v / yMax) * (h - padT - padB);

    const grid = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const yy = padT + t * (h - padT - padB);
      const val = yMax * (1 - t);
      return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#EEF0F3"/>
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
      bars += `<text x="${cx}" y="${yScale(cum) - 4}" text-anchor="middle" font-size="10" fill="#1F2937" font-weight="500">${cum.toFixed(0)}${options.yUnit||""}</text>`;
    });

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      ${grid}${bars}
    </svg>`;
  }

  function groupedBarChart(series, labels, options = {}) {
    const w = 480, h = 220, padL = 40, padR = 16, padT = 14, padB = 28;
    const groupW = (w - padL - padR) / labels.length;
    const barW = Math.min((groupW * 0.7) / series.length, 28);

    const allVals = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
    let yMin = Math.min(...allVals, 0), yMax = Math.max(...allVals, 1);
    if (yMin > 0) yMin = 0;
    yMax *= 1.15;

    const yScale = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);
    const zeroY = yScale(0);

    const grid = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const yy = padT + t * (h - padT - padB);
      const val = yMax - t * (yMax - yMin);
      return `<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#EEF0F3"/>
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

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      ${grid}${bars}
    </svg>`;
  }

  function legendChip(color, label) {
    return `<span class="inline-flex items-center gap-1.5">
      <span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${color}"></span>${label}
    </span>`;
  }

  // ---------- Charts ----------
  function renderCharts() {
    const isIndustry = state.company === "Industry";
    const fyHistory = D.FYS; // FY23..FY25

    if (isIndustry) {
      // Chart 1: PV industry volume trend
      $("#chart1-title").textContent = "PV industry volume trend";
      $("#chart1-sub").textContent   = "Lakhs · units";
      const indVol = fyHistory.map(fy => {
        const r = getIndustryMetric(fy, "Total PV Volume");
        return r ? r.Value / 100000 : null;
      });
      $("#chart1").innerHTML = lineChart("c1", [
        { name: "Industry volume", color: "#0B2545", values: indVol },
      ], { xLabels: fyHistory });
      $("#chart1-legend").innerHTML = legendChip("#0B2545", "PV industry volume (lakh units)");

      // Chart 2: OEM market share comparison (current FY)
      $("#chart2-title").textContent = "OEM market share";
      $("#chart2-sub").textContent   = state.fy + " · %";
      const oems = ["Maruti", "Hyundai", "M&M", "Tata Motors PV"];
      const sharesPrev = oems.map(o => {
        const r = getCompanyMetric(prevFY(state.fy) || state.fy, o, "Market Share %");
        return r ? r.Value : 0;
      });
      const sharesCurr = oems.map(o => {
        const r = getCompanyMetric(state.fy, o, "Market Share %");
        return r ? r.Value : 0;
      });
      $("#chart2").innerHTML = groupedBarChart([
        { name: prevFY(state.fy) || state.fy, color: "#A8B8CC", values: sharesPrev },
        { name: state.fy,                      color: "#4A6FA5", values: sharesCurr },
      ], oems, { yUnit: "%" });
      $("#chart2-legend").innerHTML =
        legendChip("#A8B8CC", prevFY(state.fy) || "Prev FY") + legendChip("#4A6FA5", state.fy);

    } else {
      // Chart 1: OEM volume growth vs Industry volume growth
      $("#chart1-title").textContent = `${state.company} growth vs PV industry`;
      $("#chart1-sub").textContent   = "Volume growth %";

      const oemVals = fyHistory.map(fy => {
        const r = getCompanyMetric(fy, state.company, "Volume Growth %");
        return r ? r.Value : null;
      });
      const indVals = fyHistory.map(fy => {
        const r = getIndustryMetric(fy, "PV Volume Growth %");
        return r ? r.Value : null;
      });
      $("#chart1").innerHTML = groupedBarChart([
        { name: "PV industry", color: "#A8B8CC", values: indVals },
        { name: state.company, color: "#4A6FA5", values: oemVals },
      ], fyHistory, { yUnit: "%" });
      $("#chart1-legend").innerHTML =
        legendChip("#A8B8CC", "PV industry") + legendChip("#4A6FA5", state.company);

      // Chart 2: Mix shift — SUV / EV / Export revenue %
      $("#chart2-title").textContent = "Mix shift";
      $("#chart2-sub").textContent   = "Revenue mix · %";

      const suvVals = fyHistory.map(fy => {
        const r = getCompanyMetric(fy, state.company, "SUV Revenue %");
        return r ? r.Value : 0;
      });
      const evVals = fyHistory.map(fy => {
        const r = getCompanyMetric(fy, state.company, "EV Revenue %");
        return r ? r.Value : 0;
      });
      const expVals = fyHistory.map(fy => {
        const r = getCompanyMetric(fy, state.company, "Export Revenue %");
        return r ? r.Value : 0;
      });

      $("#chart2").innerHTML = stackedBarChart([
        { name: "SUV",    color: "#4A6FA5", values: suvVals },
        { name: "EV",     color: "#4A8B6F", values: evVals  },
        { name: "Export", color: "#B58A4A", values: expVals },
      ], fyHistory, { yUnit: "%" });
      $("#chart2-legend").innerHTML =
        legendChip("#4A6FA5", "SUV revenue %") +
        legendChip("#4A8B6F", "EV revenue %") +
        legendChip("#B58A4A", "Export revenue %");
    }
  }

  // ---------- Buy-side signal box ----------
  function renderSignalBox() {
    const box = $("#signal-box");
    const isIndustry = state.company === "Industry";

    if (isIndustry) {
      // industry insight box (per spec)
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
        ["Competition", topR ? `${topR.Value} gaining most share` : "—"],
        ["Key risk",    "Sub-Rs10L hatch demand soft"],
        ["Key trigger", "Festive demand, EV launches"],
      ];
      box.innerHTML = rows.map(([k, v]) => `
        <div class="flex items-start justify-between gap-3 py-2.5">
          <span class="text-[11px] uppercase tracking-wide text-inkMuted w-20 shrink-0">${k}</span>
          <span class="text-xs text-ink text-right">${v}</span>
        </div>`).join("");
      return;
    }

    const bs = getBuySide(state.fy, state.company);
    if (!bs) {
      box.innerHTML = `<div class="text-xs text-inkMuted py-3">Data pending for ${state.company} — ${state.fy}</div>`;
      return;
    }
    const rows = [
      ["Share",   bs.Share_Read],
      ["Growth",  bs.Growth_Read],
      ["Margin",  bs.Margin_Read],
      ["Mix",     bs.Mix_Read],
      ["Risk",    bs.Risk_Read],
      ["Trigger", bs.Trigger_Read],
    ];
    box.innerHTML = rows.map(([k, v]) => `
      <div class="flex items-start justify-between gap-3 py-2.5">
        <span class="text-[11px] uppercase tracking-wide text-inkMuted w-16 shrink-0">${k}</span>
        <span class="text-xs text-ink text-right">${v}</span>
      </div>`).join("");
  }

  // ---------- Vehicle cards ----------
  function renderVehicleCards() {
    const section = $("#vehicle-section");
    if (state.company === "Industry") {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    const grid = $("#vehicle-grid");
    const defaults = D.DEFAULT_VEHICLES[state.company] || [];
    const data = getVehicles(state.fy, state.company);
    const byName = Object.fromEntries(data.map(r => [r.Vehicle, r]));

    grid.innerHTML = defaults.map(name => {
      const r = byName[name];
      const placeholder = !r;
      const sig = r ? r.Signal : "Neutral";
      const sigLabel =
        sig === "Positive" ? "Gain" : sig === "Negative" ? "Loss" : "Stable";
      const fresh = r ? freshness(r.Last_Updated) : "Missing";

      return `
        <div class="bg-card rounded-xl shadow-card border border-line p-3 hover:shadow-cardHover transition-shadow">
          <div class="flex items-start justify-between mb-2">
            <div>
              <div class="text-sm font-semibold text-navy leading-tight">${name}</div>
              <div class="text-[10.5px] text-inkMuted mt-0.5">${r ? r.Segment : "—"}</div>
            </div>
            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded ${signalClass(sig)}">${sigLabel}</span>
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
            ? `<div class="text-[9.5px] text-warn bg-warnSoft mt-2 px-1.5 py-0.5 rounded inline-block">Data pending</div>`
            : (fresh === "Stale"
                ? `<div class="text-[9.5px] text-warn bg-warnSoft mt-2 px-1.5 py-0.5 rounded inline-block">Stale</div>`
                : "")
          }
        </div>`;
    }).join("");
  }

  // ---------- Tabs / drilldowns ----------
  const TABS_OEM = {
    "Growth":     ["Revenue Growth %", "Volume Growth %", "Realisation Growth %"],
    "Margins":    ["Gross Margin %", "EBITDA Margin %"],
    "Mix":        ["SUV Volume %", "SUV Revenue %", "EV Volume %", "EV Revenue %", "Export Volume %", "Export Revenue %"],
    "Operations": ["Capacity (units)", "Capacity Utilisation %", "Capex (Rs Cr)", "Working Capital Days"],
    "Product":    ["New Model Launches", "Facelift Launches", "Top Selling Model"],
    "Governance": [],  // built from Company_Info
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
      btn.addEventListener("click", () => {
        state.activeTab = btn.dataset.tab;
        renderTabs();
      })
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
        <div class="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3">
          ${fields.map(([k,v]) => `
            <div>
              <div class="text-[10.5px] uppercase tracking-wide text-inkMuted">${k}</div>
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
      const r = isIndustry ? getIndustryMetric(fyCurrent, metric)
                           : getCompanyMetric(fyCurrent, state.company, metric);
      const rPrior = fyPrior
        ? (isIndustry ? getIndustryMetric(fyPrior, metric)
                      : getCompanyMetric(fyPrior, state.company, metric))
        : null;

      const val = r ? r.Value : null;
      const valPrev = rPrior ? rPrior.Value : null;
      const yoy = r ? r.YoY_Change : null;
      const sig = r ? r.Signal : "Neutral";
      const fmtVal = (v) => {
        if (v === null || v === undefined) return "—";
        if (typeof v === "string") return v;
        if (metric.includes("%")) return v.toFixed(1) + "%";
        return fmtNum(v);
      };

      return `
        <tr>
          <td>${metric}</td>
          <td class="num">${fmtVal(valPrev)}</td>
          <td class="num font-medium text-navy">${fmtVal(val)}</td>
          <td class="num ${yoy > 0 ? "delta-up" : yoy < 0 ? "delta-down" : "delta-flat"}">
            ${yoy === null || yoy === undefined ? "—" : fmtDelta(yoy, metric.includes("%") ? "pp" : "")}
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
          <tr>
            <th>Metric</th>
            <th>${fyPrior || "Prev FY"}</th>
            <th>${fyCurrent}</th>
            <th>YoY</th>
            <th>Signal</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6" class="text-inkMuted">No metrics defined</td></tr>`}</tbody>
      </table>`;
  }

  // ---------- master render ----------
  function renderAll() {
    renderTopBar();
    renderKpiStrip();
    renderCharts();
    renderSignalBox();
    renderVehicleCards();
    renderTabs();
  }

  // ---------- selector listeners ----------
  function wire() {
    $("#fy-select").addEventListener("change", (e) => {
      state.fy = e.target.value;
      renderAll();
    });
    $("#company-select").addEventListener("change", (e) => {
      state.company = e.target.value;
      // reset active tab when switching to/from industry
      const tabs = state.company === "Industry" ? TABS_INDUSTRY : TABS_OEM;
      if (!Object.keys(tabs).includes(state.activeTab)) {
        state.activeTab = Object.keys(tabs)[0];
      }
      renderAll();
    });
  }

  // ---------- boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    wire();
    renderAll();
  });
})();
