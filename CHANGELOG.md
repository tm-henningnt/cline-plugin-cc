# Changelog

## [0.9.2] - 2026-07-13

- Fixed: Codex Cline state now rejects project-local paths even through an external Run cwd or
  symlink, preventing session and credential data from being written into a repository.
- Changed: Codex setup and documentation now require workspace-write network access alongside the
  isolated writable state root, and present shell-safe sign-in remediation for paths with spaces
  or apostrophes.
- Changed: Codex installation guidance now uses `codex plugin list` as the reliable activation
  check before suggesting the `$cline:setup` skill invocation.

## [0.9.1] - 2026-07-13

- Added: native Codex plugin packaging, marketplace metadata, and skills for Delegate, Review,
  Setup, Usage, Profiles, and Model Feed. Every Codex operation uses the same dispatcher and
  Result contract as the Claude Code plugin.
- Changed: public and contributor documentation now describes the Claude Code and Codex Host
  installation paths and their shared local Cline authentication boundary.

## [0.9.0] - 2026-07-12

- Fixed: project-local profiles now resolve inside linked `git worktree` checkouts (the resolver
  walks the git common dir back to the main working tree root), so worktree-isolated Runs keep
  access to `.cline-profiles.json` profiles instead of failing with `Unknown profile`.
- Added: `--profiles-file <path>` on delegate/review as an explicit override (fails closed on a
  missing or malformed file).
- Added: `cline-dispatch:` start banner (runId, pid, effective profile/provider/model, cwd, git
  branch, effective timeout) so a dispatched Run is observable from its first millisecond.
- Added: heartbeat lines on stderr every 30 s (`CLINE_HEARTBEAT_MS`).
- Added: zero-output stall watchdog — a `cline` child that emits nothing within 180 s
  (`CLINE_STALL_TIMEOUT_MS`) is killed and classified as non-retryable `transport:"stalled"`
  instead of hanging silently to the full timeout.
- Added: `runId` in the `cline-run:` trailer and ledger entries.
- Changed: CLAUDE.md guidance snippet bumped to v6 — concurrency cap (≤2 concurrent Runs,
  `stalled` means dispatch serially), no-flag-inheritance on re-dispatch, main-tree checks
  after worktree Runs, and runId-based attribution; delegate agent now relays the dispatch
  banner's runId and never claims shared-worktree commits without its own Run's trailer.

## [0.8.1] - 2026-07-10

Safety fix and Model Feed friction reduction found while dogfooding profile creation for free
models.

- Fixed: `/cline:delegate --help` and `/cline:review --help` (or a bare `-h`) previously fell
  through the argv parser's "everything after the first unrecognized token is the task prompt"
  rule and silently launched a real, write-enabled Cline Run with `--help` as the task instead of
  printing usage. Both flags are now recognized before prompt-parsing and short-circuit to a
  usage line with no `cline` process spawned.
- Changed: `model-feed profile add` on a "not profileable" candidate (the common case for
  OpenRouter and other custom-base-URL providers) now names exactly which of `--provider`/`--model`
  is actually missing — most candidates already resolve a provider — and suggests the likely
  `--model` value from the candidate's own id, instead of a blanket "supply --provider and
  --model".
- Docs: `/cline:model-feed` help and `commands/model-feed.md` now spell out the
  not-profileable → explicit `--provider`/`--model` override pattern upfront, clarify that this
  plugin never configures or inspects Cline's own provider auth (verify a profile with a real
  `--plan` Run instead), and note OpenRouter's documented `:free`-model limits (20 req/min; 50 or
  1000 req/day depending on purchased credits) so a rate-limited Run isn't mistaken for a broken
  profile.

## [0.8.0] - 2026-07-09

Model Discovery Feed helper for creating project-local Profiles from a user-provided feed.

- Added: `/cline:model-feed` (hidden from model invocation) can configure a user-provided Model
  Discovery Feed, check status, list strict currently-free coding candidates, rank cheapest
  comparable offerings, turn deterministic wish/gap text into suggestions, and dry-run or write
  selected candidates into `.cline-profiles.json`.
- Security: the feed base URL and optional feed API key are never bundled. Feed keys can be read
  from an environment variable or explicit local secret file, are redacted from output, and are
  never written to project Profiles or cache files.
- Added: ETag-aware feed caching with `304` reuse and stale-cache fallback for read-only
  discovery, plus strict `schema_version === "1.0.0"` validation while ignoring unknown fields.

## [0.7.0] - 2026-07-07

Third-field-build follow-through (SnakeTUI v2): dispatch and reliability fixes for the failure
modes v0.6.0's detection surfaced but didn't cure — plus guidance that the real risk is
integration wiring, not model capability.

- Fixed: the `cline:delegate` agent now backgrounds long Runs via the Bash tool's
  `run_in_background` parameter and explicitly forbids shell `nohup`/`&`/`disown`, which the
  harness killed at its 2-minute cap — a ~2-minute wasted-wall-clock stall that reproduced on
  every Run in field use.
- Fixed: a ClinePass quota/429 rejection is now classified as a non-retryable `rate-limit`
  signature instead of being mistaken for a transient `hook-dispatch-failed` and pointlessly
  auto-retried.
