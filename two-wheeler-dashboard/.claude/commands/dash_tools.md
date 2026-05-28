---
description: Wire a Dash data tool (get_concalls, get_annual_reports, get_credit_rating, ...) into the dashboard via a five-phase playbook — token-as-secret, GitHub Actions bootstrap, JSON parser + 1:1 dashboard mapping, Cloudflare Worker proxy, UI.
---

You are an AI coding agent with full access to the working tree, a shell, and git. Your job is to wire a **Dash data tool** into the dashboard repo I'm currently in. Tools are JSON REST endpoints on the dashtools Worker; one slash command, many tools, same playbook. Follow the five-phase flow below. The bootstrap workflow + sample output stay committed — no teardown phase.

**Key principle:** the Dash bearer token is NEVER hardcoded and NEVER shipped in the client bundle. It lives only as a secret:

- `DASH_TOKEN` — Cloudflare Worker secret binding (runtime, used by the server-side proxy route — **same Worker as MUNS, different secret**)
- `DASH_TOKEN` — GitHub Actions repo secret (one-time bootstrap workflow)

## First-turn behaviour

Do not run any commands or read files until I've told you which tool I want.

- If I ask what this prompt does, summarise the five phases in 4–6 bullets, list the available tools (below), and ask "Which tool? (`get_concalls` / `get_annual_reports` / `get_credit_rating`)". No tool calls.
- If my first message already names a tool + the required ticker, go straight to Phase 1.
- If I just say "start", ask which tool.

## Available tools

All three live on the same host `https://screeer-tools.amazon-review-radar-489675.workers.dev`. Add new tools by appending here — same shape (name, path, body schema, required param).

### `get_concalls`

```
POST https://screeer-tools.amazon-review-radar-489675.workers.dev/get_concalls
Authorization: Bearer <DASH_TOKEN>
Content-Type: application/json
{ "ticker": "<USER_INPUT>" }
```

Required from user: `ticker`.

### `get_annual_reports`

```
POST https://screeer-tools.amazon-review-radar-489675.workers.dev/get_annual_reports
Authorization: Bearer <DASH_TOKEN>
Content-Type: application/json
{ "ticker": "<USER_INPUT>" }
```

Required from user: `ticker`.

### `get_credit_rating`

```
POST https://screeer-tools.amazon-review-radar-489675.workers.dev/get_credit_rating
Authorization: Bearer <DASH_TOKEN>
Content-Type: application/json
{ "ticker": "<USER_INPUT>" }
```

Required from user: `ticker`.

## Phase 1 — Pick the tool + collect params

1. Confirm the tool name from the user's request.
2. Ask interactively for the required `ticker`. Don't assume.
3. Echo back the resolved request body so the user can correct typos before we burn an API call.

## Phase 2 — Token (secret, never hardcoded)

**Different token from `/munshot_*`** — Dash uses `DASH_TOKEN`, MUNS uses `MUNS_ACCESS_TOKEN`. Both live in the same dashboard Worker. Before asking me to set up anything, sniff the repo for signs `DASH_TOKEN` is already wired from a prior `/dash_tools` run:

- `git grep -l 'secrets.DASH_TOKEN' .github/workflows/` — any hit means the GitHub Actions secret was already used; it almost certainly still exists. Confirm with me, don't re-instruct.
- `git grep -l 'DASH_TOKEN' worker/` — any hit means the Cloudflare Worker binding is already declared. Confirm with `npx wrangler secret list` if available.

If both signals are present, say "DASH_TOKEN already configured from a prior /dash_tools run, skipping setup" and move on. Otherwise instruct me to create them:

1. **GitHub Actions secret** `DASH_TOKEN` — repo Settings → Secrets and variables → Actions → New repository secret. Used by Phase 3.
2. **Cloudflare Worker secret** `DASH_TOKEN` — `npx wrangler secret put DASH_TOKEN` or Cloudflare dashboard → Worker → Settings → Variables and Secrets. Used by Phase 5.

Never write the token value to any file, `.env`, or `.env.example`.

## Phase 3 — Bootstrap a sample output via GitHub Actions

Coding-agent sandboxes can't reach the dashtools host. Capture one real JSON response via Actions:

1. Stable filename: `dash-outputs/tool-<toolname>-<tickerslug>.json` (tickerslug = lowercased ticker, e.g. `tool-get_concalls-reliance.json`, `tool-get_annual_reports-nestleind.json`).
2. Write `.github/workflows/dash-tool-fetch.yml`:
   - `workflow_dispatch` with inputs `tool` and `ticker`.
   - `ubuntu-latest`, `curl -s -o <slug> -w "%{http_code}" -X POST` the matching endpoint with `Authorization: Bearer ${{ secrets.DASH_TOKEN }}` and the JSON body from Phase 1.
   - Fail the job if the HTTP code is not 2xx (`[[ "$code" =~ ^2 ]] || exit 1`).
   - Commit + push the JSON file (git config as `github-actions[bot]`, auto `GITHUB_TOKEN`).
