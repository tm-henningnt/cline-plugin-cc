---
description: Configure and query a user-provided Model Discovery Feed, then create project-local Cline Profiles from selected model offerings.
argument-hint: '<status|setup|free-coding|cheapest|suggest|profile add> [flags]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run the Model Feed helper and relay the result.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatcher.mjs" model-feed "$ARGUMENTS"
```

Relay the command's stdout **verbatim**.

The feed base URL and optional feed API key are user-provided. Never add a default feed URL or
API key on the user's behalf.

Users may deploy a compatible feed from https://github.com/tm-henningnt/model-discovery-feed;
the command still requires the user-provided base URL, and `help` prints usage.

Notes:
- `free-coding`/`suggest` candidates from providers with a custom base URL (OpenRouter and most
  others outside Cline's built-in list) are reported "not profileable" by a plain `profile add`.
  That is expected, not an error to work around silently: add `--provider <id> --model <id>`
  explicitly. The "not profileable" error names exactly which of the two is missing and suggests
  the likely `--model` value from the candidate's own id.
- This plugin never configures Cline's own provider auth (no `cline auth ...`) and never reads
  Cline's credential store — it assumes the user has already authenticated the provider in Cline
  themselves. Do not try to verify a profile by inspecting Cline's config files; verify it by
  running a real, harmless Run instead: `/cline:delegate --profile <name> --plan "say hello"`.
- OpenRouter's own `:free`-suffixed models are rate-limited by OpenRouter itself, not by this
  plugin or the Model Feed: 20 requests/minute, and a daily cap of 50 requests unless the
  OpenRouter account has purchased at least 10 credits (then 1000/day). A `:free` profile failing
  with a provider-side error is often this cap (especially on popular models), not a broken
  profile or stale candidate — check the account's purchased-credit status before re-deriving the
  model id.
