---
description: List available model profiles — project-local and built-in — with their provider/model targets. Read-only; spends nothing.
argument-hint: '[--cwd <path>]'
allowed-tools: Bash(node:*)
---

<!-- Deliberately model-invocable (no hidden-command frontmatter): this command performs
     read-only JSON file reads, spawns no cline subprocess, and cannot spend anything.
     See docs/adr/0004-delegation-agent.md for the recorded exception. -->

List the available profiles and relay the result.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatcher.mjs" profiles "$ARGUMENTS"
```

Relay the command's stdout **verbatim**.
