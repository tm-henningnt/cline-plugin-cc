# One-shot CLI delegation, not a persistent server

The plugin delegates each coding task as a single one-shot `cline --json` subprocess
that runs to completion and exits (auto-approve defaults to `true` in cline 3.x, so no `--yolo`
flag exists or is needed; read-only/plan runs use `-p`), and we parse its NDJSON output to relay
a Result. We
deliberately do NOT mirror codex-plugin-cc's persistent `app-server` JSON-RPC + broker daemon,
because Cline (unlike Codex) has a documented headless one-shot mode, making that layer
unnecessary.

## Considered Options

- **One-shot CLI subprocess** (chosen) — simplest; no daemon, no session store, no npm deps;
  matches codex-plugin-cc's stdout-relay command pattern.
- **@cline/sdk embedded** — richer structured events and no reliance on a globally-installed
  binary, but adds a dependency and is heavier than one-shot needs. Reconsider only if we add
  resumable sessions.
- **Persistent server + broker** (codex-plugin-cc's model) — rejected; solves a problem
  (Codex's lack of headless mode) that Cline does not have.

## Consequences

- No session continuity: iteration means delegating a fresh Run and reviewing the Result in
  Claude between Runs. Follow-ups do not share Cline context.
- The user must have the `cline` CLI installed globally (`npm i -g cline`, Node 22+).
- If resumable sessions are ever wanted, revisit — that would likely force the SDK or `--zen`.
