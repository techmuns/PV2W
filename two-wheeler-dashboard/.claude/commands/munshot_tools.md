---
description: Wire a MUNS data tool (get_financials, ticker_search, ...) into the dashboard via a five-phase playbook — token-as-secret, GitHub Actions bootstrap, JSON parser + 1:1 dashboard mapping, Cloudflare Worker proxy, UI.
---

You are an AI coding agent with full access to the working tree, a shell, and git. Your job is to wire a MUNS **data tool** into the dashboard repo I'm currently in. Tools are JSON REST endpoints; one slash command, many tools, same playbook. Follow the five-phase flow below. The bootstrap workflow + sample output stay committed — no teardown phase.

**Key principle:** the MUNS bearer token is NEVER hardcoded and NEVER shipped in the client bundle. It lives only as a secret:

- `MUNS_ACCESS_TOKEN` — Cloudflare Worker secret binding (runtime, used by the server-side proxy route)
- `MUNS_ACCESS_TOKEN` — GitHub Actions repo secret (one-time bootstrap workflow)

## First-turn behaviour

Do not run any commands or read files until I've told you which tool I want.

- If I ask what this prompt does, summarise the five phases in 4–6 bullets, list the available tools (below), and ask "Which tool? (`get_financials` / `ticker_search`)". No tool calls.
- If my first message already names a tool + the required params, go straight to Phase 1.
- If I just say "start", ask which tool.

## Available tools

Add new tools by appending here — same shape (name, method+URL, body schema, required param).

### `get_financials`

```
POST https://devde.muns.io/filings/combined_financials
Authorization: Bearer <MUNS_ACCESS_TOKEN>
Content-Type: application/json
{
  "ticker": "<USER_INPUT>",
  "country": "India",
  "q": "consolidated",
  "period": "annual"
}
```

Required from user: `ticker`. Optional overrides: `country`, `q` (`consolidated` | `standalone`), `period` (`annual` | `quarterly`).

### `ticker_search`

```
POST https://devde.muns.io/stock/search
Authorization: Bearer <MUNS_ACCESS_TOKEN>
Content-Type: application/json
{ "query": "<USER_INPUT>" }
```

Required from user: `query` (free-text company/ticker name).

## Phase 1 — Pick the tool + collect params

1. Confirm the tool name from the user's request.
2. Ask interactively for the required param (`ticker` or `query`). Don't assume defaults for required params.
3. Echo back the resolved request body so the user can correct typos before we burn an API call.

## Phase 2 — Token (secret, never hardcoded)

**Shared with `/munshot_agent`** — both commands use the same `MUNS_ACCESS_TOKEN` in the same two places. Before asking me to set up anything, sniff the repo for signs it's already wired from a prior `/munshot_agent` (or earlier `/munshot_tools`) run:

- `git grep -l 'secrets.MUNS_ACCESS_TOKEN' .github/workflows/` — any hit means the GitHub Actions secret was already used; it almost certainly still exists. Confirm with me, don't re-instruct.
- `git grep -l 'MUNS_ACCESS_TOKEN' worker/` — any hit means the Cloudflare Worker binding is already declared. Confirm with `npx wrangler secret list` if available.

If both signals are present, say "token already configured from a prior MUNS command, skipping setup" and move on. Otherwise instruct me to create them:

1. **GitHub Actions secret** `MUNS_ACCESS_TOKEN` — repo Settings → Secrets and variables → Actions → New repository secret. Used by Phase 3.
2. **Cloudflare Worker secret** `MUNS_ACCESS_TOKEN` — `npx wrangler secret put MUNS_ACCESS_TOKEN` or Cloudflare dashboard → Worker → Settings → Variables and Secrets. Used by Phase 5.

Never write the token value to any file, `.env`, or `.env.example`.

## Phase 3 — Bootstrap a sample output via GitHub Actions

Coding-agent sandboxes can't reach the MUNS API (`host_not_allowed`). Capture one real JSON response via Actions:

1. Stable filename: `munshot-outputs/tool-<toolname>-<paramslug>.json` (paramslug = lowercased + dashed ticker/query, e.g. `tool-get_financials-jiofin.json`, `tool-ticker_search-apple.json`).
2. Write `.github/workflows/munshot-tool-fetch.yml`:
   - `workflow_dispatch` with inputs `tool` and `param`.
   - `ubuntu-latest`, `curl -s -o <slug> -w "%{http_code}" -X POST` the matching endpoint with `Authorization: Bearer ${{ secrets.MUNS_ACCESS_TOKEN }}` and the JSON body from Phase 1.
   - Fail the job if the HTTP code is not 2xx (`[[ "$code" =~ ^2 ]] || exit 1`).
   - Commit + push the JSON file (git config as `github-actions[bot]`, auto `GITHUB_TOKEN`).
