# Opt-in project-local Run ledger records telemetry only

Projects can opt into an append-only local Run ledger by setting `"ledger": true` at the top
level of `.cline-profiles.json`. When enabled, delegate/review append one NDJSON line per Run to
`.cline-runs.ndjson` beside that config file, and `/cline:usage` reports success/error rates,
transport-crash counts, retry counts, cost, and per-model rollups from the file.

The ledger entry is telemetry only: timestamp, command, profile, provider/model, ok status,
finish reason, retry/salvage flags, known transport signature, cost, duration, tool calls, and
token counts. It never includes task text, prompts, diffs, or Result summaries.

Rules:

- No config file, or no `"ledger": true`, means no ledger file and no behavior change.
- The ledger lives next to the `.cline-profiles.json` that enabled it; there is no global ledger.
- Writes are best effort and non-fatal. A write failure prints one stderr note and never changes
  the Run's stdout or exit code.
- The ledger is observability only. It is never read as input to delegate/review Runs.

## Context

A 15-task field build rotated 10 ClinePass profiles and needed answers the plugin could not give:
"what did this build cost by model?" and "how often do Runs fail, and why?" The same build also
observed a 40% transport-crash rate by hand-counting. The `cline-run:` trailer made individual
Runs parseable, but aggregation still required scraping scattered conversation logs.

The ledger deliberately adds local state to an architecture that otherwise treats Runs as
stateless one-shot subprocesses. Keeping it opt-in, project-local, append-only, and telemetry-only
preserves the one-shot execution model while giving maintainers enough evidence to measure real
base rates.

## Considered options

- **Global home-directory ledger** — rejected; it mixes unrelated projects and expands the privacy
  surface beyond the repository that opted in.
- **A new `/cline:stats` command** — deferred; `/cline:usage` is already the rollup surface for
  ClinePass spend, so adding the local ledger section there keeps discovery simple.
- **Conversation-log scraping** — rejected; it depends on external transcript formats and can
  accidentally capture model-authored prose.
- **Project-local opt-in ledger** (chosen) — scoped to the project, cheap to append, tolerant to
  concurrent Runs, and independent of any Run's future behavior.

## Consequences / known edge cases

- This is a scoped exception to ADR-0001's "no session store" posture. Runs remain one-shot and
  independent; the ledger is an after-the-fact measurement instrument, not state used to drive a
  Run.
- `.cline-runs.ndjson` is a local artifact and should usually be gitignored. Teams may choose to
  share it deliberately, but the plugin never requires that.
- The summary parser must remain tolerant of malformed or older lines. If fields change later,
  old ledger entries stay parseable rather than requiring a migration.
- A malformed `.cline-profiles.json` cannot enable the ledger. That matches project-profile
  behavior: `--profile` Runs fail closed, while unprofiled Runs continue without applying settings
  from an invalid file.
