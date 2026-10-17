import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { runAgent } from "../dist/core/run.js";
import { fragmentedToolCall, ScriptedModel } from "../dist/model/scripted.js";
import {
  Event,
  IncompatibleSchemaVersionError,
  parseVersioned,
} from "../dist/protocol/contracts.js";
import { addNumbers } from "../dist/tools/add-numbers.js";
import { defineTool } from "../dist/tools/tool.js";

const root = new URL("../", import.meta.url);

const usage = (inputTokens, outputTokens) => ({
  type: "usage",
  usage: { inputTokens, outputTokens },
});
const text = (t) => ({ type: "text_delta", text: t });
const finish = (stopReason) => ({ type: "finish", stopReason });

// Two-request happy path: ask for a tool, then answer with its result.
const happyPath = () => [
  [
    text("Let me "),
    text("add those."),
    ...fragmentedToolCall(0, "call_1", "add_numbers", '{"a":2,"b":3}'),
    usage(10, 5),
    finish("tool_use"),
  ],
  [text("The sum is 5."), usage(20, 4), finish("end_turn")],
];

// Counts executions so tests can prove a call never ran.
function spyTool() {
  const spy = { runs: 0 };
  spy.tool = defineTool({
    name: "add_numbers",
    description: "Add two numbers.",
    args: z.strictObject({ a: z.number(), b: z.number() }),
    async execute({ a, b }) {
      spy.runs++;
      return String(a + b);
    },
  });
  return spy;
}

function deterministic() {
  let tick = 0;
  return {
    clock: { now: () => new Date(Date.UTC(2026, 9, 17, 0, 0, 0, tick++)) },
    ids: (kind) => `${kind}-1`,
  };
}

async function run(scripts, options = {}) {
  const events = [];
  const model = new ScriptedModel(scripts);
  const result = await runAgent({
    task: "add 2 and 3",
    model,
    tools: [addNumbers],
    events: { emit: (e) => events.push(e) },
    ...deterministic(),
    ...options,
  });
  return { result, events, model, types: events.map((e) => e.type) };
}

function assertSingleTerminal(events, result) {
  const finished = events.filter((e) => e.type === "run_finished");
  assert.equal(finished.length, 1);
  assert.equal(events.at(-1).type, "run_finished");
  assert.deepEqual(finished[0].payload.result, result);
  assert.deepEqual(
    events.map((e) => e.sequence),
    events.map((_, i) => i),
  );
  for (const e of events) Event.parse(e);
}

test("scripted model streams text, completes a tool round-trip, and ends once", async () => {
  const { result, events, model, types } = await run(happyPath());

  assert.deepEqual(types, [
    "run_started",
    "model_request_started",
    "text_delta",
    "text_delta",
    "model_response_completed",
    "tool_call_requested",
    "tool_result",
    "model_request_started",
    "text_delta",
    "model_response_completed",
    "run_finished",
  ]);
  assert.equal(result.state, "answered");
  assert.equal(result.text, "The sum is 5.");
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(result.usage, {
    modelRequests: 2,
    unreportedRequests: 0,
    inputTokens: 30,
    outputTokens: 9,
  });
  assertSingleTerminal(events, result);

  const toolResult = events.find((e) => e.type === "tool_result");
  assert.deepEqual(toolResult.payload.result, {
    toolCallId: "call_1",
    toolName: "add_numbers",
    isError: false,
    content: "5",
  });

  // The second request carries the assistant call and its paired result.
  assert.deepEqual(model.requests[1].messages.slice(1), [
    {
      role: "assistant",
      text: "Let me add those.",
      toolCalls: [
        { id: "call_1", name: "add_numbers", arguments: { a: 2, b: 3 } },
      ],
    },
    { role: "tool", result: toolResult.payload.result },
  ]);
});

test("tool definitions are JSON Schema generated from the Zod arguments", async () => {
  const { model } = await run(happyPath());
  const [definition] = model.requests[0].tools;
  assert.equal(definition.name, "add_numbers");
  assert.equal(definition.parameters.type, "object");
  assert.deepEqual(definition.parameters.required, ["a", "b"]);
  assert.equal(definition.parameters.properties.a.type, "number");
  assert.equal(definition.parameters.additionalProperties, false);
  assert.equal(definition.parameters.$schema, undefined);
});

