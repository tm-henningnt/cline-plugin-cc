# Default delegated Runs to a ClinePass-covered coding model

Delegated Runs default to the **`cline-pass` provider** (`-P cline-pass`), which is where the
flat ClinePass models live, with no `-m` so cline uses the provider's configured `cline-pass/*`
model; `--provider`/`--model`/`--profile` override per Run. The plugin's entire purpose is to
spend the flat-rate ClinePass subscription.

**Verified correction:** ClinePass is a *distinct provider id* `cline-pass`, NOT the `cline`
provider. The `cline` provider routes to a different, metered tier (observed:
`poolside/laguna-xs-2.1`); only `-P cline-pass` returns provider `cline-pass` plus a
`cline-pass/*` model and spends the flat subscription. An earlier `-P cline` default (taken from
the CLI help/README) was wrong for the goal and was fixed. `anthropic/*` would likewise draw
pay-per-use credits.

## Consequences

- Users can override to any provider/model per Run with `--model`/`--provider`, or via a named
  `--profile` (ADR-0003).
- `/cline:review` uses the same default unless overridden.

## Update: model list is not queryable

Verified during the build: there is **no programmatic ClinePass model-list API** (`/models` and
`/providers/cline/models` 404) and `cline config --json` requires a TTY, so a live model picker
is not feasible; `@cline/sdk` could provide one but that dependency violates ADR-0001.
Resolution: the plugin does **not** persist its own default model — `delegate`/`review` defer to
cline's configured model. `/cline:setup` ships a bundled snapshot of the ClinePass model slugs
(`plugins/cline/data/clinepass-models.json`, scraped from the docs, refreshable via
`/cline:setup --refresh-models`) and reports the `cline-pass` provider entry's configured model —
what plugin Runs actually use.

## Update: `cline auth` is not a model switcher

Switching models via `cline auth --provider cline-pass --modelid cline-pass/<slug>` was
disproven by a live test (see "Auth" in `docs/cline-cli-contract.md`): on cline 3.0.37 that
invocation unconditionally demands `--apikey` and errors, because `auth` is cline's
credential-establishment command. Per-Run model selection is served by named profiles
(`--profile`, ADR-0003), which resolve to explicit `-P`/`-m` flags with no cline-side state
change. `/cline:setup` reports the `cline-pass` provider entry's configured model, demotes a
non-ClinePass global default to an informational note, and never suggests the auth command.