3. Tell me: push the branch, open Actions → dash-tool-fetch → Run workflow (supply `tool` + `ticker`), wait for green, `git pull`.

Do not proceed until the JSON file is on disk and the run was 2xx. If the run returns non-2xx, surface the failure (including the response body if Actions captured it) and stop.

## Phase 4 — Read the sample, generate types + dashboard mapping plan

1. Read `dash-outputs/tool-<toolname>-<tickerslug>.json`. Validate it parses as JSON; fail loudly if it doesn't.
2. Write `src/lib/dashTools.ts` with one function per tool, each calling the same-origin proxy (Phase 5), not the dashtools host directly:
   ```ts
   export async function getConcalls(ticker: string) {...}
   export async function getAnnualReports(ticker: string) {...}
   export async function getCreditRating(ticker: string) {...}
   ```
3. From the sample JSON, generate a TypeScript interface for the response (`ConcallsResponse`, `AnnualReportsResponse`, `CreditRatingResponse`). Export from `src/lib/dashTools.ts`.
4. **Dashboard mapping plan** — read 2–3 existing dashboard components first to learn the data shape they expect. Then write a 1:1 mapping table in chat as part of your reply:
   ```
   API field                              → Dashboard field
   response.concalls[].date               → ConcallRow.date
   response.concalls[].transcript_url     → ConcallRow.href
   ```
   Tell me exactly which fields came from where. If a dashboard field has no API source, flag it; if an API field has no dashboard home, ask whether to surface it.
5. If a per-tool mapper helps (e.g. `concallsToRows.ts`, `ratingToBadge.ts`), write it. Keep mappers pure and testable.

## Phase 5 — Runtime UI via server-side proxy

The browser must NOT hold the token. Route Dash tool calls through the dashboard's own Cloudflare Worker:

1. **Proxy route.** Add (or extend) `worker/index.ts`. **If `worker/index.ts` already exists with `/api/muns/...` routes from `/munshot_*` (or any other routes), keep them all and add the dash routes alongside. Share the same `env.ASSETS`; use a *different* secret binding `env.DASH_TOKEN`. Do not replace the file or remove existing routes.** Recommended endpoint:
   - `POST /api/dash/tools/<toolname>` — read body, forward to `https://screeer-tools.amazon-review-radar-489675.workers.dev/<toolname>` with `Authorization: Bearer ${env.DASH_TOKEN}`, return the upstream response (preserve status + JSON body).
   - For unknown tool names, return `400`.
   - For everything else, `return env.ASSETS.fetch(request)`.
   - Type `env` with `DASH_TOKEN: string`, any existing `MUNS_ACCESS_TOKEN: string`, and `ASSETS: Fetcher`.
2. **Dashboard UI per tool.** Default surface per tool — override only if the existing dashboard has a strong opinion:
   - `get_concalls` → list of concall items (date + transcript link) on the ticker-detail page.
   - `get_annual_reports` → list of annual report items (year + PDF link) on the ticker-detail page.
   - `get_credit_rating` → compact rating badge / panel on the ticker overview.
3. **Match dashboard style.** Read 2–3 existing components before writing new ones. Reuse the dashboard's list/card primitives instead of inventing new ones.
4. **Tell the user what's wired.** Once the UI compiles, output a short report:
   - Which endpoint was called.
   - Which dashboard surface it populates.
   - Which response fields are now visible, which are dropped, and why.

## Hard rules

- Token (`DASH_TOKEN`) only ever exists as the two secrets. Never in source, `.env`, `.env.example`, or the client bundle.
- These endpoints return **JSON**. Use `JSON.parse`. Do not reuse `munsParse.ts` from `/munshot_agent`.
- The bootstrap workflow (`.github/workflows/dash-tool-fetch.yml`) and `dash-outputs/tool-*.json` stay committed — they are useful for re-capturing samples on demand. No teardown.
- **Do not touch** MUNS files: `.github/workflows/munshot-fetch.yml`, `.github/workflows/munshot-tool-fetch.yml`, `munshot-outputs/`. Those belong to `/munshot_agent` and `/munshot_tools`.
- Browser → same-origin `/api/dash/tools/<toolname>` only. The dashtools host appears only in the Worker.
- One tool wired per invocation. Do not bulk-wire multiple tools in one run unless explicitly told.
- Match the dashboard's existing visual style; read its components before writing new ones.
- If the dashboard has no Cloudflare Worker / server layer, tell me — we either add a minimal Worker or fall back to a build-time env var (and you must warn me that route ends up in the client bundle).

## Adding a new tool to this prompt

When dashtools ships a new endpoint, append a section under **Available tools** with:
- Name (snake_case).
- HTTP method + full URL.
- Body schema with placeholders.
- Required user-supplied params.

No code in this prompt body needs to change — Phase 3's workflow and Phase 5's proxy are tool-name-parameterised.

---

End of prompt. Acknowledge in one sentence, list the available tools, and ask which one I want. No tool calls yet.
