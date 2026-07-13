---
name: setup
description: Check whether this local Codex workspace is ready to use Cline delegation.
---

Run the shared setup operation with the user's supplied flags:

```bash
node "${PLUGIN_ROOT}/scripts/dispatcher.mjs" setup "$ARGUMENTS"
```

Relay stdout verbatim. Explain that Cline delegation uses a local `cline` installation and
`cline auth cline`; it never uses Codex or OpenAI credentials.
