# Ant Agent

Early slice of the Ant Swarm coding harness. `demo` replays a scripted
model/tool exchange through the real agent loop. The `run` command only prints
the task and resolves its repository path. Nothing calls a real model, modifies
files, or verifies that the repository path exists yet.

Develop in Linux, Ubuntu/WSL2, or macOS with Node 22.22.0 and pnpm 12.11.2.
Foundation checks pass on macOS; Linux CI is the authority. Native Windows is
not supported, and macOS is a development host only, not a release target yet.

From a checkout, activate the pinned tools and install dependencies:

```bash
nvm install
nvm use
npm install --global pnpm@12.11.2
pnpm install --frozen-lockfile
pnpm check
```

`pnpm install` also installs the Husky Git hooks. `pnpm check` runs Biome lint,
TypeScript checking, a build, and Node's CLI smoke tests. CI runs the same checks.
Try the CLI:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm dev --help
pnpm dev run "explain this repository" --repo .
pnpm build
node dist/cli.js run "hello" --repo .
node dist/cli.js demo
node dist/cli.js demo --jsonl
```

Commander handles commands, options, missing arguments, help, and version output.
TypeScript checks and compiles the source. tsx runs it during development.
Compiled output goes to dist/. The terminal interface is src/cli.ts; agent
logic does not read stdin or print:

- `src/protocol/contracts.ts`: versioned Zod contracts (events, messages,
  tool calls/results, usage, final result). Records with another
  `schemaVersion` are rejected.
- `src/model/`: the `ModelClient` stream interface and `ScriptedModel`, a
  deterministic fake that plays back one script per request.
- `src/tools/`: `defineTool` generates each tool's JSON Schema from its Zod
  arguments; `add_numbers` is a harmless fixture.
- `src/core/run.ts`: `runAgent` streams a response, executes only complete and
  valid tool calls sequentially, and ends with exactly one terminal result.

## How to commit

Keep each commit focused. Review your changes, stage the intended files, then
write a message using `type(optional-scope): short description`:

```bash
git diff
git add README.md
git diff --cached
git commit -m "docs: explain development setup"
```

Use `feat` for features, `fix` for bugs, `docs` for documentation, `test` for
tests, and `chore` for tooling. Husky runs `pnpm check` before a commit and
commitlint checks the message. Before a push, Husky runs `pnpm preflight`: it
checks out each pushed commit into a clean temporary worktree, verifies the
Node/pnpm pins, installs with the frozen lockfile, and runs `pnpm check`, the
same steps as CI. Uncommitted or unstaged files cannot hide a CI failure.
Run `pnpm preflight` yourself at any time. If a check fails, fix the reported issue and
retry. `pnpm lint:fix` applies formatting and safe lint fixes; review and stage
those changes before retrying. Commit from a WSL or macOS terminal with Node/pnpm available.

## Architecture decisions

- [Harness ownership and model transport](docs/adr/0001-harness-ownership.md)
- [Execution trust, supported hosts, snapshot and apply](docs/adr/0002-execution-trust-boundary.md)
- [Tooling, tests, and checkpoints](docs/adr/0003-foundation-tooling.md)

The harness does not execute repository commands or call a real model yet.
The next story, CH-003, adds one real model adapter behind `ModelClient`.
