/* =================================================================
   js/segment-tabs.js
   -----------------------------------------------------------------
   Renders the 5-tab structure for non-PV segments (currently 2W).

   The main dashboard (js/dashboard.js) fills #oem-hub with a single
   "Buy-side Signal · pending" card when in placeholder mode. This
   module overlays that card with the richer tab structure declared
   in data/config/segments_config.json → segments.<id>.tabs +
   tabMetrics, so analysts can see the category breakdown the
   segment will support once data is uploaded.

   Approach:
     - Wait for window.PV_DATA to populate
     - Watch #oem-hub via MutationObserver
     - Whenever the hub renders for a non-live segment with a
       tabMetrics block in its config, replace its content with
       our tab bar + active-tab tile grid
     - Track per-segment active tab in a tiny in-memory cache so
       company switches don't lose the user's tab selection

   This module is intentionally self-contained:
     - Does NOT touch the 3,700-line dashboard.js
     - Reads only D.SEGMENTS / D.Segment_Metrics / D.SEGMENT_PLACEHOLDER
     - No new globals beyond window.SEGMENT_TABS (for debugging)
   ================================================================= */
(function () {
  const HUB_ID = "oem-hub";
  const SECTION_TAG = "data-segment-tabs-rendered";

  /* Per-segment active tab — survives company switches inside the
     same segment. Keyed by segment id (e.g. "2W"). */
  const activeTabBySegment = {};

  /* Tile palette for each metric category. Keeps the visual order
     of metric tiles inside a tab consistent. */
  function placeholderCopy() {
    const D = window.PV_DATA;
    return (D && D.SEGMENT_PLACEHOLDER) || {
      kpi:     "Source data not uploaded yet",
      chart:   "Add 10-year segment data to populate this view",
      vehicle: "Awaiting segment data",
      signal:  "Source/data readiness pending — buy-side signal will activate once the segment data layer is uploaded.",
    };
  }

  /* Pull a real value from D.Segment_Metrics if the fetcher has
     populated it; otherwise null so the tile renders as Pending. */
  function lookupSegmentMetric(segmentId, company, fy, metric) {
    const D = window.PV_DATA;
    if (!D || !Array.isArray(D.Segment_Metrics)) return null;
    return D.Segment_Metrics.find(r =>
      r.segment_id  === segmentId &&
      r.company     === company   &&
      r.fiscal_year === fy        &&
      r.metric      === metric
    ) || null;
  }

  function pickFy() {
    /* Try to read state.fy from the dashboard — accessible via the
       Latest-FY pill in the header. */
    const lbl = document.getElementById("latest-fy-label");
    return (lbl && lbl.textContent && lbl.textContent.trim()) || "FY25";
  }
  function pickCompany() {
    const sel = document.getElementById("company-select");
    return (sel && sel.value) || "Industry";
  }

  /* Format a metric value for display. Pure presentation, never
     fabricates anything — null/undefined renders as a dim em-dash. */
  function formatValue(metric, value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") {
      if (/%$/.test(metric))        return value.toFixed(1) + "%";
      if (/Days$/.test(metric))     return Math.round(value);
      if (/Cr$|₹|Capex/i.test(metric)) return "₹" + Math.round(value).toLocaleString("en-IN") + " Cr";
      if (/Stock Price/i.test(metric)) return "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
      if (value >= 1e6) return (value / 1e5).toFixed(2) + " L";
      return value.toLocaleString("en-IN");
    }
    return String(value);
  }

  function tileHtml(metric, segment, company, fy) {
    const row = lookupSegmentMetric(segment.id, company, fy, metric);
    const display = row ? formatValue(metric, row.value) : null;
    if (display !== null) {
      return `
        <div class="seg-tab-tile seg-tab-tile-live">
          <div class="seg-tab-tile-label">${metric}</div>
          <div class="seg-tab-tile-value">${display}</div>
          <div class="seg-tab-tile-meta">
            <span class="seg-tab-tile-live-pill">Live</span>
            <span class="seg-tab-tile-updated">Updated ${row.last_updated || "—"}</span>
          </div>
        </div>`;
    }
    const ph = placeholderCopy().kpi;
    return `
      <div class="seg-tab-tile seg-tab-tile-placeholder">
        <div class="seg-tab-tile-label">${metric}</div>
        <div class="seg-tab-tile-value seg-tab-tile-value-pending">—</div>
        <div class="seg-tab-tile-meta">
          <span class="seg-tab-tile-pending-pill">Pending</span>
          <span class="seg-tab-tile-hint">${ph}</span>
        </div>
      </div>`;
  }

  function tabContentHtml(segment, tabName) {
    const company = pickCompany();
    const fy      = pickFy();
    if (segment.id !== "2W" && segment.id !== "CV") return "";
    const metrics = (segment.tabMetrics && segment.tabMetrics[tabName]) || [];
    if (!metrics.length) {
      return `<div class="seg-tab-empty">No metrics defined for this tab yet.</div>`;
    }
    /* The Overview tab is a richer view in the future — for now it
       shares the tile-grid layout with the other tabs. The eventual
       Overview should embed the charts + buy-side-signal box. */
    return `
      <div class="seg-tab-context">
        <span class="seg-tab-context-eyebrow">${segment.displayName}</span>
        <span class="seg-tab-context-dot">·</span>
        <span class="seg-tab-context-co">${company}</span>
        <span class="seg-tab-context-dot">·</span>
        <span class="seg-tab-context-fy">${fy}</span>
      </div>
      <div class="seg-tab-tile-grid">
        ${metrics.map(m => tileHtml(m, segment, company, fy)).join("")}
      </div>`;
  }

  function renderTabBar(segment) {
    const active = activeTabBySegment[segment.id] || (segment.tabs && segment.tabs[0]);
    activeTabBySegment[segment.id] = active;
    const tabs = segment.tabs || [];
    return `
      <div class="seg-tab-shell">
        <div class="seg-tab-bar" role="tablist">
          ${tabs.map(t => `
            <button class="seg-tab-btn ${t===active?"is-active":""}"
                    data-seg-tab="${t.replace(/"/g, '&quot;')}"
                    role="tab"
                    aria-selected="${t===active?"true":"false"}">
              ${t}
            </button>`).join("")}
        </div>
        <div class="seg-tab-pane">
          ${tabContentHtml(segment, active)}
        </div>
      </div>`;
  }

  function bindTabClicks(hub, segment) {
    hub.querySelectorAll(".seg-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.segTab;
        if (!tab) return;
        activeTabBySegment[segment.id] = tab;
        /* Re-render only the shell so the dashboard isn't fully
           re-rendered. Mutation observer below skips this rewrite
           via the SECTION_TAG flag. */
        hub.dataset.segTab = tab;
        hub.innerHTML = renderTabBar(segment);
        hub.setAttribute(SECTION_TAG, "1");
        bindTabClicks(hub, segment);
      });
    });
  }

  function currentSegment() {
    const D  = window.PV_DATA;
    const id = document.body.dataset.segment || "PV";
    return (D && D.SEGMENTS && D.SEGMENTS[id]) ? D.SEGMENTS[id] : null;
  }

  function maybeOverlay() {
    const hub = document.getElementById(HUB_ID);
    if (!hub) return;
    const segment = currentSegment();
    /* Only overlay non-live segments that declare tabMetrics. */
    if (!segment || segment.dataReady) return;
    if (!segment.tabMetrics) return;
    if (hub.classList.contains("hidden")) return;
    /* Don't re-render our own writes. */
    if (hub.getAttribute(SECTION_TAG) === "1") return;
    hub.innerHTML = renderTabBar(segment);
    hub.setAttribute(SECTION_TAG, "1");
    bindTabClicks(hub, segment);
  }

  function clearTag() {
    const hub = document.getElementById(HUB_ID);
    if (hub) hub.removeAttribute(SECTION_TAG);
  }

  function install() {
    const hub = document.getElementById(HUB_ID);
    if (!hub) {
      /* Hub not in DOM yet — try again shortly. */
      setTimeout(install, 200);
      return;
    }
    /* Re-run overlay whenever dashboard.js rewrites the hub. */
    const obs = new MutationObserver(() => {
      /* Skip if our own write just landed. */
      if (hub.getAttribute(SECTION_TAG) === "1") return;
      maybeOverlay();
    });
    obs.observe(hub, { childList: true, subtree: false });

    /* Also re-run when segment / company / FY changes — the hub
       might get a non-segment-tag rewrite. */
    const segBtn = document.getElementById("segment-switcher-btn");
    document.querySelectorAll(".segment-card").forEach(c => {
      c.addEventListener("click", () => {
        clearTag();
        setTimeout(maybeOverlay, 80);
      });
    });
    const coSel = document.getElementById("company-select");
    if (coSel) coSel.addEventListener("change", () => {
      clearTag();
      setTimeout(maybeOverlay, 80);
    });

    /* First pass. */
    setTimeout(maybeOverlay, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }

  /* Expose for debugging only. */
  window.SEGMENT_TABS = { maybeOverlay, activeTabBySegment };
})();
