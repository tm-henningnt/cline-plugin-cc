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

When a Claude Code session is orchestrating implementation work in this repo (e.g. the `/improve execute` flow, or any multi-step task broken into discrete steps), match the tool and model to task difficulty rather than defaulting to one combination for everything.

### Delegation surfaces

- **`codex:codex-rescue` subagent** (the codex plugin → Codex CLI, runs **gpt-5.5**): first choice for well-scoped implementation steps and deep investigation. It edits the working tree directly via `--write`, runs its own verification commands, and reports back — freeing the orchestrator to review rather than type. Give it the plan/spec inline or point it at a committed file it can read itself; tell it explicitly not to commit or touch git branches so the orchestrator controls the commit.
  - **Known limitation**: Codex's execution sandbox cannot bind local ports or launch a headless browser (observed: `listen EPERM`, Chromium Mach-port `Permission denied`). Any verification step that needs a live dev/preview server or real browser interaction (e.g. confirming a tooltip renders, screenshotting a page) must be done by the orchestrating agent itself or a reviewer subagent — don't ask Codex to do it, and don't accept "STOPPED" on that step as a real blocker without checking whether the orchestrator's own environment can do it instead.
- **`cline:delegate` subagent** (this repo's own plugin — dogfood it): one-shot Cline Runs on the flat-rate ClinePass subscription. Pick the model per Run with `--profile <name>` (list: `/cline:profiles`); use `--plan`/`--read-only` for no-write analysis. The task prompt must be fully self-contained — Cline gets no conversation context and the prompt reaches it verbatim, so model/provider choices go in flags, never in the task text. One Run per spawn, it never commits; review `git diff` after each writing Run.
- **Claude subagents** (sonnet-5, opus-4.8, fable-5): via the Agent/Workflow `model` parameter — reviews, judgment calls, and anything that needs taste.

### Picking the right models

Rankings, higher = better. Cost reflects what the maintainer actually pays (OpenAI limits are generous; ClinePass is flat-rate), not list price. Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model    | runs via                       | cost | intelligence | taste |
|----------|--------------------------------|-----:|-------------:|------:|
| gpt-5.5  | `codex:codex-rescue`           | 9    | 8            | 5     |
| sonnet-5 | Agent/Workflow `model` param   | 5    | 5            | 7     |
| opus-4.8 | Agent/Workflow `model` param   | 4    | 7            | 8     |
| fable-5  | Agent/Workflow `model` param   | 2    | 9            | 9     |

ClinePass models (via `cline:delegate` + `--profile <name>`) run on the flat-rate subscription — no marginal dollar cost, but the 5-hour/weekly/monthly rate-limit windows drain in proportion to each model's list price, so match a model's weight to the task. Projects can add/override profiles via `.cline-profiles.json` at the repo root (project > built-in > derived; discovery: `/cline:profiles`). Purpose per model is ClinePass's own guidance; prices (per M tokens: input / output / cached read) are the relative window-drain weights:

| profile             | vendor      | ClinePass guidance | in    | out   | cached  |
|---------------------|-------------|--------------------|------:|------:|--------:|
| `glm-5.2`           | Z.ai        | deep reasoning     | $1.40 | $4.40 | $0.26   |
| `kimi-k2.7-code`    | Moonshot AI | coding tasks       | $0.95 | $4.00 | $0.19   |
| `kimi-k2.6`         | Moonshot AI | agentic workflows  | $0.95 | $4.00 | $0.16   |
| `deepseek-v4-pro`   | DeepSeek    | large changes      | $1.74 | $3.48 | $0.0145 |
| `deepseek-v4-flash` | DeepSeek    | fast iteration     | $0.14 | $0.28 | $0.0028 |
| `minimax-m3`        | MiniMax     | general coding     | $0.30 | $1.20 | $0.06   |
| `mimo-v2.5-pro`     | MiMo        | pro workloads      | $1.74 | $3.48 | $0.0145 |
| `mimo-v2.5`         | MiMo        | efficient edits    | $0.14 | $0.28 | $0.0028 |
| `qwen3.7-max`       | Qwen        | heavy workloads    | $2.50 | $7.50 | $0.50   |
| `qwen3.7-plus`      | Qwen        | balanced coding    | $0.40 | $1.60 | $0.04   |

(`qwen3.7-plus` costs triple above 256K context: $1.20/$4.80/$0.12. `qwen3.7-max` is the only model with a cached-write price, $3.125.)

Working defaults from that guidance: `kimi-k2.7-code` for implementation; `deepseek-v4-flash` or `mimo-v2.5` for fast, cheap iteration; `deepseek-v4-pro` for large multi-file changes; `glm-5.2` for plan-mode reasoning; `qwen3.7-max` only when a task earns the heaviest, most window-draining model. Their unsupervised ceiling is still uncalibrated — judge every Result. The `cline` profile targets the regular metered `cline` provider — it spends real credits; use it only for deliberate A/B checks against ClinePass output.

### How to apply

- These are defaults, not limits. Standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, **intelligence > taste > cost**.
- Bulk/mechanical work (clear-spec implementation, data analysis, migrations): **gpt-5.5** or a **ClinePass profile** — both effectively free. Prefer ClinePass for fan-out of small, fully-specified tasks (parallel one-shot Runs are its shape); prefer Codex when the step needs its own verification loop or investigation.
- Anything user-facing (UI, copy, API design) needs **taste ≥ 7** — sonnet-5 at minimum; prefer opus-4.8 or fable-5.
- Reviews of plans/implementations: **fable-5** or **opus-4.8**, optionally **gpt-5.5** as an extra independent perspective. Reserve two parallel independent reviewers for the highest-stakes changes only (spend routing, security boundaries, externally-shared artifacts) — double-reviewing everything doubles cost without proportional risk reduction.
- ClinePass output is uncalibrated: don't hand those models unsupervised hard problems yet, and keep review of their Results in fable-5/opus-4.8.
- **Never use Haiku.**
- Mechanics in this repo: **gpt-5.5** is reachable only through the Codex CLI — use `codex:codex-rescue` (or `/codex:rescue`). ClinePass models are reachable only through this plugin — the `cline:delegate` subagent or `/cline:delegate --profile <name>`. Claude models take the Agent/Workflow `model` parameter directly.

### Using gpt-5.5 or ClinePass models inside Workflow scripts

The Workflow `model` parameter only takes Claude models. Two ways around it:

- Preferred: pass the plugin agent as the stage's agent type — `agent(prompt, { agentType: 'codex:codex-rescue' })` (or `'cline:delegate'`). The prompt must be self-contained, exactly as when spawning those agents directly.
- Fallback (when a custom agentType isn't resolvable): spawn a thin Claude wrapper — `model: 'sonnet', effort: 'low'` — whose prompt instructs it to compose a self-contained Codex/Cline prompt, run one forwarding call via Bash (the codex companion `task`, or this plugin's dispatcher with `--profile`), and return the output verbatim.
