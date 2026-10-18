# Learning guide: CH-002 and CH-003

This worktree lets you build CH-002 and CH-003 yourself, starting from the
completed CH-001 foundation. It describes the expected behavior, not how to
build it.

- Worktree: `../ant-cli-learning`, branch `learning/ch-002-ch-003`
- Starting commit: `963e492` ("chore: add pre-push preflight that mirrors ci"),
  the last commit before CH-002 work began (`24b77f2`).

> **Spoiler warning.** The finished solutions are on `main`, which this worktree
> shares through Git. If you want to work blind, avoid `git log main`,
> `git show main:...`, `git diff main`, the original `../ant-cli` folder, and
> these files on `main`: `docs/ch-002-evidence.md`, `docs/ch-003-evidence.md`,
> and `docs/adr/0004-first-model-adapter.md`. The planning backlog's "Status"
> lines for CH-002 and CH-003 also name the decisions that were made.

## What the foundation already provides

- One private ESM TypeScript package: strict `tsc`, Node 22.22.0 (`.nvmrc`),
  pnpm 12.11.2 (`packageManager`), a frozen lockfile, and exact dependency pins.
- A Commander CLI in `src/cli.ts` with `--help`, `--version`, and
  `run <task> [--repo <path>]`. `run` only prints the task and the resolved
  repository path.
- Five CLI smoke tests in `test/cli.test.js` using Node's built-in test runner.
  They run against both the compiled `dist/` output and the source through `tsx`.
- Biome for lint, formatting, and import ordering, with warnings treated as errors.
- Husky hooks: pre-commit runs `pnpm check`, commit-msg runs commitlint
  (Conventional Commits), and pre-push runs `pnpm preflight`.
- A GitHub Actions workflow that runs a frozen install and `pnpm check` on Linux.
- ADRs 0001 to 0003 and the CH-001 evidence record.

The foundation has no contracts, model, tools, agent loop, Zod, or Pi
dependency yet. Adding them is your job.

## Commands

```bash
cd ../ant-cli-learning
nvm use                         # Node 22.22.0 from .nvmrc
pnpm install --frozen-lockfile  # also installs the Husky hooks
pnpm dev --help                 # run the CLI from source through tsx
pnpm dev run "hello" --repo .
pnpm build                      # compile to dist/
node dist/cli.js run "hello" --repo .
pnpm lint                       # Biome check; warnings fail
pnpm lint:fix                   # apply formatting and safe fixes
pnpm typecheck                  # tsc --noEmit
pnpm test                       # build, then node --test test/*.test.js
pnpm check                      # lint + typecheck + test (same as CI)
pnpm preflight                  # clean-checkout frozen install + check, like CI
```

When you add a dependency, pin the exact version and commit the updated
`pnpm-lock.yaml`. `pnpm preflight` will fail if the lockfile is out of date.

## Architecture decisions to read first

- [ADR 0001: Harness ownership and model transport](docs/adr/0001-harness-ownership.md):
  which parts we own, and that Pi is used only behind our model adapter.
- [ADR 0002: Execution trust boundary](docs/adr/0002-execution-trust-boundary.md):
  credentials stay outside repository execution.
- [ADR 0003: Foundation tooling](docs/adr/0003-foundation-tooling.md):
  the test runner, lint, hooks, and dependency policy.
- Planning sources, outside this repo:
  - Backlog: `../Project Ant Swarm/02-coding-harness/02-roadmap-and-story-backlog.md`
    (section "H0 Foundation and model round-trip").
  - Technical plan: `../Project Ant Swarm/02-coding-harness/01-technical-plan.md`.
    The relevant sections are 5 (boundaries), 6 (state model and turn algorithm),
    10 (events and continuation privacy), 11 (usage semantics), and 15
    (deterministic model-contract tests).

CH-003 requires you to write a new ADR for the decisions you make.

## CH-002: Run a scripted model/tool exchange

Type: AFK. Blocked by: CH-001.

