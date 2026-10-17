# CH-001 foundation evidence

Verified on 2026-10-15 in Ubuntu-22.04 through WSL2.

- Node 22.22.0 and pnpm 12.11.2 match the declared pins.
- A fresh export of the staged Git tree at `/tmp/ant-agent-ch001-055t1e8t`,
  initialized as a separate Git repository, installed with
  `pnpm install --frozen-lockfile`. Installation activated `.husky/_` hooks.
- `pnpm check` passed: Biome lint/format/import checks, strict TypeScript,
  build, and five Node CLI smoke tests. Source and compiled entry points agree.
- `pnpm dev run "explain this repository" --repo .` passed in that directory.
- The actual Husky commit-msg hook rejected `bad message` and accepted
  `chore: initialize ant-agent foundation with husky`.
- The actual pre-commit hook rejected a temporary unused variable after lint
  was configured to fail on warnings. The probe and generated output were removed.
- The staged file list excludes dependencies, build output, generated Husky
  internals, environment files, and agent session/artifact directories.
- Three ADRs record ownership, execution trust, supported hosts, and tooling.
- A GitHub Actions workflow runs the frozen install and same checks on Linux.
  Hosted CI has not run; this repository has not been published.

Initial commit and clean committed-clone verification await the user's Git
author name and email. CH-001 remains in progress until that evidence is recorded.
H0 also requires CH-002 through CH-005; no model or Docker executor exists yet.

Commander resolves in command-line TypeScript and CLI execution. VS Code runs
inside WSL, but the visible editor diagnostic still needs user confirmation.
