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

## Committed-clone verification

Verified on 2026-10-17 on macOS (Apple Silicon, arm64), commit
`d2fd150d02e58f8e0afbd6294e62044b572a9bb8`.

- A fresh `git clone` of the commit, with Node 22.22.0 selected from `.nvmrc`
  and pnpm 12.11.2, installed with `pnpm install --frozen-lockfile`.
- `pnpm check` passed: lint, typecheck, build, and 5/5 CLI smoke tests.
- `node dist/cli.js run "hello" --repo .` printed the task and resolved
  repository and exited 0. `--version` printed 1.0.0. A missing task exited 1.
- Hosted CI "Foundation checks" passed on ubuntu-22.04 for the same commit:
  https://github.com/i-niranjan/ant-cli/actions/runs/39029708818

CH-001 is complete. H0 still requires CH-002 through CH-005; no model or
Docker executor exists yet.
