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
state directory must be a Codex writable root with network access, as Setup explains. Cline
3.0.40 stores the provider configuration file under `settings/providers.json`; the
shared dispatcher also supports the legacy `data/settings/providers.json` path. Never read,
print, copy, or commit either file's contents.
