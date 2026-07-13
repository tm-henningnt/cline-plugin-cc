---
name: setup
description: Check whether this local Codex workspace is ready to use Cline delegation; invoke as $cline:setup.
---

Run the shared setup operation with the user's supplied flags:

```bash
CLINE_PLUGIN_HOST=codex node "${PLUGIN_ROOT}/scripts/dispatcher.mjs" setup "$ARGUMENTS"
```

Relay stdout verbatim. Explain that Cline delegation uses a local `cline` installation and
`cline --data-dir ~/.codex/cline auth cline`; it never uses Codex or OpenAI credentials. The
state directory must be a Codex writable root, as Setup explains.
