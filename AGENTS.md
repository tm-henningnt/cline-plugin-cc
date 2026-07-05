# Repository Guidelines

## Project Structure & Module Organization

This repository contains the implemented `cline` Claude Code plugin. The authoritative operating
guidance lives in `CLAUDE.md`, the glossary in `CONTEXT.md`, and binding architecture decisions in
`docs/adr/`.

The plugin layout is:

- `.claude-plugin/marketplace.json` for the Claude Code marketplace entry.
- `plugins/cline/.claude-plugin/plugin.json` for the plugin manifest.
- `plugins/cline/commands/*.md` for thin `/cline:*` slash-command wrappers.
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

Slash commands should be Markdown files named after the command, for example `delegate.md`, `review.md`, and `usage.md`, and should reference plugin files through `${CLAUDE_PLUGIN_ROOT}`.

## Testing Guidelines

Use `node:test` and `node:assert`. Tests must not spawn a real `cline` process or call the network; inject canned `run` and `fetch` implementations instead. Capture real `cline --json` NDJSON and real usage API responses as fixtures, then assert parsing and formatting against those files. User-facing formatted output is an exact-asserted contract: exact-string test brittleness is intentional — do not loosen those assertions.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects; scope prefixes are optional when they add clarity.

Pull requests should describe the implemented slice, reference the relevant issue or ADR, list verification commands run, and include screenshots only for user-visible Claude Code command output changes.

## Security & Configuration Tips

Never commit API keys or local credentials. `.env.local` is ignored for private configuration.
Users sign in with `cline auth cline`, which stores an OAuth token in
`~/.cline/data/settings/providers.json`. Delegated Runs use that stored sign-in implicitly, and
`/cline:usage` reads the stored `accessToken` and sends it as a Bearer token to `api.cline.bot`.
Rotate credentials by re-running `cline auth cline`.
