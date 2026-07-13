# Issue tracker: GitHub

Issues and specifications for this repository live as GitHub issues. Use the `gh` CLI for all
issue operations.

## Conventions

- Create an issue with `gh issue create --title "..." --body "..."`.
- Read an issue with `gh issue view <number> --comments`.
- List issues with `gh issue list`, scoped by state or label when appropriate.
- Comment with `gh issue comment <number> --body "..."`.
- Apply or remove labels with `gh issue edit <number> --add-label "..."` and
  `gh issue edit <number> --remove-label "..."`.
- Close an issue with `gh issue close <number> --comment "..."`.

Infer the repository from the Git remote; `gh` does this automatically inside this clone.

## Pull requests as a triage surface

PRs as a request surface: no.

When a skill says to publish to the issue tracker, create a GitHub issue.