**Story:** As a harness developer, I can exercise a complete model/tool
round-trip without an API call.

**Build tasks (from the backlog):** Define versioned Session, Run, Attempt,
ModelMessage, ToolCall, ToolResult, Event, Budget, Approval, VerificationResult,
Artifact, and FinalResult contracts. Build a scripted fake streaming model and a
harmless fixture tool. Define the terminal states and where schema conversion
happens.

**Acceptance criteria (from the backlog):**

- [ ] A fixture streams text, emits a complete, validated tool call, receives
  the matching result, and ends with exactly one terminal result.
- [ ] Fragmented JSON, malformed arguments, missing usage, errors, and aborts are
  controllable fixtures. Partial tool calls never execute.
- [ ] Public contracts contain no Pi-native types. Schema validation rejects
  incompatible versions.

**Demo (from the backlog):** Replay the same scenario twice and compare the
observable events, ignoring generated IDs and timestamps.

**Constraints from the technical plan and ADRs:**

- Use Zod for public protocol validation. Generate each tool's JSON Schema from
  one source of truth; do not hand-write a second copy of the schema.
- Every durable event has a `schemaVersion`, session, run, and attempt IDs, a
  monotonic `sequence`, a timestamp, an event type, and a typed payload.
  Sequence numbers, not clocks, define order.
- Core receives its dependencies (model, events, clock, and so on) instead of
  creating them. It does not read stdin, print to stdout, read provider
  environment variables, or assume a TTY.
- A partial or failed model response must not execute any tool. Complete calls
  run one at a time, in order, and each result is paired with its call.
- Unknown tools and malformed arguments go back to the model as recoverable
  observations, up to a small limit.
- A `length` stop is not success.
- Missing usage is reported as unknown, never as zero.

**Inferred (not stated in the ticket; confirm or change):**

- *Inferred:* The later-story records (Session, Run, Attempt, Budget,
  Approval, VerificationResult, Artifact) only need minimal shapes now. They grow
  in CH-015, CH-017, and CH-025. The plan warns against scaffolding empty
  modules for future features.
- *Inferred:* "Incompatible versions" means any `schemaVersion` other than the
  current one is rejected, including a missing or wrongly typed version.
- *Inferred:* Partial-call cases to cover include a stream that errors mid-call,
  a call that never finishes, a missing or contradictory stop reason, and a
  fragment for a call that was never started.
- *Inferred:* An abort before the first model request and an abort during
  streaming both end in a cancelled terminal state, with no tool execution.
- *Inferred:* A source-level check (a test) that Pi types do not appear in the
  public contract is the practical way to prove the "no Pi-native types" criterion.
- *Inferred:* The demo can be shown from the CLI, for example as a new
  subcommand that prints events. The existing smoke tests must keep passing.

## CH-003: Prove one real model adapter

Type: HITL, so you make and record decisions. Blocked by: CH-002.

**Story:** As a developer, I can use one explicitly configured model through the
same contract as the fake model.

**Build tasks (from the backlog):** Verify the Pi package's registry artifact,
engine requirements, exports, and license. Pin the selected Pi release. Select
one accessible provider and model pair. Implement adapter translation and
capability checks. Record the choice and a bounded paid smoke-test budget.

**Acceptance criteria (from the backlog):**

- [ ] The adapter streams text, performs a harmless tool round-trip, reports
  stop reason and usage, and aborts correctly.
- [ ] Invalid credentials fail without a retry. Transient errors have bounded
  adapter behavior. Unknown cost stays unknown.
- [ ] Credentials are explicit, excluded from logs, and never loaded from
  unrelated cached logins. No moving `latest` model alias is used.
- [ ] Provider-required continuation metadata stays behind the adapter, and its
  compatibility with persistence is documented.

**Demo (from the backlog):** Run one fake and one real exchange through the same
consumer.

**Constraints from the technical plan and ADRs:**

- Use `@earendil-works/pi-ai` only for transport, normalized streaming, model
  metadata, and usage (ADR 0001). Do not use Pi agent core, coding agent,
  sessions, or extensions. Pi types stay inside the adapter.
