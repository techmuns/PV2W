/* =================================================================
   PV_LOADER — fetches the dashboard's data layer at runtime.

   Sources, in priority order:
     1) Live web fetch (NSE/BSE/company sites) — currently disabled in
        the browser due to CORS. To enable, add a Cloudflare Pages
        Function (e.g. functions/api/proxy.js) that proxies whitelisted
        domains, then set window.PV_LIVE_PROXY = "/api/proxy" before
        loading this script.
     2) Cached JSON configs in data/config/*.json (the GitHub /
        Cloudflare-served cache layer).
     3) Graceful "Pending" UI state for any field still missing.

   The loader merges six JSON files into the same PV_DATA shape
   the dashboard already consumes — so the rest of the codebase
   does not need to know where the data came from.

   Public API:
     await window.PV_LOADER.loadAll()
        → { ok: true,  data: PV_DATA, meta: {...} }
        → { ok: false, error, partial?: PV_DATA }
   ================================================================= */
(function () {
  const CONFIG_BASE = "data/config/";
  const FILES = [
    "company_config.json",
    "vehicle_config.json",
    "placeholder_data.json",
    "logo_map.json",
    "image_map.json",
    "source_map.json",
  ];

  /* ---------- low-level fetch ---------- */
  async function fetchJSON(name, { required = false } = {}) {
    try {
      const r = await fetch(CONFIG_BASE + name, { cache: "no-cache" });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
      return await r.json();
    } catch (err) {
      if (required) throw new Error(`Required config "${name}" failed: ${err.message}`);
      console.warn(`[PV_LOADER] optional ${name} unavailable — falling back to "Pending":`, err.message);
      return null;
    }
  }

  /* ---------- live web fetch (proxy hook) ----------
     Currently a no-op. If window.PV_LIVE_PROXY is configured, an
     agent can call this to hit a server-side proxy that fetches
     whitelisted financial sources (NSE/BSE/company filings).
     Returns null on any failure so the cached value stands. */
  async function liveFetchMetric(_company, _metric) {
    if (!window.PV_LIVE_PROXY) return null;
    try {
      const url = `${window.PV_LIVE_PROXY}?company=${encodeURIComponent(_company)}&metric=${encodeURIComponent(_metric)}`;
      const r = await fetch(url, { cache: "no-cache" });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  /* ---------- overlay helpers ----------
     Each helper takes the placeholder rows and overlays values
     from a separate config map. Missing entries leave the row
     untouched (it stays "Pending"). */

  function overlayLogos(companyInfoRows, logoMap) {
    if (!logoMap) return;
    companyInfoRows.forEach(r => {
      const entry = logoMap[r.Company];
      if (entry && entry.url) {
        r.Logo_URL = entry.url;
        r.Logo_Source = entry.source || null;
        r.Logo_Source_URL = entry.source_url || null;
        if (entry.last_updated) r.Logo_Last_Updated = entry.last_updated;
      } else {
        r.Logo_URL = null;
      }
    });
  }

  function overlayImages(vehicleRows, imageMap) {
    if (!imageMap) return;
    vehicleRows.forEach(r => {
      const entry = imageMap[r.Company] && imageMap[r.Company][r.Vehicle];
      if (entry && entry.url) {
        r.Image_URL = entry.url;
        r.Image_Source = entry.source || null;
        r.Image_Source_URL = entry.source_url || null;
        if (entry.last_updated) r.Image_Last_Updated = entry.last_updated;
      } else {
        r.Image_URL = null;
      }
    });
  }

  function overlaySources(companyMetricRows, sourceMap) {
    if (!sourceMap) return;
    companyMetricRows.forEach(r => {
      const entry = sourceMap[r.Company] && sourceMap[r.Company][r.Metric];
      if (entry && entry.source) {
        r.Source = entry.source;
        r.Source_URL = entry.source_url || null;
        if (entry.last_updated) r.Last_Updated = entry.last_updated;
      }
    });
  }

  /* ---------- main entry ---------- */
  async function loadAll() {
    let companyCfg, vehicleCfg, placeholder, logoMap, imageMap, sourceMap;
    try {
      [companyCfg, vehicleCfg, placeholder, logoMap, imageMap, sourceMap] =
        await Promise.all([
          fetchJSON("company_config.json", { required: true }),
          fetchJSON("vehicle_config.json", { required: true }),
          fetchJSON("placeholder_data.json", { required: true }),
          fetchJSON("logo_map.json"),
          fetchJSON("image_map.json"),
          fetchJSON("source_map.json"),
        ]);
    } catch (err) {
      return { ok: false, error: err };
    }

    const companyMetrics  = (placeholder.company_fy_metrics  || []).map(r => ({ ...r }));
    const vehicleMetrics  = (placeholder.vehicle_fy_metrics  || []).map(r => ({ ...r }));
    const buysideSignals  = (placeholder.buyside_signals     || []).map(r => ({ ...r }));
    const companyInfo     = (placeholder.company_info        || []).map(r => ({ ...r }));
    const industryMetrics = (placeholder.industry_fy_metrics || []).map(r => ({ ...r }));

    overlayLogos(companyInfo, logoMap);
    overlayImages(vehicleMetrics, imageMap);
    overlaySources(companyMetrics, sourceMap);

    const data = {
      COMPANIES:           companyCfg.companies,
      FYS:                 companyCfg.fys,
      FYS_FULL:            companyCfg.fys_full,
      OEM_KPIS:            companyCfg.oem_kpis,
      INDUSTRY_KPIS:       companyCfg.industry_kpis,
      TREND_METRICS:       new Set(companyCfg.trend_metrics || []),
      DEFAULT_VEHICLES:    vehicleCfg.default_vehicles,
      BRANDS:              companyCfg.brands,
      TABS:                companyCfg.tabs,
      Company_FY_Metrics:  companyMetrics,
      Vehicle_FY_Metrics:  vehicleMetrics,
      BuySide_Signals:     buysideSignals,
      Company_Info:        companyInfo,
      Industry_FY_Metrics: industryMetrics,
    };

    return {
      ok: true,
      data,
      meta: {
        loaded_at: new Date().toISOString(),
        configs_loaded: {
          company_config:   !!companyCfg,
          vehicle_config:   !!vehicleCfg,
          placeholder_data: !!placeholder,
          logo_map:         !!logoMap,
          image_map:        !!imageMap,
          source_map:       !!sourceMap,
        },
        rows: {
          company_fy_metrics:  companyMetrics.length,
          vehicle_fy_metrics:  vehicleMetrics.length,
          buyside_signals:     buysideSignals.length,
          company_info:        companyInfo.length,
          industry_fy_metrics: industryMetrics.length,
        },
      },
    };
  }

  window.PV_LOADER = { loadAll, liveFetchMetric };
})();
