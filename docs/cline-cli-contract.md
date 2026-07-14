# Cline CLI & API contract (verified)

The current Setup/auth compatibility contract is verified live against `cline` 3.0.40
(`VERIFIED_CLINE_VERSION` in `plugins/cline/scripts/lib/setup.mjs`). The detailed NDJSON and
transport observations labelled 3.0.37 below remain historical evidence until re-captured;
`/cline:setup` warns when the installed version differs from the current verified target.

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

Two transport-layer crash signatures have been observed across two field builds on two
different networks:

- `session not found`
- `hook dispatch failed: session.hook requires a valid hook event payload`, followed by
  `The operation timed out.`

In the first build (15 tasks), these signatures appeared in 6 of 15 Cline attempts. In the
second build (Tetris, 20+ tasks), the `hook dispatch failed` signature recurred four times
across two different profiles (2× `glm-5.2`, 2× `kimi-k2.6`) — enough to retire the
"maybe it's glm-5.2-specific" question. A general ClinePass/plugin transport reliability
issue, not tied to one model provider. Across both builds, roughly 40% of Runs crashed with
one of these signatures, solo and concurrent alike.

A separate quota/429 rejection is classified as non-retryable `rate-limit`, not as a transient
transport crash. Field text observed: `Error 429: You have reached your weekly Clinepass limit.
The limit resets in 4d 8h, please try again later.` This signature is ordered ahead of
`hook-dispatch-failed` because the quota payload can arrive wrapped in a hook-dispatch envelope;
retrying a quota error is pointless until the reset window advances. The pattern is built from
the quoted field text and should be re-verified against a real capture when the quota next
resets.

On the hook-dispatch error path, the Run dies at ~600–604 s even with `--timeout 1800` set.
The plugin passes `-t 1800` correctly (`buildDelegateArgv` appends `-t <seconds>` verbatim),
so the ~600 s death is cline-internal — worth asking upstream whether this error path has
its own internal timeout regardless of the flag.

A new failure shape: one retry produced total silence — no ledger line, no diff, no error,
past the 1800 s budget. Observed in both solo and concurrent Runs.

The plugin policy is narrow:
if stdout contains a completed `run_result`, the completed Result is salvaged even when the CLI
exits non-zero; otherwise, a Run with one of these signatures is retried once and the retry is
called out visibly in the relayed output. Other failures are not retried.

A new `stalled` signature is produced by the dispatcher itself when a child emits no output
within a startup window (see "Dispatch liveness" below). It is non-retryable: a systemic
zero-output stall will likely reproduce immediately, so the orchestration should serialize
dispatches rather than retry.

Note that a retried writing Run re-executes the full task on a working tree that may already
contain the first attempt's partial writes; Cline generally converges on the existing work, but
the reviewed diff can be the union of both attempts.

The upstream root cause is unconfirmed; a draft issue report with the full evidence is
maintained by the maintainers.

## Timeout behavior (cline 3.0.37)

When the `--json` CLI run is killed with `-t <seconds>`:

- **stderr** carries exactly one JSON error line:
  `{"ts":"…","type":"error","message":"run timed out after <N>s"}`.
  This is the `/timed out/i` signal the plugin scans for classification.
- **stdout** ends with a `run_result` whose `finishReason` is `"aborted"` (NOT
  `"completed"` and NOT a distinct `"timeout"` reason). All `usage` token and
  cost fields are `0`. The stdout contains **no** "timed out" text — the signal
  is on stderr only.
- The `run_result` IS present, so `extractResult` returns `ok: false` — the
  Run lands in the failure branch, not the salvage-completed-Run path.
- No mid-stream `usage` agent_events with non-zero tokens were observed;
  partial-cost salvage is not possible from the stream captured here.
- **Plugin policy**: timeout is classified as `"timeout"` and is **never**
  retried (the Run already ran to its time limit; re-running would burn
  another full window with the same risk). The ledger records
  `finishReason: "timeout"` for these Runs.
- **Dispatcher watchdog**: the dispatcher also arms a watchdog at the Run timeout + 120 s. If a
  `cline` child hangs, outlives its own `-t`, or leaves stdio wedged, the watchdog sends
  SIGTERM, escalates to SIGKILL, and resolves anyway even if `close` never fires. That turns the
  observed "no process, no output, no ledger entry past the timeout" shape into an ordinary
  `transport:"timeout"` failure with a trailer and ledger line instead of infinite silence.

## Dispatch liveness

Every `delegate` and `review` dispatch now prints observability lines:

