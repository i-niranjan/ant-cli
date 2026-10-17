# ADR 0004: First real model adapter

Date: 2026-10-18. Status: Accepted.

CH-003 needs one real provider/model behind `ModelClient`, reached through Pi
as ADR 0001 decided.

## Decision

- Transport: `@earendil-works/pi-ai` pinned to exactly 1.3.0 (MIT, Node
  >=22.19.0, all dependencies exact-pinned upstream; Anthropic calls go through
  `@anthropic-ai/sdk` 0.129.0). 1.3.0 is the version whose source we reviewed;
  1.0.x predates Claude Haiku 5.5. `pi-telemetry` is contracts only, with no
  exporter or network access. Unused provider install scripts
  (`@google/genai`, `protobufjs`) are denied in `pnpm-workspace.yaml`.
  The package installs every provider SDK (about 240 MB of node_modules); only
  the Anthropic provider is registered and loaded.
- Model: `anthropic/claude-haiku-5-5`, an exact ID. Moving aliases are
  rejected. Smoke defaults: 1024 max output tokens, effort `low`, 2 transient
  retries, 120 s request timeout.
- Paid smoke budget: $1.00 total, enforced by `pnpm smoke:anthropic` through a
  git-ignored ledger (`.ant-agent/smoke-spend.json`) that refuses a run whose
  worst case would exceed the remaining budget. Haiku 5.5 lists at $0.10 input,
  $0.50 output, and $0.01 cache read per million tokens under 100K-token prompts.

## Boundaries

- `src/model/pi.ts` is the only module importing Pi; a test enforces this.
- Credentials: the key comes only from `ANT_AGENT_ANTHROPIC_API_KEY`, passed
  explicitly on every request with an empty provider `env`, so ambient
  `ANTHROPIC_API_KEY`, OAuth tokens, and Pi credential stores are never used.
  The key never appears in events, errors, or logs.
- Retries: Pi retries only 408, 409, 429, 5xx, and network errors, up to
  `maxRetries`. Authentication errors are never retried. A retried request may
  be billed more than once.
- Usage and cost: tokens (including cache reads/writes) and Pi's computed cost
  are reported per response. A response with no reported input is unknown
  usage, never zero. Partial usage on errors and aborts is reported when the
  provider sent it; output tokens after an abort may be undercounted.
- Stop reasons: `stop`, `toolUse`, `length` map to ours. Refusals, safety
  stops, and Pi's `deferred` become errors, so the run fails.

## Continuation state

Haiku 5.5 thinks adaptively. Anthropic requires earlier assistant turns,
including opaque thinking signatures, to be resent unchanged. The adapter keeps
Pi's original assistant message in memory, keyed by the text and tool-call IDs
core records, and substitutes it on the next request. Thinking display is
`omitted`, so no thinking text is received, shown, or stored; signatures never
reach events.

Persistence compatibility: this state is not persisted. A resumed session (or
a different client instance) has no continuation state, and the adapter refuses
the request instead of silently dropping required context. Session storage
(CH-015) must decide whether to store this adapter-owned envelope separately
from exported traces or disable resume for thinking models.
