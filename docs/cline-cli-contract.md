# Cline CLI & API contract (verified)

The behavioral contract this plugin's parsers and commands are built against, verified live
against `cline` 3.0.37 (`VERIFIED_CLINE_VERSION` in `plugins/cline/scripts/lib/setup.mjs`).
When re-verifying against a newer cline, update that constant and re-check every section here;
`/cline:setup` warns when the installed version differs from the verified one.

## CLI invocation

- One-shot headless Run:
  `cline --json [-P <provider>] [-m <model>] [-p] [-c <cwd>] [-t <seconds>] "<prompt>"`.
  Piped stdin is a documented pattern (`cat notes.md | cline --json ... "<prompt>"`) and is how
  the plugin forwards extra context.
- There is **no `--yolo` flag** in cline 3.x. Auto-approval (`--auto-approve`) defaults to
  `true`, so a writing Run needs no approval flag; plan mode (`-p`) is the no-writes path.
- `-t/--timeout` defaults to `0` (no timeout) — the dispatcher always passes an explicit
  timeout (600 s unless `--timeout` overrides it).
- `--id` (session resume) and `--worktree` exist but are out of scope per ADR-0001.

## NDJSON output schema (`--json`)

Each stdout line is one JSON object with a `type`:

- `hook_event` — lifecycle markers (`agent_start`, `agent_end`, `tool_call`, `tool_result`).
  They carry **no tool name or file path** — "files changed" must come from `git`, never from
  the stream.
- `agent_event` — streaming content (`.event.type`: `content_start` / `content_end` /
  `iteration_start` / `iteration_end` / `usage` / `done`).
- `run_result` — the final, authoritative line. Fields the parser uses: `finishReason`
  (`"completed"` = success), `text` (the summary), `aggregateUsage`/`usage` (`inputTokens`,
  `outputTokens`, `totalCost`), `model.id`, `model.provider`, `durationMs`, `iterations`.

Parser contract (`plugins/cline/scripts/lib/parse-ndjson.mjs`): tolerate malformed lines, use
the LAST `run_result`, treat its absence or `finishReason !== "completed"` as not-ok, count
`tool_call` hooks as tool activity. Fixture captured from a real run:
`plugins/cline/test/fixtures/delegate-success.ndjson`.

## Observed transport failures (cline 3.0.37)

Two transport-layer crash signatures have been observed in real Runs:

- `session not found`
- `hook dispatch failed: session.hook requires a valid hook event payload`, followed by
  `The operation timed out.`

In one real 15-task build, these signatures appeared in 6 of 15 Cline attempts, including solo
and concurrent Runs, and without correlation to the selected profile. The plugin policy is narrow:
if stdout contains a completed `run_result`, the completed Result is salvaged even when the CLI
exits non-zero; otherwise, a Run with one of these signatures is retried once and the retry is
called out visibly in the relayed output. Other failures are not retried.

Note that a retried writing Run re-executes the full task on a working tree that may already
contain the first attempt's partial writes; Cline generally converges on the existing work, but
the reviewed diff can be the union of both attempts.

The upstream root cause is unconfirmed.

## Providers: ClinePass is `cline-pass`, not `cline`

Empirically confirmed on a real account: `~/.cline/data/settings/providers.json` holds separate
`cline` and `cline-pass` provider entries. The `cline` provider routes to a different, metered
tier (observed model: `poolside/laguna-xs-2.1`); only `-P cline-pass` returns
`model.provider: "cline-pass"` and a `cline-pass/*` model, and only it spends the flat ClinePass
subscription. The CLI's own default provider is `cline` — which is why delegate/review always
pass `-P cline-pass` explicitly (ADR-0002).

There is **no programmatic model list** (REST `/models` 404s; `cline config --json` requires a
TTY). The bundled `plugins/cline/data/clinepass-models.json` snapshot is scraped from the
ClinePass docs and refreshed via `/cline:setup --refresh-models`.

## Auth

- Sign-in: `cline auth cline` (OAuth). The token is stored in
  `~/.cline/data/settings/providers.json` (`providers.<id>.settings.auth.accessToken` plus
  `auth.accountId`). Delegated Runs use the stored sign-in implicitly — the plugin passes no
  credential to the subprocess. Rotate by re-running `cline auth cline`.
- `cline auth` is **credential establishment only**, not a model switcher. Verified live on
  3.0.37: `cline auth --provider cline-pass --modelid <slug>` without `--apikey` always fails
  (`auth quick setup requires --apikey`) and mutates nothing. Per-Run model selection is
  `-P`/`-m`, surfaced by the plugin as `--model`/`--provider`/`--profile` (ADR-0003).

## ClinePass usage REST API

Base `https://api.cline.bot`; Bearer auth with the stored OAuth `accessToken` (a personal
ClinePass account works — enterprise is not required). Every response uses the envelope
`{ "success": true, "data": ... }`.

- `GET /api/v1/users/me` → `data: { id, email, displayName, organizations, ... }`.
- `GET /api/v1/users/{id}/balance` → `data: { userId, balance }` — `balance` is a **single
  integer** (credits); there are no window fields.
- `GET /api/v1/users/{id}/usages` → `data: { items, nextToken, total }` — **paginated**. Items
  carry `createdAt`, `creditsUsed`, `costUsd` (micro-dollars: `42348` ≈ $0.042), `aiModelName`,
  and prompt/completion/total/cached token counts.
- **Pagination**: request the next page with `?cursor=<nextToken-value>`. Other parameter names
  (`nextToken`, `pageToken`, `page`, `after`) are **silently ignored** — the API re-returns
  page 1. End of pagination is a `nextToken` of `null` **or** `""` — treat both as the end (a
  strict `!= null` check under-detects it). Observed default page size: 10 items.
- The ClinePass 5-hour / weekly / monthly rate-limit windows are **not exposed by the API** —
  they live on the dashboard (app.cline.bot/dashboard/subscription). `/cline:usage` therefore
  computes 24h/7d/30d summaries by summing items and labels them partial when the page cap cuts
  off history.

Sanitized fixtures: `plugins/cline/test/fixtures/usage-{me,balance,usages}.json`.