test("interleaved one-character fragments reassemble into separate calls in index order", async () => {
  const a = fragmentedToolCall(0, "call_a", "add_numbers", '{"a":1,"b":2}', 1);
  const b = fragmentedToolCall(
    1,
    "call_b",
    "add_numbers",
    '{"a":10,"b":20}',
    1,
  );
  const interleaved = [b[0], a[0]];
  for (let i = 1; i < Math.max(a.length, b.length); i++) {
    if (b[i]) interleaved.push(b[i]);
    if (a[i]) interleaved.push(a[i]);
  }
  const { result, events } = await run([
    [...interleaved, finish("tool_use")],
    [text("3 and 30"), finish("end_turn")],
  ]);
  assert.equal(result.state, "answered");
  assert.deepEqual(
    events
      .filter((e) => e.type === "tool_result")
      .map((e) => [e.payload.result.toolCallId, e.payload.result.content]),
    [
      ["call_a", "3"],
      ["call_b", "30"],
    ],
  );
});

test("malformed, invalid, and unknown tool calls become error results without executing", async () => {
  for (const [name, json, reason] of [
    ["add_numbers", '{"a":2,', /not valid JSON/],
    ["add_numbers", "[1,2]", /JSON object/],
    ["add_numbers", '{"a":"two","b":3}', /expected number/],
    ["delete_everything", "{}", /unknown tool/],
  ]) {
    const spy = spyTool();
    const { result, events, model } = await run(
      [
        [...fragmentedToolCall(0, "call_1", name, json), finish("tool_use")],
        [text("Sorry."), finish("end_turn")],
      ],
      { tools: [spy.tool] },
    );
    assert.equal(spy.runs, 0, `${name} ${json} must not execute`);
    assert.equal(result.state, "answered");
    const rejected = events.find((e) => e.type === "tool_call_rejected");
    assert.match(rejected.payload.reason, reason);
    const sent = model.requests[1].messages.at(-1);
    assert.equal(sent.role, "tool");
    assert.equal(sent.result.isError, true);
    assert.equal(sent.result.toolCallId, "call_1");
  }
});

test("too many invalid tool calls fail the run", async () => {
  const { result } = await run(
    [[...fragmentedToolCall(0, "call_1", "nope", "{}"), finish("tool_use")]],
    {
      budget: { maxModelRequests: 5, maxToolCalls: 5, maxInvalidToolCalls: 0 },
    },
  );
  assert.equal(result.state, "failed");
  assert.match(result.reason, /invalid tool calls/);
});

test("partial tool calls never execute", async () => {
  const start = fragmentedToolCall(0, "call_1", "add_numbers", '{"a":2,"b":3}');
  const cases = [
    [
      "stream error mid-call",
      [...start.slice(0, 3), { type: "error", message: "overloaded" }],
      /model error: overloaded/,
    ],
    [
      "call never ended",
      [...start.slice(0, -1), finish("tool_use")],
      /incomplete tool call call_1/,
    ],
    ["no stop reason", start, /without a stop reason/],
    [
      "tool_use without calls",
      [text("hmm"), finish("tool_use")],
      /tool_use with 0/,
    ],
    ["calls with end_turn", [...start, finish("end_turn")], /end_turn with 1/],
    [
      "delta for unknown index",
      [{ type: "tool_call_delta", index: 4, argumentsDelta: "{}" }],
      /index 4 is not open/,
    ],
  ];
  for (const [name, script, reason] of cases) {
    const spy = spyTool();
    const { result, events, types } = await run([script], {
      tools: [spy.tool],
    });
    assert.equal(spy.runs, 0, name);
    assert.equal(result.state, "failed", name);
    assert.match(result.reason, reason, name);
    assert.ok(!types.includes("tool_call_requested"), name);
    assertSingleTerminal(events, result);
  }
});

