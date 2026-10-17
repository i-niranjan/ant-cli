# CH-002 scripted model/tool exchange evidence

Verified on 2026-10-17 on macOS (arm64), Node 22.22.0, pnpm 12.11.2.
Linux CI and the pre-push preflight run the same `pnpm check`.

## What exists

- Versioned Zod contracts in `src/protocol/contracts.ts`: ModelMessage,
  ToolCall, ToolResult, ToolDefinition, StopReason, Usage, UsageTotals,
  TerminalState, FinalResult, and Event (schemaVersion, session/run/attempt IDs,
  monotonic sequence, timestamp, typed payload). Session, Run, Attempt, Budget,
  Approval, VerificationResult, and Artifact are deliberately minimal and grow
  with CH-015, CH-017, and CH-025.
- `ModelClient` normalized stream and `ScriptedModel` in `src/model/`.
- `add_numbers` fixture tool; tool JSON Schema is generated from its Zod
  arguments (Zod 4.6.5, `z.toJSONSchema`), so no handwritten schema exists.
- `runAgent` in `src/core/run.ts` with injected EventSink, Clock, IDs, budget,
  and AbortSignal. It emits validated events and returns one FinalResult.

## Acceptance checks (test/agent.test.js)

- [x] A fixture streams text, emits a complete validated tool call, receives the
  matching result, and ends with one terminal result. The second model request
  carries the assistant call and the result paired by `call_1`.
- [x] Fragmented JSON (3-char and interleaved 1-char fragments across two
  calls), malformed JSON, non-object arguments, schema-invalid arguments,
  unknown tools, missing usage, stream error, length stop, abort during
  streaming, and abort before the first request are fixtures. Partial calls
  (error mid-call, unended call, missing stop reason, mismatched stop reason,
  unopened index) never execute, checked with an execution counter, and each
  fails with its specific reason.
- [x] Public contracts contain no Pi-native types (source scan of protocol,
  model, core, tools). `parseVersioned` rejects schemaVersion 2, 0, "1", and
  missing.

Missing usage is counted in `unreportedRequests`; it is never shown as zero
tokens for that request. Invalid tool calls return error results to the model
and fail the run after `maxInvalidToolCalls`.

Mutation check: disabling the incomplete-call guard, argument validation, the
stream-error path, or unreported-usage counting each makes a test fail.

## Demo

The replay test runs the scenario twice with real UUIDs and clock and compares
events with IDs and timestamps removed: identical. Manual demo:

```text
$ node dist/cli.js demo
 0 run_started  {"task":"What is 2 + 3?"}
 ...
 5 tool_call_requested  {"toolCall":{"id":"call_1","name":"add_numbers","arguments":{"a":2,"b":3}}}
 6 tool_result  {"result":{"toolCallId":"call_1","toolName":"add_numbers","isError":false,"content":"5"}}
 ...
11 run_finished  answered: "2 + 3 = 5." (1 tool call, 2 model requests, 113/25 tokens in/out)
```

## Limits

No real model, retries, deadlines, journal, or approvals yet. A `length` stop
fails instead of attempting the planned bounded recovery. Ending a run with a
fake answer uses the `answered` state because modes do not exist yet.
