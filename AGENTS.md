# Repository Guidelines

## Project Structure & Module Organization

This repository contains the implemented `cline` Claude Code and Codex plugin. `CLAUDE.md` is
Claude Code guidance; this `AGENTS.md` is the Codex instruction surface. The glossary is in
`CONTEXT.md`, and binding architecture decisions live in `docs/adr/`.

The plugin layout is:

- `.claude-plugin/marketplace.json` for the Claude Code marketplace entry.
- `plugins/cline/.claude-plugin/plugin.json` for the plugin manifest.
- `plugins/cline/.codex-plugin/plugin.json` for the Codex plugin manifest.
- `plugins/cline/commands/*.md` for thin `/cline:*` slash-command wrappers.
- `plugins/cline/skills/*/SKILL.md` for thin `$cline:*` Codex skill wrappers.
- `plugins/cline/scripts/*.mjs` and `plugins/cline/scripts/lib/*.mjs` for the Node ESM dispatcher and pure helpers.
- `plugins/cline/data/*.json` for the bundled ClinePass model snapshot and named profiles.
- Test files should sit near the code they exercise or in a dedicated test directory, using `*.test.mjs`.

Do not add a persistent server, broker daemon, session store, or `@cline/sdk` dependency unless an ADR changes that decision.

## Build, Test, and Development Commands

- `node --test` runs the full Node test suite.
- `npm test` is the package alias for the full Node test suite.
- `node --test path/to/file.test.mjs` runs one focused test file.
- `npm i -g cline` installs the required Cline CLI for end-to-end local checks.
- `cline --json "prompt"` is the one-shot CLI shape to validate against real Cline output (cline 3.x auto-approves by default; use `-p` for no-write plan runs).

There is no build step or linter configured. Keep runtime code dependency-free unless a future slice deliberately changes that.

## Coding Style & Naming Conventions

Use Node 22+ ESM (`.mjs`, `import`/`export`) and prefer small pure functions around a single impure seam: injected subprocess `run` and HTTP `fetch`. Use two-space indentation for JavaScript and JSON. Name domain concepts consistently with `CONTEXT.md`: Delegate, Run, ClinePass, Profile, Result, and Ledger.

Claude slash commands should reference plugin files through `${CLAUDE_PLUGIN_ROOT}`.
Codex skills should reference them through `${PLUGIN_ROOT}` and declare
`CLINE_PLUGIN_HOST=codex` before starting the shared dispatcher.

## Codex Cline state

Codex Cline Runs use an isolated Cline state root, defaulting to `~/.codex/cline`, so Cline's
SQLite session database and OAuth credentials are not written under the sandbox-protected
`~/.cline`. The user must add this non-repository directory to Codex
`sandbox_workspace_write.writable_roots` and authenticate it with
`cline --data-dir ~/.codex/cline auth cline`. Do not copy, symlink, print, or commit Cline state
or credentials. Codex also needs `sandbox_workspace_write.network_access = true` for Cline's
provider/API calls; this does not expand filesystem access. Claude Code retains the default
`~/.cline` state.

## Testing Guidelines

Use `node:test` and `node:assert`. Tests must not spawn a real `cline` process or call the network; inject canned `run` and `fetch` implementations instead. Capture real `cline --json` NDJSON and real usage API responses as fixtures, then assert parsing and formatting against those files. User-facing formatted output is an exact-asserted contract: exact-string test brittleness is intentional — do not loosen those assertions.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects; scope prefixes are optional when they add clarity.

Pull requests should describe the implemented slice, reference the relevant issue or ADR, list verification commands run, and include screenshots only for user-visible Claude Code command output changes.

## Cline Delegation Profiles (`.cline-profiles.json`)

This repo's `.cline-profiles.json` defines project-local `--profile` names for
`/cline:delegate` and `/cline:review`, on top of the plugin's built-in ClinePass
profiles. Run `/cline:profiles` for the live, merged list — the notes below are a
snapshot with the reliability guidance already recorded in that file's `guidance`
fields, so you don't have to open it to decide which one to reach for.

**Known-broken — do not use until re-verified:**
- `openrouter-qwen3-coder-free` (`openrouter` / `qwen/qwen3-coder:free`)
- `openrouter-qwen3-next-80b-free` (`openrouter` / `qwen/qwen3-next-80b-a3b-instruct:free`)

  Both consistently failed with a transport `hook-dispatch-failed` error in live
  `--plan` runs on 2026-07-10, while sibling `openrouter-*` profiles succeeded in the
  same session — not a config typo. Most likely cause: OpenRouter's `:free` model caps
  (20 req/min, 50 req/day unless the account has ≥10 purchased credits, then
  1000/day) rather than the model being down — check the account's purchased-credit
  status before retrying.

**Verified $0.000000 cost on a live run (2026-07-10) — safe first choices for
well-scoped mechanical work:**
- `openrouter-laguna-m1-free` (`openrouter` / `poolside/laguna-m.1:free`)
- `openrouter-laguna-xs21-free` (`openrouter` / `poolside/laguna-xs-2.1:free`)
- `openrouter-north-mini-code-free` (`openrouter` / `cohere/north-mini-code:free`)
- `cline-free-deepseek-v4-flash` (`cline` / `deepseek/deepseek-v4-flash`) — Cline GUI's
  own free tier, separate from the ClinePass quota and not listed in the Model Feed or
  docs
- `cline-free-step-3.7-flash` (`cline` / `stepfun/step-3.7-flash`) — same free tier
- `cline-free-hy3` (`cline` / `tencent/hy3:free`) — same free tier
- `cline-free-laguna-m1` (`cline` / `poolside/laguna-m.1:free`) — same free tier. The
  bare `poolside/laguna-m.1` slug (no `:free` suffix) also resolves but is billed
  (~$0.0014/run) — the `:free` suffix is required for the no-cost route.

Prefer these free profiles over a paid ClinePass profile for bulk/mechanical Runs in
this repo (boilerplate, mechanical refactors, test scaffolding); fall back to a
ClinePass profile (see the global model-selection guidance) if a free profile's output
quality doesn't hold up, or escalate to `codex:codex-rescue` if it fails outright. This
file's `ledger: true` setting appends one line of Run telemetry (no task text) per Run
to `.cline-runs.ndjson` beside it — check that file for more recent signal than the
snapshot above before assuming it's still accurate.

## Security & Configuration Tips

Never commit API keys or local credentials. `.env.local` is ignored for private configuration.
Claude Code users sign in with `cline auth cline`, which stores an OAuth token in
`~/.cline/data/settings/providers.json`. Codex users authenticate their isolated state with
`cline --data-dir ~/.codex/cline auth cline`. Delegated Runs use the selected Host's stored
sign-in implicitly, and Usage reads its `accessToken` to send as a Bearer token to
`api.cline.bot`. Rotate credentials by re-running the matching authentication command.
