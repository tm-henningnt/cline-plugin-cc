# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A publishable Claude Code plugin (`cline`) that delegates coding tasks to the **Cline** CLI so the
work runs on the user's flat-rate **ClinePass** subscription instead of the Claude Code session's
budget. It mirrors the *scaffolding* of `openai/codex-plugin-cc` (marketplace + plugin manifests,
thin `.md` slash commands over one Node dispatcher) but deliberately drops that plugin's persistent
`app-server`/broker architecture — see ADR-0001.

## Current state

The plugin is feature-complete for its initial release: the `/cline:delegate`,
`/cline:review`, `/cline:usage`, and `/cline:setup` commands, named model profiles
(`--profile`), and the `cline:delegate` agent are all live. The initial build was tracked in
GitHub issues #1–#6. Future changes must continue to respect the binding design sources:

- **PRD**: GitHub issue #1 (problem, solution, 27 user stories, implementation + testing decisions).
- **Decisions**: `docs/adr/` — treat these as binding.
- **Glossary**: `CONTEXT.md` — use these terms (Delegate, Run, ClinePass, Profile, Result, Ledger) in code and docs; it is a glossary only, never a spec.
- **CLI/API contract**: `docs/cline-cli-contract.md` — the live-verified cline behavior the
  parsers and commands depend on.

## Architecture (as decided)

- **One-shot, synchronous Delegation** (ADR-0001). Each command shells out to a single `cline`
  subprocess that runs to completion and exits; a Node dispatcher parses its output and relays a
  Result. No persistent server, no broker daemon, no session/thread store, **no `@cline/sdk`
  dependency**, no session continuity. Iteration = a fresh Run reviewed in Claude between Runs.
- **The single test seam**: the subprocess spawn and HTTP `fetch` are the *only* impure edges and
  are injected as dependencies (`run`, `fetch`) into the command handlers. Everything else — argv
  building, NDJSON→Result parsing, usage-response mapping, Result formatting — is a pure function
  exercised through those handlers. Tests feed handlers canned fixtures; no real `cline` process,
  no network.
- **Fixtures come from reality**: capture actual `cline --json` output and actual `/balance`+
  `/usages` responses into fixture files; tests assert against those, not guessed shapes.
- **Commands are thin `.md` wrappers** (`plugins/cline/commands/*.md`): frontmatter + a body that
  invokes the dispatcher and relays its stdout **verbatim**. Reference plugin files via the
  `${CLAUDE_PLUGIN_ROOT}` env var Claude Code sets.
- **Model default** (ADR-0002): delegated/review Runs default to the **`cline-pass` provider**
  (`-P cline-pass`) with no `-m`, so cline uses that provider's configured `cline-pass/*` model.
  ClinePass is a distinct provider id (`cline-pass`), NOT the `cline` provider (which routes to a
  different tier and would not spend the flat subscription). `--provider`/`--model` override per Run,
  and `--profile <name>` resolves a named provider+model pair (ClinePass short names derived from
  `plugins/cline/data/clinepass-models.json`, cross-provider entries in
  `plugins/cline/data/profiles.json`; project-local entries in `.cline-profiles.json` (found from
  the Run's `--cwd` upward) override both); combining `--profile` with explicit
  `--model`/`--provider` errors before any Run spawns. The exact slug must be verified against
  the live ClinePass model list, never hard-assumed.
- **Working tree is the checkpoint**: `delegate` lets Cline write directly using Cline 3.x's
  default auto-approve behavior; no dedicated auto-approve flag exists. Use plan mode (`-p`) for
  the no-writes path. The plugin **never auto-commits**. `review` is strictly read-only and, after
  presenting findings, STOPS — never auto-applies fixes.
- **Auth**: sign in once with `cline auth cline`; Cline stores an OAuth token in
  `~/.cline/data/settings/providers.json`. Delegated Runs use that stored sign-in implicitly and
  the plugin passes no credential to the `cline` subprocess. `/cline:usage` reads the stored
  `accessToken` from that file and sends it as a Bearer token to `api.cline.bot`. The old API-key
  environment variable path is not used; rotate credentials by re-running `cline auth cline`.

## Toolchain & commands

- **Runtime**: Node 22+ (the `cline` CLI requirement), pure ESM (`"type": "module"`), **zero
  runtime npm dependencies**.
- **Prerequisite for running any command end-to-end**: the `cline` CLI installed globally
  (`npm i -g cline`) and an active Cline sign-in from `cline auth cline`.
- **Tests**: Node's built-in `node:test` + `node:assert`.
  - Run all: `node --test`
  - Run all via npm: `npm test`
  - Run one file: `node --test path/to/file.test.mjs`
- No build step and no linter are configured; keep it that way unless a slice adds one deliberately.

## Publishing

Marketplace name `tm-henningnt`, plugin name `cline`, commands namespaced `/cline:*`. Layout:
`.claude-plugin/marketplace.json` (root) + `plugins/cline/.claude-plugin/plugin.json`. Install:
`/plugin marketplace add tm-henningnt/cline-plugin-cc` → `/plugin install cline@tm-henningnt`.

## Agentic Execution — Model & Tool Selection

Model/tool selection, delegation surfaces (`codex:codex-rescue`, `cline:delegate`, Claude
subagents), and the GPT-5.6/ClinePass model tables are maintained globally in
`~/.claude/DELEGATION.md` (auto-loaded via `~/.claude/CLAUDE.md` for every project) — no
project-specific overrides here. Update the global file, not this one, when models or
guidance change.