3. Tell me: push the branch, open Actions → munshot-tool-fetch → Run workflow (supply `tool` + `param`), wait for green, `git pull`.

Do not proceed until the JSON file is on disk and the run was 2xx. If the run returns non-2xx, surface the failure (including the response body if Actions captured it) and stop.

## Phase 4 — Read the sample, generate types + dashboard mapping plan

1. Read `munshot-outputs/tool-<toolname>-<paramslug>.json`. Validate it parses as JSON; fail loudly if it doesn't.
2. Write `src/lib/munsTools.ts` with one function per tool, each calling the same-origin proxy (Phase 5), not the MUNS host directly:
   ```ts
   export async function getFinancials(ticker: string, overrides?: Partial<{country: string; q: string; period: string}>) {...}
   export async function tickerSearch(query: string) {...}
   ```
3. From the sample JSON, generate a TypeScript interface for the response (`FinancialsResponse`, `TickerSearchResponse`). Export from `src/lib/munsTools.ts`.
4. **Dashboard mapping plan** — read 2–3 existing dashboard components first to learn the data shape they expect. Then write a 1:1 mapping table in chat as part of your reply:
   ```
   API field                          → Dashboard field
   response.results[].symbol          → SearchResult.ticker
   response.results[].company_name    → SearchResult.label
   response.results[].exchange        → SearchResult.market
   ```
   Tell me exactly which fields came from where. If a dashboard field has no API source, flag it; if an API field has no dashboard home, ask whether to surface it.
5. If a per-tool mapper helps (e.g. `financialsToRows.ts`, `searchToOptions.ts`), write it. Keep mappers pure and testable.

## Phase 5 — Runtime UI via server-side proxy

The browser must NOT hold the token. Route MUNS tool calls through the dashboard's own Cloudflare Worker:

1. **Proxy route.** Add (or extend) `worker/index.ts`. **If `worker/index.ts` already exists with a `/api/muns/run` route (from `/munshot_agent`), keep it and add the tools route alongside — share the same `env.MUNS_ACCESS_TOKEN` binding. Do not replace the file or remove existing routes.** Recommended endpoint:
   - `POST /api/muns/tools/<toolname>` — read body, forward to the matching MUNS URL with `Authorization: Bearer ${env.MUNS_ACCESS_TOKEN}`, return the upstream response (preserve status + JSON body).
   - For unknown tool names, return `400`.
   - For everything else, `return env.ASSETS.fetch(request)`.
   - Type `env` with `MUNS_ACCESS_TOKEN: string` and `ASSETS: Fetcher`.
2. **Dashboard UI per tool.** Default surface per tool — override only if the existing dashboard has a strong opinion:
   - `get_financials` → a table/card panel mounted in the ticker-detail page. Columns inferred from the response's keys; rows from the response's series. Add a "Refresh" button that calls `getFinancials(currentTicker)`.
   - `ticker_search` → an autocomplete input mounted in the header. Debounced 250 ms. Calls `tickerSearch(query)`, renders `SearchResult` rows, click selects a ticker and navigates.
3. **Match dashboard style.** Read 2–3 existing components before writing new ones. Reuse the dashboard's list/card primitives instead of inventing new ones.
4. **Tell the user what's wired.** Once the UI compiles, output a short report:
   - Which endpoint was called.
   - Which dashboard surface it populates.
   - Which response fields are now visible, which are dropped, and why.

## Hard rules

- Token only ever exists as the two secrets. Never in source, `.env`, `.env.example`, or the client bundle.
- These endpoints return **JSON**, not the `<ans>...</ans>` markdown shape from `/munshot_agent`. Do not reuse `munsParse.ts`.
- The bootstrap workflow (`.github/workflows/munshot-tool-fetch.yml`) and `munshot-outputs/tool-*.json` stay committed — they are useful for re-capturing samples on demand. No teardown.
- Browser → same-origin `/api/muns/tools/<toolname>` only. The MUNS hostname appears only in the Worker.
- One tool wired per invocation. Do not bulk-wire multiple tools in one run unless explicitly told.
- Match the dashboard's existing visual style; read its components before writing new ones.
- If the dashboard has no Cloudflare Worker / server layer, tell me — we either add a minimal Worker or fall back to a build-time env var (and you must warn me that route ends up in the client bundle).

## Adding a new tool to this prompt

When MUNS ships a new endpoint, append a section under **Available tools** with:
- Name (snake_case).
- HTTP method + full URL.
- Body schema with placeholders.
- Required user-supplied params.

No code in this prompt body needs to change — Phase 3's workflow and Phase 5's proxy are tool-name-parameterised.

---

End of prompt. Acknowledge in one sentence, list the available tools, and ask which one I want. No tool calls yet.
