import type { ModelStreamEvent } from "./client.js";
import { fragmentedToolCall } from "./scripted.js";

// Demo scenario: the model asks add_numbers for 2 + 3, then answers.
export function additionScenario(): ModelStreamEvent[][] {
  return [
    [
      { type: "text_delta", text: "I'll add " },
      { type: "text_delta", text: "those numbers." },
      ...fragmentedToolCall(0, "call_1", "add_numbers", '{"a":2,"b":3}'),
      { type: "usage", usage: { inputTokens: 42, outputTokens: 18 } },
      { type: "finish", stopReason: "tool_use" },
    ],
    [
      { type: "text_delta", text: "2 + 3 = " },
      { type: "text_delta", text: "5." },
      { type: "usage", usage: { inputTokens: 71, outputTokens: 7 } },
      { type: "finish", stopReason: "end_turn" },
    ],
  ];
}
