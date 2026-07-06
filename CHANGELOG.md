# Changelog

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
