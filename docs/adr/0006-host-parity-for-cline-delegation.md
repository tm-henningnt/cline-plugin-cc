# Host parity for Cline delegation

The plugin will expose the same six operations — Delegate, Review, Setup, Usage, Profiles, and
Model Feed — from both Claude Code and Codex, with compatible arguments and Result text whenever
the underlying Cline behavior is shared. This favors a single, dependable Cline delegation model
over a smaller Codex-only subset, while allowing each Host to use its native packaging and command
surface.

## Considered Options

- **Full Host parity** (chosen) — users can rely on the same Cline capabilities in either Host and
  shared dispatcher behavior remains the compatibility anchor.
- **Delegate and Review only in Codex** — cheaper initially, but fractures setup, observability,
  profile discovery, and model-selection workflows between Hosts.

## Consequences

- The dispatcher, Cline integration, bundled data, fixtures, and behavior tests become a
  host-neutral core. Host packages contain only their manifests and thin native wrappers.
- Host-specific guidance may differ, but it must not reinterpret operation arguments or Result
  formatting owned by the shared core.
- For the same Cline Run, the shared dispatcher must produce byte-identical stdout regardless of
  Host. Exact-output tests enforce that compatibility contract.
