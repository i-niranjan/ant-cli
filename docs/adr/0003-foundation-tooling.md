# ADR 0003: Small reproducible foundation

Date: 2026-10-15. Status: Accepted.

Use one private ESM TypeScript package, strict checking, Node 22.22.0, and
pnpm 12.11.2. Exact direct dependency versions and the frozen lockfile define
installation. The planning backlog stays outside this repository; CH IDs are
the current task references. Git commits provide local checkpoints.

Use Node's built-in test runner for deterministic CLI process smoke tests.
Tests build first to exercise the shipped JavaScript and compare source behavior.
Use Biome for lint, formatting, and import checks. TypeScript remains the type
checker. No additional test framework is needed for the current slice.

Husky installs local hooks through the prepare script. Pre-commit runs the full
foundation check without modifying files. Commitlint enforces Conventional
Commits through commit-msg. Hooks check the working tree; developers must inspect
their staged diff. CI independently runs the same checks because hooks can be
disabled. Linux CI is configured; hosted execution requires publishing the repo.

Generated build output, credentials, and local agent state are ignored. Keep
dependency updates explicit and reviewed. Model adapter tooling remains CH-003.
