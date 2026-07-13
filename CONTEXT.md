# Cline Plugin

A Claude Code and Codex plugin that delegates coding tasks to Cline so work runs on the user's
ClinePass credits instead of in the Host session.

## Language

**Delegate**:
The act of handing a self-contained coding task from a Host to Cline, which
executes it headlessly and returns a result.
_Avoid_: dispatch, offload, hand off (handoff refers to a separate cross-session skill)

**Host**:
An agentic coding environment that exposes the Cline delegation capability to its user,
such as Claude Code or Codex.
_Avoid_: client (ambiguous with Cline's API client), platform (too broad)

**Run**:
A single one-shot Cline execution — one prompt in, one result out, no continuity.
_Avoid_: session, thread, job

**ClinePass**:
The Cline credit subscription the plugin spends against; exposed as the cline provider
id `cline-pass` (distinct from the `cline` provider), which is the default the delegated
run uses.
_Avoid_: Cline account (broader), credits (the balance, not the subscription)

**Profile**:
A short, plugin-validated name for a provider+model pair, used with `--profile <name>` on
delegate/review. ClinePass model profiles are derived from the bundled model list
(`glm-5.2` → provider `cline-pass`, model `cline-pass/glm-5.2`); other profiles — including
ones targeting the regular `cline` provider — are defined in
`plugins/cline/data/profiles.json`, or per project in `.cline-profiles.json` (which overrides
both), where the model is optional (omitted = that provider's configured default). Resolved fresh
on each Run, and never combined with explicit `--model`/`--provider` flags.
_Avoid_: default, alias (alias undersells that it's validated against the bundled lists)

**Result**:
What a Run returns to a Host: the files Cline changed plus its final summary.
_Avoid_: output, response

**Ledger**:
The opt-in, project-local, append-only NDJSON file (`.cline-runs.ndjson`) holding one
telemetry-only line per Run — never task text, prompts, diffs, or summaries. Enabled with
`"ledger": true` in `.cline-profiles.json`; summarized by `/cline:usage` (ADR-0005).
_Avoid_: log, history (both suggest content capture; the Ledger is telemetry only)
