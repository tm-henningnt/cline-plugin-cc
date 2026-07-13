---
name: usage
description: Show ClinePass usage and any opt-in local Run Ledger summary.
---

Run the shared usage operation:

```bash
CLINE_PLUGIN_HOST=codex node "${PLUGIN_ROOT}/scripts/dispatcher.mjs" usage "$ARGUMENTS"
```

Relay stdout verbatim. The operation reads only the local Cline authentication path and any
opt-in project Ledger; it must never use or expose Codex/OpenAI credentials.
