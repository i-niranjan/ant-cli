// Exercises the Pi adapter and Pi's real Anthropic code path against a fake
// HTTP transport, so no network or API key is needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runAgent } from "../dist/core/run.js";
import { ModelConfigError, PiModelClient } from "../dist/model/pi.js";
import { addNumbers } from "../dist/tools/add-numbers.js";

const KEY = "sk-ant-test-key-not-real";

function sse(events, { hangAfter, signal } = {}) {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (hangAfter !== undefined && i === hangAfter) {
        // Hold the stream open until the caller aborts.
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        );
        controller.error(new DOMException("aborted", "AbortError"));
        return;
      }
      if (i >= events.length) return controller.close();
      const event = events[i++];
      controller.enqueue(
        encoder.encode(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        ),
      );
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", "request-id": "req_test" },
  });
}

function apiError(status, type, message) {
  return new Response(
    JSON.stringify({ type: "error", error: { type, message } }),
    {
      status,
      headers: { "content-type": "application/json", "retry-after-ms": "0" },
    },
  );
}

const start = (input) => ({
  type: "message_start",
  message: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: input, output_tokens: 1 },
  },
});
const block = (index, content_block) => ({
  type: "content_block_start",
  index,
  content_block,
});
const delta = (index, d) => ({ type: "content_block_delta", index, delta: d });
const stop = (index) => ({ type: "content_block_stop", index });
const end = (stop_reason, output) => [
  {
    type: "message_delta",
    delta: { stop_reason, stop_sequence: null },
    usage: { output_tokens: output },
  },
  { type: "message_stop" },
];

// Thinking with a signature, a short text, then a fragmented tool call.
const toolTurn = () => [
  start(400),
  block(0, { type: "thinking", thinking: "", signature: "" }),
  delta(0, { type: "thinking_delta", thinking: "Use the tool." }),
  delta(0, { type: "signature_delta", signature: "sig-opaque-123" }),
  stop(0),
  block(1, { type: "text", text: "" }),
  delta(1, { type: "text_delta", text: "Adding." }),
  stop(1),
  block(2, { type: "tool_use", id: "toolu_1", name: "add_numbers", input: {} }),
  delta(2, { type: "input_json_delta", partial_json: '{"a": 2' }),
  delta(2, { type: "input_json_delta", partial_json: ', "b": 3}' }),
  stop(2),
  ...end("tool_use", 30),
];
const answerTurn = () => [
  start(500),
  block(0, { type: "text", text: "" }),
  delta(0, { type: "text_delta", text: "2 + 3 = 5." }),
  stop(0),
  ...end("end_turn", 8),
];

function fakeFetch(responders) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({
      url: String(url),
      headers: new Headers(init.headers),
      body: JSON.parse(init.body),
    });
    const respond = responders[calls.length - 1];
    if (!respond) throw new Error(`unexpected request ${calls.length}`);
    return respond(init);
  };
  return { fetch, calls };
}

function client(fetch, overrides = {}) {
  return new PiModelClient({
    provider: "anthropic",
    modelId: "claude-haiku-5-5",
    apiKey: KEY,
    maxOutputTokens: 1024,
    maxRetries: 2,
    timeoutMs: 30_000,
    effort: "low",
    fetch,
    ...overrides,
  });
}

async function run(model, options = {}) {
  const events = [];
  const result = await runAgent({
    task: "What is 2 + 3?",
    model,
    tools: [addNumbers],
    events: { emit: (e) => events.push(e) },
    ...options,
  });
  return { result, events };
}

test("adapter completes a tool round-trip with usage, cost, and stop reasons", async () => {
  const { fetch, calls } = fakeFetch([
    () => sse(toolTurn()),
    () => sse(answerTurn()),
  ]);
  const { result, events } = await run(client(fetch));

  assert.equal(result.state, "answered");
  assert.equal(result.text, "2 + 3 = 5.");
  assert.equal(result.toolCalls, 1);
  assert.equal(result.usage.inputTokens, 900);
  assert.equal(result.usage.outputTokens, 38);
  assert.equal(result.usage.unreportedRequests, 0);
  assert.equal(result.usage.unpricedRequests, 0);
  // Haiku 5.5: $0.10 input, $0.50 output per million tokens.
  assert.ok(
    Math.abs(result.usage.costUsd - (900 * 0.1 + 38 * 0.5) / 1e6) < 1e-12,
  );

  const stops = events
    .filter((e) => e.type === "model_response_completed")
    .map((e) => e.payload.stopReason);
  assert.deepEqual(stops, ["tool_use", "end_turn"]);
  const toolResult = events.find((e) => e.type === "tool_result");
  assert.equal(toolResult.payload.result.content, "5");

  // Request shape: explicit key, exact model, our JSON Schema, low effort.
  const [first, second] = calls;
  assert.equal(first.headers.get("x-api-key"), KEY);
  assert.equal(first.body.model, "claude-haiku-5-5");
  assert.equal(first.body.stream, true);
  assert.equal(first.body.max_tokens, 1024);
  assert.deepEqual(first.body.tools[0].input_schema.required, ["a", "b"]);
  // Haiku 5.5 takes effort as a trailing per-message system marker.
  assert.deepEqual(first.body.messages.at(-1), {
    role: "system",
    content: [],
    output_config: { effort: "low" },
  });
  assert.equal(first.body.thinking.display, "omitted");

  // Continuation: the thinking signature goes back unchanged, then the result.
  const conversation = second.body.messages.filter((m) => m.role !== "system");
  assert.deepEqual(
    conversation.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  const [, assistant, toolMessage] = conversation;
  const thinking = assistant.content.find((b) => b.type === "thinking");
  assert.equal(thinking.signature, "sig-opaque-123");
  const toolUse = assistant.content.find((b) => b.type === "tool_use");
  assert.deepEqual([toolUse.id, toolUse.input], ["toolu_1", { a: 2, b: 3 }]);
  const toolResultBlock = toolMessage.content.find(
    (b) => b.type === "tool_result",
  );
  assert.equal(toolResultBlock.tool_use_id, "toolu_1");

  // Neither the key nor thinking text reaches events.
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes(KEY));
  assert.ok(!serialized.includes("Use the tool."));
  assert.ok(!serialized.includes("sig-opaque-123"));
});