- Fixed: the dispatcher now kills a `cline` child that hangs past the Run timeout (watchdog at
  timeout + 120 s, and resolving even if the child never closes stdio), so a silent hang surfaces
  as a normal timeout failure with a trailer and ledger entry instead of no output at all.
- Changed: CLAUDE.md guidance snippet v5 — verify the artifact on every Run (a `completed`
  trailer has come back on zero-work Runs), the real risk is integration-glue wiring caught only
  by live end-to-end checks, and a `qwen3.7-plus` reporting-reliability caveat. Existing installs
  get the `/cline:setup` upgrade offer.

## [0.6.0] - 2026-07-06

Second-field-build follow-through (Tetris TUI): richer profile discovery, failure telemetry
that's as machine-readable as success, a long-Run dispatch fix, and longer read-only timeouts.

- Added: `/cline:profiles` now shows list price per M tokens (in/out/cached), a relative drain
  weight, and context-window size for each ClinePass model. Prices are flat-rate plan
  window-drain weights, not bills; a `pricingAsOf` date in the bundled snapshot keeps the
  display honest, and the per-model pricing/context data survives `--refresh-models` (which
  re-scrapes slugs, not prices).
- Added: failure output now starts with a bold `**Cline Run FAILED (exit N)**` line and ends
  with a `cline-run: {"ok":false,…}` telemetry trailer, so every Run — pass or fail — has a
  machine-parseable last line (including `toolCalls`). Timeout is classified as a distinct
  `"timeout"` transport signature and is never retried; when the Run did real work, the failure
  text includes a `git diff` hint. The success trailer gains `inputTokens`/`outputTokens` when
  the model reports them.
- Changed: read-only Runs (`--plan`, `--read-only`, and every `/cline:review`) now default to a
  1800 s timeout instead of 600 s — whole-codebase audits were hitting the old default; writing
  Runs are unchanged.
- Changed: the CLAUDE.md guidance snippet is bumped to v4 — worktree-based parallel dispatch
  (with the same-base-commit staleness caveat), failed-Runs-may-contain-work and
  substituted-verification-proves-nothing rules, and explicit `--timeout` sizing on heavy tasks.
  Existing installs get the `/cline:setup` upgrade offer.
- Fixed: timed-out Runs no longer ledger silently as `costUsd: 0`; they record
  `finishReason: "timeout"` (and partial cost when mid-stream usage is available).
- Fixed: the `cline:delegate` agent could end its turn with a long Run still executing (any Run
  whose `--timeout` exceeds the Bash tool's 600 s cap). It now backgrounds and polls such Runs
  and never exits with a Run in flight; it also knows read-only Runs default to 1800 s.
- Docs: the CLI contract records the observed timeout behavior (signal on stderr, stdout ends
  `finishReason: "aborted"`), a second field build's cross-profile transport-failure evidence
  (with a drafted upstream report), and that per-model pricing/context come from the CLI's
  `run_result.model.info` rather than any `/models` list endpoint.

## [0.5.0] - 2026-07-06

Initial public release.

- `/cline:delegate` — one-shot headless delegation to the Cline CLI on the flat-rate
  ClinePass subscription (`-P cline-pass`); Cline edits the working tree directly, nothing
  is auto-committed.
- `/cline:review` — strictly read-only Cline review of local git changes.
- `/cline:usage` — ClinePass credit balance plus computed 24h/7d/30d usage summaries
  (cursor-paginated API), and a Local Run ledger rollup when the project opts in.
- `/cline:profiles` — read-only, zero-spend profile listing with provider/model targets,
  source labels, and each ClinePass model's official purpose. Deliberately model-invocable
  so agents can discover profiles.
- `/cline:setup [--refresh-models]` — health checks, the model plugin Runs will use,
  available profiles, a tiny validation Run, and an opt-in versioned CLAUDE.md guidance
  snippet (managed section detected by marker; stale sections get an upgrade offer).
- Named model profiles: `--profile <name>` resolves a validated provider+model pair per
  Run — ClinePass short names derived from the bundled model list, cross-provider entries
  in `data/profiles.json`, project-local entries in `.cline-profiles.json` (found from the
  Run's `--cwd` upward; overrides built-ins; a malformed file fails `--profile` Runs closed;
  a project profile targeting a non-ClinePass provider prints a spend notice).
- `cline:delegate` agent — a Bash-only forwarder Claude spawns autonomously for orchestrated
  delegation, with a documented request shape (`Flags: …` / `Task (pass verbatim…):`); the
  slash commands remain user-invoked.
- Transport resilience: Runs that crash with a known Cline CLI transport signature
  (`session not found`, `hook dispatch failed`) are retried once with a visible note, and a
  completed Result is salvaged even when the CLI exits non-zero after finishing. Detection
  never scans model-authored output, so a Run summary mentioning a signature cannot trigger
  a spurious retry.
- A `cline-run: {...}` JSON telemetry trailer (model, provider, cost, duration, tool calls,
  `retried`/`salvaged`) on every Result — parse the LAST such line; earlier ones could be
  spoofed by Run output.
- Opt-in local Run ledger (`"ledger": true` in `.cline-profiles.json`): appends one
  telemetry-only line per Run to `.cline-runs.ndjson` (never task text, prompts, diffs, or
  summaries) for success-rate and cost rollups. See ADR-0005.
- Verified against `cline` 3.0.37.
