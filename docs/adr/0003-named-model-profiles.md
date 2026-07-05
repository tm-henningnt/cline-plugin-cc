# Named model profiles (`--profile`) resolve a provider+model pair per Run

`--profile <name>` on delegate/review resolves a short, validated name to a provider+model pair
before the Run starts. ClinePass model profiles are **derived at read time** from the bundled
`plugins/cline/data/clinepass-models.json` (`glm-5.2` → `-P cline-pass -m cline-pass/glm-5.2` —
no second maintained list); cross-provider profiles are **explicit entries** in
`plugins/cline/data/profiles.json` (`name` + `provider`, `model` optional — omitted means that
provider's configured default model). The bundled `cline` profile targets the regular `cline`
provider and deliberately spends that subscription instead of ClinePass.

Rules:

- Explicit profiles win name clashes with derived ones; duplicate names within `profiles.json`
  keep the first entry.
- `--profile` combined with explicit `--model`/`--provider` exits 2 **before any subprocess
  spawns** (no wasted spend); unknown profiles likewise exit 2 listing the valid names.
- Nothing is persisted — resolution happens fresh on every Run, and cline's own configuration
  is never written (see "Auth" in `docs/cline-cli-contract.md`).

## Considered options

- **Persist a default via `cline auth --modelid`** — disproven by a live spike: the invocation
  unconditionally demands `--apikey`; `auth` is credential establishment, not model selection.
- **Plugin-side persisted default** — rejected; per-Run flags make persistence unnecessary and
  ADR-0002 keeps cline's provider config the only stored state.
- **Per-Run flags + named profiles** (chosen) — validated before spawn, zero state.

## Consequences / known edge cases

- Shadowing a derived name with an explicit `profiles.json` entry makes the full-slug spelling
  (`--profile cline-pass/<name>`) resolve to null → a clean "Unknown profile" exit before any
  spend (fails closed; both alternative resolutions would be worse).
- `isClinePassModel` treats any `cline-pass/`-prefixed slug as covered regardless of the
  bundled list (fails toward "covered"; keeps future models working before a snapshot refresh).
- A dangling value flag (e.g. `--profile` with no value) parses as unset and the Run proceeds
  on defaults — a "flag requires a value" guard is future work.

## Update: project-local profiles

A third source joined the merge: `.cline-profiles.json` at the project root (found by walking
up from the Run's `--cwd`), holding the same `{ name, provider, model? }` entries. Precedence
is most-local-wins: **project > bundled explicit > derived ClinePass names**, first-wins on
duplicates. Discovery is `/cline:profiles` (read-only, model-invocable), which labels each
profile's source and marks project entries that override a built-in name. Spend guardrails:
a project-sourced profile targeting a provider other than `cline-pass` prints a one-line
notice before the Run; a malformed project file fails `--profile` Runs closed (exit 2 before
any spawn) — never a silent fallback that could re-route spend. Runs without `--profile`
never read the file. Considered and deferred: a user-global profiles tier, and a mechanism for
projects to disable built-in profiles (e.g. tombstoning `cline`) — revisit if team-repo demand
appears; `listProfileEntries` remains the single merge point for either.