test("invalid credentials fail once without retry or usage", async () => {
  const { fetch, calls } = fakeFetch([
    () => apiError(401, "authentication_error", "invalid x-api-key"),
    () => sse(answerTurn()),
  ]);
  const { result } = await run(client(fetch));
  assert.equal(calls.length, 1);
  assert.equal(result.state, "failed");
  assert.match(result.reason, /invalid x-api-key|401|auth/i);
  assert.equal(result.usage.unreportedRequests, 1);
  assert.equal(result.usage.unpricedRequests, 1);
});

test("transient errors retry a bounded number of times", async () => {
  const overloaded = () => apiError(529, "overloaded_error", "Overloaded");
  const recovered = fakeFetch([overloaded, () => sse(answerTurn())]);
  const ok = await run(client(recovered.fetch));
  assert.equal(recovered.calls.length, 2);
  assert.equal(ok.result.state, "answered");

  const exhausted = fakeFetch([overloaded, overloaded, overloaded, overloaded]);
  const failed = await run(client(exhausted.fetch, { maxRetries: 2 }));
  assert.equal(exhausted.calls.length, 3);
  assert.equal(failed.result.state, "failed");
  assert.match(failed.result.reason, /overloaded|529/i);
});

test("abort mid-stream cancels and never runs the pending tool", async () => {
  const controller = new AbortController();
  let ran = 0;
  const spy = {
    ...addNumbers,
    run: async (...args) => {
      ran++;
      return addNumbers.run(...args);
    },
  };
  const { fetch } = fakeFetch([
    (init) => sse(toolTurn(), { hangAfter: 10, signal: init.signal }),
  ]);
  const result = await runAgent({
    task: "What is 2 + 3?",
    model: client(fetch),
    tools: [spy],
    signal: controller.signal,
    events: { emit: (e) => e.type === "text_delta" && controller.abort() },
  });
  assert.equal(result.state, "cancelled");
  assert.equal(ran, 0);
});

test("a refusal or unknown stop reason ends the run as failed", async () => {
  const refusal = [
    start(300),
    {
      type: "message_delta",
      delta: { stop_reason: "refusal", stop_sequence: null },
      usage: { output_tokens: 0 },
    },
    { type: "message_stop" },
  ];
  const { fetch } = fakeFetch([() => sse(refusal)]);
  const { result } = await run(client(fetch));
  assert.equal(result.state, "failed");
  assert.equal(result.usage.inputTokens, 300);
});

test("configuration must be explicit", () => {
  assert.throws(() => client(undefined, { apiKey: "" }), ModelConfigError);
  assert.throws(() => client(undefined, { apiKey: "   " }), ModelConfigError);
  assert.throws(
    () => client(undefined, { modelId: "claude-haiku-latest" }),
    ModelConfigError,
  );
  assert.throws(
    () => client(undefined, { modelId: "claude-nonexistent-9" }),
    /unknown model/,
  );
});

test("ambient credentials are never used", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-ambient-should-not-be-used";
  try {
    const { fetch, calls } = fakeFetch([() => sse(answerTurn())]);
    await run(client(fetch));
    assert.equal(calls[0].headers.get("x-api-key"), KEY);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("missing continuation state is refused, not silently dropped", async () => {
  const { fetch, calls } = fakeFetch([() => sse(answerTurn())]);
  const events = [];
  for await (const event of client(fetch).stream(
    {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", text: "earlier", toolCalls: [] },
        { role: "user", content: "again" },
      ],
      tools: [],
    },
    new AbortController().signal,
  )) {
    events.push(event);
  }
  assert.equal(calls.length, 0);
  assert.equal(events.length, 1);
  assert.match(events[0].message, /continuation state/);
});
