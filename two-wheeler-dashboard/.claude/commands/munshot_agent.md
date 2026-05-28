---
description: Wire a MUNS-powered news/chat panel into a dashboard via the five-phase Munshot playbook (token-as-secret, GitHub Actions bootstrap, parser, Cloudflare Worker proxy, UI).
---

You are an AI coding agent with full access to the working tree, a shell, and git. Your job is to wire a MUNS-powered news/chat panel into the dashboard repo I'm currently in. Follow the five-phase playbook below. The bootstrap workflow + sample output stay committed — no teardown phase.

**Key principle:** the MUNS bearer token is NEVER hardcoded and NEVER shipped in the client bundle. It lives only as a secret:

- `MUNS_ACCESS_TOKEN` — a Cloudflare Worker secret binding (used at runtime by a server-side proxy route)
- `MUNS_ACCESS_TOKEN` — a GitHub Actions repo secret (used only by the one-time bootstrap workflow)

## First-turn behaviour

Do not start running commands or reading files until I've told you what I want.

- If I ask what this prompt does, summarise the five phases in 4–6 bullets, then ask "Want to start? (chat or agent?)". No tool calls.
- If my first message already names chat/agent + the prompt/UUID, go straight to Phase 1.
- If I just say "start", ask: chat or agent?

## Background — the two MUNS endpoints

Both return the same body shape: a text response with one `<ans>...</ans>` block containing a markdown table. One parser handles both.

### Agent — pre-baked sector/topic UUIDs

```
POST https://devde.muns.io/agents/run
Authorization: Bearer <MUNS_ACCESS_TOKEN>
Content-Type: application/json
{ "agent_library_id": "<UUID>",
  "metadata": { "stock_ticker": "JIOFIN", "stock_company_name": "Jio Financial Services Ltd.",
    "context_company_name": "Jio Financial Services Ltd.", "stock_country": "INDIA",
    "to_date": "<YYYY-MM-DD>", "timezone": "UTC" } }
```

### Chat — free-text prompt

```
POST https://devde.muns.io/chat/chat-muns
Authorization: Bearer <MUNS_ACCESS_TOKEN>
Content-Type: application/json
{ "tasks": ["<your prompt>"],
  "query_context": { "WEB_SEARCH_ENABLED": true, "mode": "fast", "chatHistory": [] },
  "autoAddUpcoming": false, "urls": [] }
```

## Phase 1 — Pick the surface

Decide chat vs agent. For agent → ask for the `agent_library_id` UUID + any metadata overrides. For chat → ask for the prompt text.

## Phase 2 — Token (secret, never hardcoded)

**Shared with `/munshot_tools`** — both commands use the same `MUNS_ACCESS_TOKEN` in the same two places. Before asking me to set up anything, sniff the repo for signs it's already wired from a prior `/munshot_tools` (or earlier `/munshot_agent`) run:

- `git grep -l 'secrets.MUNS_ACCESS_TOKEN' .github/workflows/` — any hit means the GitHub Actions secret was already used; it almost certainly still exists. Confirm with me, don't re-instruct.
- `git grep -l 'MUNS_ACCESS_TOKEN' worker/` — any hit means the Cloudflare Worker binding is already declared. Confirm with `npx wrangler secret list` if available.

If both signals are present, say "token already configured from a prior MUNS command, skipping setup" and move on. Otherwise instruct me to create them:

1. **GitHub Actions secret** `MUNS_ACCESS_TOKEN` — repo Settings → Secrets and variables → Actions → New repository secret. Used by Phase 3.
2. **Cloudflare Worker secret** `MUNS_ACCESS_TOKEN` — via `npx wrangler secret put MUNS_ACCESS_TOKEN` or the Cloudflare dashboard → Worker → Settings → Variables and Secrets. Used by Phase 5.

Never write the token value to any file, `.env`, or `.env.example`.

## Phase 3 — Bootstrap a sample output via GitHub Actions

Coding-agent sandboxes can't reach the MUNS API (`host_not_allowed`). Capture one real response via Actions:

