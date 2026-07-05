---
description: Check Cline CLI sign-in, the model plugin Runs will use, available model profiles, and run a tiny validation Run.
argument-hint: '[--refresh-models]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Check Cline setup and relay the result.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatcher.mjs" setup "$ARGUMENTS"
```

Relay the command's stdout **verbatim**.

Then, as an onboarding check for the CLAUDE.md guidance (a managed section identified by an
HTML comment marker `cline-plugin guidance v<N>`):

1. Search the project's `CLAUDE.md` and the user's global `~/.claude/CLAUDE.md` for the
   marker `cline-plugin guidance`.
2. If the CURRENT version marker (see the snippet in `${CLAUDE_PLUGIN_ROOT}/README.md`,
   "Recommended CLAUDE.md guidance") is present in either file: say nothing and stop.
3. If a marker with an OLDER version is present: tell the user their guidance section is
   out of date and offer to replace exactly that managed section (from its marker line to
   the end of its bullet list) with the current one.
4. If NO marker is present: make the offer — even if CLAUDE.md mentions Cline, delegation,
   or this plugin in other words. Hand-written or partial guidance does NOT count as
   installed; in that case say explicitly what you found (e.g. "your CLAUDE.md mentions
   Cline delegation but doesn't contain the plugin's managed guidance section") and offer
   to append the canonical section alongside it. Do not skip the offer silently under any
   circumstance other than a current marker.
5. Only write on an explicit yes in this conversation; let the user pick project vs
   global. Never modify any text outside the managed section; never delete the user's own
   prose.

Finally, if the report's "Project profiles" line shows none were found, **offer** to create
`.cline-profiles.json` at the project root with exactly this content (only write it if the
user says yes in this conversation):

````json
{
  "note": "Project-local profiles for the cline Claude Code plugin (--profile on /cline:delegate and /cline:review). Entries: { \"name\", \"provider\", \"model\" (optional — omit to use the provider's configured default) }. Entries here override the plugin's built-in profiles and the derived ClinePass model names. List everything with /cline:profiles. Safe to commit. Set \"ledger\": true to append one line of telemetry per Run (no task text) to .cline-runs.ndjson beside this file — consider gitignoring that file.",
  "profiles": [
    { "name": "quick", "provider": "cline-pass", "model": "cline-pass/deepseek-v4-flash" }
  ],
  "ledger": false
}
````