- Pin an exact version that you verified yourself. The plan's version number is
  a starting point to check, not a decision.
- Configure an exact model ID. Never fall back to a moving alias.
- Never retry authentication errors. Bound transient retries; the plan's
  default is 2. A retried request may be billed twice.
- Do not put auth headers, raw private reasoning, or unrestricted provider
  payloads in events.
- Opaque continuation metadata stays in an adapter-owned envelope. If resuming
  needs metadata that is not available, refuse explicitly; never drop it silently.
- Deterministic checks (`pnpm check`, CI) must never call a paid API.
- Paid calls use a deliberately chosen model and a bounded smoke-test budget.

**Inferred (not stated in the ticket; confirm or change):**

- *Inferred:* The credential comes from one dedicated, harness-specific
  environment variable in a git-ignored `.env`. Ambient provider variables
  meant for other tools are ignored, and a missing key gives a clear CLI error
  without echoing any secret.
- *Inferred:* Most adapter tests can run deterministically by feeding recorded
  or fabricated provider responses through Pi's real code path, with no network.
  A separate opt-in paid smoke test covers the real round-trip, abort, and
  invalid-key cases.
- *Inferred:* The smoke budget is enforced, for example by refusing a run whose
  worst case would exceed the remaining budget, rather than only written down.
- *Inferred:* Cache-read and cache-write tokens are reported separately and are
  not hidden inside, or double-counted in, the input totals.
- *Inferred:* Refusal or safety stops from the provider end the run as a
  failure, not as an answer.
- *Inferred:* The new ADR records the Pi version and why you chose it, the
  provider/model, the retry and timeout defaults, the budget, credential
  handling, and the continuation-state decision.

## Milestones

Each milestone should leave `pnpm check` green. Commit each one separately
using Conventional Commits.

**CH-002**

1. **Contracts.** Versioned Zod records exist. A record with the wrong
   version, a missing version, or a wrongly typed version is rejected; a valid
   record parses.
2. **Fixture tool.** The harmless tool validates its arguments, and its JSON
   Schema is generated from those same arguments.
3. **Scripted model.** A fake model plays back a scripted stream (text, tool-call
   fragments, a stop reason, and usage), and a script can inject each failure point.
4. **Happy-path loop.** One run streams text, executes one complete tool call,
   sends the paired result back on the next request, and returns exactly one
   terminal result.
5. **Failure paths.** Each fixture from the acceptance list ends in its own
   specific outcome. An execution counter proves that partial calls never run.
6. **Replay demo.** Running the scenario twice gives identical events once IDs
   and timestamps are removed.
7. **Evidence.** Write down what you verified, like `docs/ch-001-evidence.md`.

**CH-003**

1. **Spike and decide.** Inspect the Pi package (version, engines, exports,
   license, install scripts). Choose a provider and model you can access and set
   a budget. Write the ADR.
2. **Offline adapter.** The adapter turns provider streams into the CH-002
   contract. Deterministic tests cover the tool round-trip, stop reasons, usage
   and cost, and aborts, without network access.
3. **Errors and credentials.** Invalid keys fail after exactly one request.
   Transient errors retry up to the limit and then fail. Ambient credentials and
   aliases are rejected. Keys never appear in output.
4. **Continuation state.** Continuation metadata stays behind the adapter, and a
   request that needs missing state is refused explicitly.
5. **Paid smoke test.** Opt-in and budget-capped. It covers a real round-trip,
   an abort, and an invalid key.
6. **Same consumer demo.** Run one fake exchange and one real exchange through
   the same consumer. Record the evidence and the spend.

## Ground rules for this workspace

- Never commit `.env`, keys, `dist/`, `node_modules/`, or `.ant-agent/` state.
  They are already git-ignored.
- This branch has no upstream. Pushing triggers `pnpm preflight`, and pushing
  to `main` would mix it with the real history, so do not push it.
