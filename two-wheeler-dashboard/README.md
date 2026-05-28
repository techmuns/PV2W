# 2W Industry Dashboard

Buy-side research dashboard for the Indian two-wheeler segment.

Mirrors the structure of the PV dashboard (`techmuns/neha`) — same header, company
selector, KPI row, buy-side signal box, model cards, supporting-data table + chart,
governance row, source panel and CSV export. Built standalone for now; the data
file and component shape are kept generic so the segment can later be merged
back into the parent auto dashboard.

## Companies

- Industry (aggregate)
- TVS Motor
- Bajaj Auto
- Hero MotoCorp
- Eicher Motors / Royal Enfield
- Ola Electric

## Stack

- Vite + React 18
- Tailwind CSS 3
- Recharts for the supporting-data line chart

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The static output is written to `dist/` and can be hosted on any static host.

## Deploy (Cloudflare Pages — Git integration)

Cloudflare watches the GitHub repo and rebuilds on every push to `main`.
No tokens, no GitHub Actions, no wrangler login needed.

One-time setup in the Cloudflare dashboard:

1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** tab → **Connect to Git**.
2. Authorize GitHub if prompted, then select `techmuns/two-wheeler-dashboard`.
3. Build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: *(leave blank)*
4. **Save and Deploy**.

The site goes live at `https://two-wheeler-dashboard.pages.dev` (or a
similar `*.pages.dev` subdomain — Cloudflare picks one if the name is
taken; you can rename it later under the project's Settings).

## Data

All numbers live in `src/data.js`. To merge this back into the parent auto
dashboard later, lift the `COMPANIES` array into the parent `data/` layer
and import per segment.
