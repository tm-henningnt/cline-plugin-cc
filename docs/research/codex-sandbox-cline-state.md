# Codex sandbox workaround for Cline session state

Research date: 2026-07-13. This note addresses the observed `SQLITE_READONLY`
failure when the Codex-hosted skill starts Cline and Cline attempts to create its
session database beneath `~/.cline`.

## Finding

There is a supported Cline relocation mechanism. Cline's CLI reference documents
`--data-dir <path>` as an isolated local-state directory, whose default is
`~/.cline`; its configuration layout puts both provider settings and the session
SQLite database under that root. Therefore a directory that Codex is allowed to
write can hold Cline's session files instead of `~/.cline`.

The same CLI also documents `CLINE_DATA_DIR` (base data for sessions, settings,
teams, and hooks) and `CLINE_SANDBOX_DATA_DIR` (sandbox session storage). These
are supported Cline interfaces, not filesystem shims.

Sources:

- [Cline CLI reference: options, environment variables, and state layout](https://docs.cline.bot/cli/cli-reference)
- [Cline configuration documentation](https://docs.cline.bot/getting-started/config)
- [Cline CLI source README](https://github.com/cline/cline/blob/main/apps/cli/README.md)

## Codex boundary

Codex's `workspace-write` sandbox can be extended with
`sandbox_workspace_write.writable_roots`, and Cline provider/API calls also need
`sandbox_workspace_write.network_access = true`. Its configuration reference
defines the former as additional writable roots and the latter as outbound network
access. A command can also request a one-off sandbox escalation. Auto-review
changes only who reviews that request; it does not grant filesystem access,
network access, or extend writable roots.

Sources:

- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)
- [Codex sandbox and auto-review behaviour](https://learn.chatgpt.com/docs/sandboxing/auto-review#how-auto-review-works)

## Recommended supported design

1. Use a dedicated, user-owned directory outside repositories, for example
   `~/.codex/cline`.
2. Add that exact directory to the user's Codex `writable_roots` for
   `workspace-write` sessions and enable `network_access` for Cline provider/API
   calls.
3. Make the Codex skill invoke Cline with
   `--data-dir ~/.codex/cline` (or set `CLINE_DATA_DIR` consistently).
4. Authenticate Cline once against that relocated state, for example:

   ```sh
   cline --data-dir ~/.codex/cline auth cline
   ```

   The authentication state is deliberately separate from `~/.cline`; do not
   put it in a repository because it contains provider credentials.
5. Have `/cline:setup` check both that the selected Cline state root is writable
   in the current Codex sandbox and that its provider configuration is present.
   If either check fails, print the exact setup command instead of starting a
   Run that will fail at session creation.

For a short-lived manual experiment, `/private/tmp/cline-codex-state` also
works as a state location when it is writable to Codex. It is not suitable as
the default because credentials and session continuity disappear when temporary
storage is cleaned.

## Live compatibility evidence

On this machine with Cline 3.0.39, a direct Cline Run using `--data-dir` in
`/private/tmp` produced a Cline `run_result` without `SQLiteError` or
`SQLITE_READONLY`. The Run then failed at provider authentication, which is
expected for isolated local state and confirms that the SQLite failure occurred
before provider execution in the original configuration.

`--config ~/.cline/data/settings` combined with `--data-dir` also did not
reuse the existing ClinePass OAuth token in this test. The public documentation
does not promise that these two options compose, so the plugin must not depend
on that combination.

## Alternatives and limits

- **One-off elevated execution:** supported by Codex's approval flow, and it
  permits the existing `~/.cline` state. It is useful for a manual Run but is
  not suitable as the plugin's normal silent execution model because each Run
  crosses the sandbox boundary.
- **`CLINE_SANDBOX_DATA_DIR`:** Cline documents it, but the public docs do not
  specify its interaction with existing OAuth configuration. Treat it as an
  upstream-supported experimental alternative, not the plugin default, until a
  Cline version-specific integration test verifies it.
- **`--data-dir`:** Cline documents that it is incompatible with `--zen`; this
  plugin does not use `--zen`, so that limitation does not block Delegate or
  Review.
- **Copying/symlinking `~/.cline`:** not recommended. It bypasses the intended
  state boundary and risks copying credentials into a project directory.

## Concrete conclusion

The plugin can achieve normal Codex operation without an unsandboxed Cline
process, but it needs a separately authenticated Cline state root that is both
outside the repository and explicitly writable to Codex. The remaining product
decision is where that root is configured and how Setup leads the user through
the one-time authentication; it is not a Cline CLI capability gap.
