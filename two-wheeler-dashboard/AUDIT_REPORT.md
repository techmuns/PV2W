# Two-Wheeler Dashboard — Data Audit

_Generated 2026-05-28T07:07:58.298Z by `scripts/audit-data.mjs`._

This audit reads every per-OEM JSON, computes coverage, runs accounting cross-checks (e.g. EBITDA margin = EBITDA / Revenue, FCF = CFO − Capex, Net debt = Total debt − Cash) and flags discrepancies > tolerance.

## 1. Coverage summary

| OEM | Basis | fyAxis | P&L cells | BS cells | CF cells | Ops cells | Metrics cells | Verification |
|---|---|---|---|---|---|---|---|---|
| **tvs** | Standalone | 10 FYs | 80/80 | 90/90 | 50/50 | 64/70 | 169/190 | audited (curated AR text) |
| **bajaj** | Standalone | 10 FYs | 80/80 | 90/90 | 50/50 | 64/80 | 177/190 | audited (curated AR text) |
| **hero** | Standalone | 10 FYs | 80/80 | 90/90 | 50/50 | 21/70 | 174/190 | audited (curated AR text) |
| **eicher** | Consolidated | 10 FYs | 72/80 | 36/40 | 45/50 | 0/10 | 80/100 | audited (Screener sidecar) |
| **ola** | Consolidated | 10 FYs | 40/80 | 20/40 | 25/50 | 0/10 | 38/100 | audited (Screener sidecar) |

## 2. P&L coverage by FY

| OEM | FY16 | FY17 | FY18 | FY19 | FY20 | FY21 | FY22 | FY23 | FY24 | FY25 |
|---|---|---|---|---|---|---|---|---|---|---|
| tvs | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| bajaj | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| hero | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| eicher | ⚪ | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| ola | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |

Legend: 🟢 full · 🟡 partial · ⚪ none · · no block

## 3. Operations coverage by FY

| OEM | FY16 | FY17 | FY18 | FY19 | FY20 | FY21 | FY22 | FY23 | FY24 | FY25 |
|---|---|---|---|---|---|---|---|---|---|---|
| tvs | 🟡5/6 | 🟡5/6 | 🟡5/6 | 🟡5/6 | 🟡5/6 | 🟡5/6 | 🟢 | 🟢 | 🟢 | 🟢 |
| bajaj | 🟡5/6 | 🟡5/6 | 🟡5/6 | 🟡5/6 | 🟡5/6 | 🟡5/6 | 🟢 | 🟢 | 🟢 | 🟢 |
| hero | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | 🟡5/6 | 🟢 |
| eicher | · | · | · | · | · | · | · | · | · | · |
| ola | · | · | · | · | · | · | · | · | · | · |

## 4. Accounting cross-checks

### tvs — 100 PASS · 0 FAIL · 100 total

_All 100 computable checks pass within tolerance._

### bajaj — 100 PASS · 0 FAIL · 100 total

_All 100 computable checks pass within tolerance._

### hero — 92 PASS · 0 FAIL · 92 total

_All 92 computable checks pass within tolerance._

### eicher — 63 PASS · 0 FAIL · 63 total

_All 63 computable checks pass within tolerance._

### ola — 32 PASS · 0 FAIL · 32 total

_All 32 computable checks pass within tolerance._

## 5. Source provenance

| OEM | Primary source | Notes |
|---|---|---|
| tvs | TVS Motor Company Annual Reports FY16–FY25 (standalone audited) + audited Q4 result packages | Derived items (EBITDA, EBIT, FCF, ratios, margins) computed from disclosed line items. No estimates used. Consolidated T |
| bajaj | Bajaj Auto Limited Annual Reports FY2015-16 through FY2024-25 (9th-18th Annual Reports), standalone audited financial statements, sourced fr | Standalone basis (not Consolidated). Consolidated KTM / PBAG / BACL / BATL financials excluded. EBITDA derived = PBT + F |
| hero | Hero MotoCorp Limited Annual Reports FY2015-16 through FY2024-25, Standalone audited financial statements, sourced from BSE (scripcode 50018 | Hero MotoCorp standalone has effectively no debt — only Ind AS 116 lease liabilities are reported under financial liabil |
| eicher | Consolidated financials from exchange filings (BSE/NSE). | Financials from exchange filings. Volumes / market share added from annual reports where available. |
| ola | Consolidated financials from exchange filings (BSE/NSE). | Financials from exchange filings. Volumes / market share added from annual reports where available. |

## 6. Anomaly flags

- **ola** FY22 revenue +37200.0% YoY (verify — large swing)
- **ola** FY23 revenue +605.4% YoY (verify — large swing)
- **ola** FY24 revenue +90.4% YoY (verify — large swing)

## 7. Pending / not-applicable cells

**tvs**
- Export Revenue %
- Capacity Utilisation %
- New Model Launches
- Facelift Launches
- Top Selling Model
- Stock Price 31-Mar

**bajaj**
- Gross Margin (cost-of-materials disclosed but excludes traded-goods purchase + COGS not separately reconciled)
- Capacity Utilisation %
- Stock Price 31-Mar
- Model-wise volume split (Pulsar / CT / Platina / Avenger / Dominar / Freedom)

**hero**
- Mopeds (Hero does not manufacture)
- Three-wheelers (Hero does not manufacture)
- Motorcycle / scooter / export volume split for FY16–FY23 (Hero standalone ARs disclose only total two-wheeler units for these years; the split requires SIAM / JATO subscription data)
- Export Revenue % by FY pre-FY24
- Capacity Utilisation %
- Top Selling Model unit count
- Stock Price 31-Mar

**eicher**
- Volume splits (M / S / Mo / 3W)
- EV / iQube volume
- 2W exports
- Market share (overall + CC-slab)
- KMP, employees, dealers, credit rating

**ola**
- Volume splits (M / S / Mo / 3W)
- EV / iQube volume
- 2W exports
- Market share (overall + CC-slab)
- KMP, employees, dealers, credit rating
