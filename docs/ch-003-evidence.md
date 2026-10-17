# CH-003 real model adapter evidence

Verified on 2026-10-18 on macOS (arm64), Node 22.22.0, pnpm 12.11.2, with
`@earendil-works/pi-ai` 1.3.0 and `anthropic/claude-haiku-5-5`. Decisions are
in [ADR 0004](adr/0004-first-model-adapter.md).

## Deterministic adapter tests (test/pi-adapter.test.js, run in CI)

These drive Pi's real Anthropic code path through a fake HTTP transport that
replays Anthropic SSE streams and error responses.

- Tool round-trip: text, a fragmented `input_json_delta` tool call, the
  `add_numbers` result, and a final answer; stop reasons `tool_use` then
  `end_turn`; tokens, cache reads, and cost match Haiku 5.5 list prices.
- Request shape: explicit `x-api-key`, exact model, our JSON Schema as
  `input_schema`, `max_tokens` 1024, effort `low`, thinking display `omitted`.
- Continuation: the thinking signature is resent unchanged with the tool use and
  paired tool result; neither the key, thinking text, nor signature reaches
  events. A request needing missing continuation state is refused before any
  HTTP call.
- 401 fails after exactly one request with unknown usage; 529 retries and
  recovers; three 529s with `maxRetries: 2` fail after exactly three requests.
- Abort mid-stream cancels and the pending tool never runs; a refusal fails.
- Empty or whitespace keys, `latest` aliases, and unknown models are rejected;
  an ambient `ANTHROPIC_API_KEY` is ignored. The CLI exits 2 without the
  harness key and never echoes ambient keys.

## Paid smoke test (`pnpm smoke:anthropic`, 2026-10-18)

```text
Budget $1: spent $0.000000 so far; this run is capped at $0.0073 worst case.

round-trip: stop reasons tool_use -> end_turn; "2 + 3 equals 5."
abort: cancelled after 3 reported output tokens
invalid-key: failed after 1 request (model error: 401 ... authentication_error ... invalid x-api-key)

This run: $0.000175. Total spent: $0.000175 of $1.
Smoke test passed.
```

## Demo: one fake and one real exchange through the same consumer

```text
$ node dist/cli.js demo
11 run_finished  answered: "2 + 3 = 5." (1 tool call, 2 model requests, ..., cost unknown for 2 of 2 requests)

$ node --env-file=.env dist/cli.js demo --model anthropic/claude-haiku-5-5
 2 model_response_completed  {"stopReason":"tool_use","usage":{"inputTokens":4,"outputTokens":70,"cacheReadTokens":518,"cacheWriteTokens":0,"costUsd":0.00004058}}
 3 tool_call_requested  {"toolCall":{"id":"toolu_0112z8GWvmEeDkYsbWskMmfY","name":"add_numbers","arguments":{"a":2,"b":3}}}
 4 tool_result  {"result":{"toolCallId":"toolu_0112z8GWvmEeDkYsbWskMmfY","toolName":"add_numbers","isError":false,"content":"5"}}
 8 model_response_completed  {"stopReason":"end_turn","usage":{"inputTokens":2,"outputTokens":12,"cacheReadTokens":596,"cacheWriteTokens":0,"costUsd":0.00001216}}
 9 run_finished  answered: "2 + 3 = 5." (1 tool call, 2 model requests, 6 in + 1114 cached / 82 out tokens, $0.000053)
```

Events 2 to 8 are from the first real run; the summary line is from a second
run after adding cache totals, which reported identical token counts and cost.
The scripted model reports no usage, so its cost is shown as unknown, not $0.

The first real demo summed only uncached input ("6 tokens in"), which hid
1,114 cache-read tokens. Cache read/write totals were added to `UsageTotals`
and the summary line; cost was already correct because Pi prices cache reads.

## Spend

Ledger: $0.000175 (smoke). Demo runs are not ledgered: two runs at about
$0.000053 each. Total real spend for CH-003: about $0.00028 of the $1 budget.

## Limits

No adapter for other providers. No deadline across retries beyond the per-request
timeout. Continuation state is in-memory only (see ADR 0004). A `length` stop
still fails without the planned bounded recovery.