- **Start banner**: the first line of stdout is `cline-dispatch: {...}` JSON containing the
  dispatch-scoped `runId`, timestamp, dispatcher pid, `cmd` (`delegate` or `review`), effective
  `profile`/`provider`/`model`, `cwd`, effective `timeoutSeconds`, and current `gitBranch`.
  This line appears before the `cline` subprocess spawns, so a Run is attributable from its
  first millisecond. It is omitted for `--help`, `usage`, `setup`, `profiles`, and `model-feed`.
- **Heartbeats**: while the child is alive, the dispatcher writes one JSON line per interval to
  its own stderr (not to the child's captured stderr):
  `cline-dispatch: {"heartbeat":true,"elapsedS":<s>,"stdoutBytes":<n>,"events":<n>}`.
  The default interval is 30 s; set `CLINE_HEARTBEAT_MS=0` to disable, or override with
  `CLINE_HEARTBEAT_MS`.
- **Stall watchdog**: if the child produces no output on either stream within
  `CLINE_STALL_TIMEOUT_MS` (default 180 s), the dispatcher kills it and classifies the Run as
  non-retryable `transport:"stalled"`. The injected stderr text contains `stall watchdog` and
  deliberately avoids `timed out` so the signature is unambiguous. The watchdog only arms when
  the main timeout watchdog would fire later; it is disabled for timeout-less paths such as
  `--version` and the setup validation Run.
- **`runId`**: a short UUID generated at dispatch time, shared across a transport retry. It
  appears in the start banner, the `cline-run:` trailer, and the ledger entry, making it the
  attribution anchor for a dispatch.

## Providers: ClinePass is `cline-pass`, not `cline`

Empirically confirmed on a real account: the provider settings file holds separate `cline` and
`cline-pass` provider entries. In Cline 3.0.40 it is `~/.cline/settings/providers.json`; older
state used `~/.cline/data/settings/providers.json`. The `cline` provider routes to a different,
metered tier (observed model: `poolside/laguna-xs-2.1`); only `-P cline-pass` returns
`model.provider: "cline-pass"` and a `cline-pass/*` model, and only it spends the flat ClinePass
subscription. The CLI's own default provider is `cline` — which is why delegate/review always
pass `-P cline-pass` explicitly (ADR-0002).

There is **no programmatic model list endpoint** (REST `/models` 404s; `cline config --json` requires a TTY). However, each Run's `run_result.model.info` carries per-model `pricing` and `contextWindow`, which is where `/cline:profiles`' pricing data was harvested from (dated by the bundle's `pricingAsOf`, preserved across `--refresh-models`). The bundled `plugins/cline/data/clinepass-models.json` snapshot is scraped from the ClinePass docs and refreshed via `/cline:setup --refresh-models`.

## Project-local profile resolution

The plugin resolves `.cline-profiles.json` (project-local profiles + ledger opt-in) in the
following order, first-match-wins:

1. **Explicit `--profiles-file <path>`** (delegate/review only). Fails closed: a missing or
   malformed file exits 2 before spawning `cline`.
2. **Upward walk from `--cwd`** (or `process.cwd()` when `--cwd` is not set). The resolver walks
   parent directories looking for `.cline-profiles.json`. An unreadable file at the first match
   still fails closed when `--profile` is used.
3. **Worktree fallback** — when `--cwd` is inside a **linked `git worktree`** and step 2 found
   nothing. The fallback detects the worktree by reading the `.git` file (a file, not a
   directory, pointing at `.../worktrees/<name>`), resolves the main working tree root via the
   `commondir` file, and walks from there. This is pure filesystem logic — no `git` subprocess,
   preserving the zero-runtime-dependency rule.
   - The fallback deliberately excludes submodule layouts (`.git/modules/<name>` paths do not
     contain `/worktrees/`).
   - A worktree-local `.cline-profiles.json` (including a malformed one) **always beats** the
     main checkout's file, because step 2 finds it before the fallback activates.
4. **No profiles file found** → `project` is `null`; `--profile` lists only bundled profiles and
   ClinePass model names.

The **ledger** (`.cline-runs.ndjson`) is appended next to whichever profiles file was used
(`project.dir`):
- Beside an explicit `--profiles-file`.
- Beside a worktree-local profiles file.
- At the **main checkout** when the worktree fallback resolved the file — which means ledger
  telemetry survives worktree deletion. This is intentional.

## Auth

- Sign-in: `cline auth cline` (OAuth). Cline 3.0.40 stores provider settings at
  `~/.cline/settings/providers.json`; older Cline state uses
  `~/.cline/data/settings/providers.json`. The dispatcher tries the legacy path first, then the
  current path. For Codex, substitute the isolated `~/.codex/cline` state root in either layout.
  Delegated Runs use the stored sign-in implicitly — the plugin passes no credential to the
  subprocess. Rotate by re-running the Host-appropriate auth command.
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
