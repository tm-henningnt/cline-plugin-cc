# Changelog

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
