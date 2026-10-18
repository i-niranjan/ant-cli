import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FinalResultSchema,
  ModelMessageSchema,
  ToolCallSchema,
  ToolResultSchema,
} from "../dist/contracts.js";

const call = {
  schemaVersion: 1,
  callId: "call_01",
  toolName: "add",
  arguments: { a: 10, b: 20 },
};
const result = {
  schemaVersion: 1,
  callId: "call_01",
  status: "success",
  output: 30,
};

const examples = [
  [ToolCallSchema, call],
  [ToolResultSchema, result],
  [
    ToolResultSchema,
    { ...result, status: "error", error: "Invalid arguments" },
  ],
  [
    ModelMessageSchema,
    { schemaVersion: 1, role: "user", content: "Add 10 and 20" },
  ],
  [
    ModelMessageSchema,
    { schemaVersion: 1, role: "assistant", content: "", toolCalls: [call] },
  ],
  [ModelMessageSchema, { schemaVersion: 1, role: "tool", result }],
  [FinalResultSchema, { schemaVersion: 1, status: "success", output: "30" }],
  [
    FinalResultSchema,
    { schemaVersion: 1, status: "failure", error: "Model failed" },
  ],
  [FinalResultSchema, { schemaVersion: 1, status: "cancelled" }],
  [
    FinalResultSchema,
    { schemaVersion: 1, status: "cancelled", reason: "User aborted" },
  ],
];

test("all supported contract variants parse", () => {
  for (const [schema, example] of examples) {
    assert.equal(schema.safeParse(example).success, true);
  }
});

test("every contract variant rejects incompatible or missing versions", () => {
  for (const [schema, example] of examples) {
    for (const schemaVersion of [2, "1", null]) {
      assert.equal(
        schema.safeParse({ ...example, schemaVersion }).success,
        false,
      );
    }
    const { schemaVersion: _version, ...unversioned } = example;
    assert.equal(schema.safeParse(unversioned).success, false);
  }
});

test("tool calls reject empty identifiers and non-object arguments", () => {
  for (const invalid of [
    { ...call, callId: "" },
    { ...call, toolName: "" },
    { ...call, arguments: '{"a":10}' },
    { ...call, arguments: null },
    { ...call, arguments: [] },
  ]) {
    assert.equal(ToolCallSchema.safeParse(invalid).success, false);
  }
});

test("tool results preserve the call ID and require error details", () => {
  assert.equal(
    ToolResultSchema.parse(result).callId,
    ToolCallSchema.parse(call).callId,
  );
  for (const invalid of [
    { ...result, callId: "" },
    { ...result, status: "unknown" },
    { schemaVersion: 1, callId: "call_01", status: "error" },
    { schemaVersion: 1, callId: "call_01", status: "error", error: "" },
  ]) {
    assert.equal(ToolResultSchema.safeParse(invalid).success, false);
  }
});

test("messages validate nested tool calls and results", () => {
  assert.equal(
    ModelMessageSchema.safeParse({
      schemaVersion: 1,
      role: "assistant",
      content: "",
      toolCalls: [{ ...call, schemaVersion: 2 }],
    }).success,
    false,
  );
  assert.equal(
    ModelMessageSchema.safeParse({
      schemaVersion: 1,
      role: "tool",
      result: { ...result, callId: "" },
    }).success,
    false,
  );
});

test("final results reject unknown states and missing outcome details", () => {
  for (const invalid of [
    { schemaVersion: 1, status: "pending" },
    { schemaVersion: 1, status: "success" },
    { schemaVersion: 1, status: "failure" },
    { schemaVersion: 1, status: "failure", error: "" },
  ]) {
    assert.equal(FinalResultSchema.safeParse(invalid).success, false);
  }
});
