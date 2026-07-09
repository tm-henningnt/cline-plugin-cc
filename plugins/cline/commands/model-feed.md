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
