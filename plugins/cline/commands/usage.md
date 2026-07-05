---
description: Show ClinePass credit balance and recent usage.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Show the current ClinePass balance and recent usage summary.

When the project has opted into the local Run ledger, the summary ends with a Local Run ledger
section.

1. Run the dispatcher:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatcher.mjs" usage
   ```

2. Relay the command's stdout **verbatim** — it is the ClinePass usage summary.
