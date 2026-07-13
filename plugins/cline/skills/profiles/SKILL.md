---
name: profiles
description: List the Cline Profiles available to this workspace.
---

Run the shared profile-discovery operation with the user's supplied flags:

```bash
node "${PLUGIN_ROOT}/scripts/dispatcher.mjs" profiles "$ARGUMENTS"
```

Relay stdout verbatim. Profile names are validated provider/model choices; do not turn a model
request that appears only in prose into a dispatcher flag.