test("abort during streaming cancels without executing the pending call", async () => {
  const spy = spyTool();
  const controller = new AbortController();
  const events = [];
  const result = await runAgent({
    task: "add",
    model: new ScriptedModel(happyPath()),
    tools: [spy.tool],
    signal: controller.signal,
    events: {
      emit(e) {
        events.push(e);
        if (e.type === "text_delta") controller.abort();
      },
    },
    ...deterministic(),
  });
  assert.equal(result.state, "cancelled");
  assert.equal(spy.runs, 0);
  assert.equal(
    events.find((e) => e.type === "model_response_completed").payload
      .stopReason,
    "aborted",
  );
  assertSingleTerminal(events, result);
});

test("abort before the first request cancels without calling the model", async () => {
  const controller = new AbortController();
  controller.abort();
  const { result, model } = await run(happyPath(), {
    signal: controller.signal,
  });
  assert.equal(result.state, "cancelled");
  assert.equal(result.usage.modelRequests, 0);
  assert.equal(model.requests.length, 0);
});

test("missing usage is reported as unknown, not zero", async () => {
  const { result, events } = await run([[text("Hi."), finish("end_turn")]]);
  assert.deepEqual(result.usage, {
    modelRequests: 1,
    unreportedRequests: 1,
    inputTokens: 0,
    outputTokens: 0,
  });
  const completed = events.find((e) => e.type === "model_response_completed");
  assert.equal("usage" in completed.payload, false);
});

test("length stop, tool failures, and budgets have explicit outcomes", async () => {
  const length = await run([[text("Once upon"), finish("length")]]);
  assert.equal(length.result.state, "failed");
  assert.match(length.result.reason, /length limit/);

  const broken = defineTool({
    name: "add_numbers",
    description: "Always fails.",
    args: z.strictObject({}),
    async execute() {
      throw new Error("disk on fire");
    },
  });
  const failing = await run(
    [
      [
        ...fragmentedToolCall(0, "call_1", "add_numbers", "{}"),
        finish("tool_use"),
      ],
      [text("It failed."), finish("end_turn")],
    ],
    { tools: [broken] },
  );
  assert.equal(failing.result.state, "answered");
  const toolResult = failing.events.find((e) => e.type === "tool_result");
  assert.equal(toolResult.payload.result.isError, true);
  assert.match(toolResult.payload.result.content, /disk on fire/);

  const exhausted = await run(happyPath(), {
    budget: { maxModelRequests: 1, maxToolCalls: 5, maxInvalidToolCalls: 3 },
  });
  assert.equal(exhausted.result.state, "budget_exhausted");
  assert.equal(exhausted.result.toolCalls, 1);
});

test("versioned records reject other schema versions", async () => {
  const { events } = await run(happyPath());
  const event = events[0];
  assert.deepEqual(parseVersioned(Event, event), event);
  for (const version of [2, 0, "1", undefined]) {
    assert.throws(
      () => parseVersioned(Event, { ...event, schemaVersion: version }),
      IncompatibleSchemaVersionError,
    );
  }
  assert.throws(
    () => parseVersioned(Event, { ...event, sequence: -1 }),
    z.ZodError,
  );
});

test("public contracts contain no Pi-native types", () => {
  const dirs = ["src/protocol", "src/model", "src/core", "src/tools"];
  for (const dir of dirs) {
    for (const file of readdirSync(new URL(dir, root))) {
      const source = readFileSync(new URL(`${dir}/${file}`, root), "utf8");
      assert.doesNotMatch(source, /pi-ai|earendil/i, `${dir}/${file}`);
    }
  }
});

test("replaying a scenario produces the same observable events", async () => {
  const replay = async () => {
    const events = [];
    await runAgent({
      task: "add 2 and 3",
      model: new ScriptedModel(happyPath()),
      tools: [addNumbers],
      events: { emit: (e) => events.push(e) },
    });
    return events;
  };
  const [first, second] = [await replay(), await replay()];
  assert.notEqual(first[0].runId, second[0].runId);

  const observable = (events) =>
    events.map(({ sessionId, runId, attemptId, timestamp, ...rest }) =>
      JSON.parse(
        JSON.stringify(rest, (key, value) =>
          ["sessionId", "runId", "attemptId"].includes(key) ? undefined : value,
        ),
      ),
    );
  assert.deepEqual(observable(first), observable(second));
});