1. Stable filename: agent → `munshot-outputs/agent-<uuid>.txt`; chat → `munshot-outputs/chat-<slug>.txt`.
2. Write `.github/workflows/munshot-fetch.yml`: `workflow_dispatch`, `ubuntu-latest`, `curl -i -X POST` the chosen endpoint with `Authorization: Bearer ${{ secrets.MUNS_ACCESS_TOKEN }}`, pipe full response to the slug path, then commit + push it (git config as `github-actions[bot]`, auto `GITHUB_TOKEN`).
3. Tell me: push the branch, open Actions → munshot-fetch → Run workflow, wait for the green check, `git pull`.

Do not proceed until the file is on disk. If the run returns non-2xx, surface the failure and stop.

## Phase 4 — Read the sample, build the parser

1. Read `munshot-outputs/<slug>.txt`; confirm an `<ans>...</ans>` markdown table.
2. If a `MunsRenderer.tsx` exists in the repo, treat it as reference only — never import it. Write a fresh minimal `src/lib/munsParse.ts`:
   - Locate the markdown separator row (`|---|---|...`).
   - Header = the line before it (strip `<ans>` prefix + `**`).
   - Walk forward, accept pipe-bearing lines as data rows; stop at `</ans>` / `</task>` / `<summary>` / any tag-only line.
   - Tolerate cell-count mismatches (pad short, truncate long).
3. If the dashboard has a `NewsItem`-like type, write a `munsToNews.ts` mapper (sentiment from `Impact`, theme from `News Type` + headline, sourceType from `Source`).

## Phase 5 — Runtime UI via a server-side proxy

The browser must NOT hold the token. Route MUNS calls through the dashboard's own Cloudflare Worker:

1. **Add a Worker proxy route.** If the repo serves static assets via `wrangler.toml` `[assets]`, add a Worker entry: set `main = "worker/index.ts"`, keep `[assets]` with `binding = "ASSETS"`. **If `worker/index.ts` already exists with a `/api/muns/tools/<toolname>` route (from `/munshot_tools`), keep it and add the `/api/muns/run` route alongside — share the same `env.MUNS_ACCESS_TOKEN` binding. Do not replace the file or remove existing routes.** In `worker/index.ts`, the `fetch` handler:
   - For `POST /api/muns/run`: read `{ endpoint, body }` from the request, forward to the matching MUNS URL with `Authorization: Bearer ${env.MUNS_ACCESS_TOKEN}`, return the raw text response.
   - For everything else: `return env.ASSETS.fetch(request)`.
   - Type `env` with `MUNS_ACCESS_TOKEN: string` and `ASSETS: Fetcher`.
2. **Add the UI.** A small button (style-matched to the dashboard — read 2–3 existing components first) + a scrollable output panel. The button calls the same-origin `/api/muns/run` route — no token, no CORS, no third-party call from the browser. Parse the proxy's text response with `munsParse.ts`. If the dashboard has a news/list component, route rows through it so click-to-detail + aggregates keep working; else render a minimal list (colored dot · headline · short date `MAR-27` · outlink icon).
3. **Mounting:** per-subject if the dashboard has a current sector/ticker/page; else global header with one shared panel. Multi-subject → a `SECTOR_AGENTS` map + a "Sync all" header button (concurrency cap 5).

If the dashboard has no Cloudflare Worker / server layer at all, tell me — we either add a minimal Worker, or fall back to a build-time env var (and you must warn me it ends up in the client bundle).

## Hard rules

- Token only ever exists as the two secrets. Never in source, `.env`, `.env.example`, or the client bundle.
- Never copy or import `MunsRenderer.tsx` — extract minimal parser logic into a fresh file.
- The bootstrap workflow (`.github/workflows/munshot-fetch.yml`) and `munshot-outputs/` stay committed — they are useful for re-capturing samples on demand. No teardown.
- Browser → same-origin `/api/muns/*` only. The MUNS hostname appears only in the Worker.
- Match the dashboard's existing visual style; read its components before writing new ones.

## Reference — response body shape

```
HTTP/2 200
...headers...
<task>...<tool>...</tool>...
<ans>| Date | Investor-Relevant Headline | Source | Segment | News Type | Companies Impacted | Key Datapoint / Event | Why It Matters | Impact | Link |
|---|---|---|---|---|---|---|---|---|---|
| 2026-04-28 | ... | ET Defence | ... | ... | ... | ... | ... | Positive | https://... |</ans>
</task>
```

Match columns defensively — find each by substring in the lowercased column name (headline = contains "headline" or "investor").

---

End of prompt. Acknowledge in one sentence, then ask chat or agent. No tool calls yet.
