import type {
  ModelMessage,
  ToolDefinition,
  Usage,
} from "../protocol/contracts.js";

// Normalized stream every model adapter produces. Tool-call arguments arrive as
// JSON text fragments keyed by index and are only usable after tool_call_end.
export type ModelStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "tool_call_delta"; index: number; argumentsDelta: string }
  | { type: "tool_call_end"; index: number }
  | { type: "usage"; usage: Usage }
  | { type: "finish"; stopReason: "end_turn" | "tool_use" | "length" }
  | { type: "error"; message: string };

export interface ModelRequest {
  messages: readonly ModelMessage[];
  tools: readonly ToolDefinition[];
}

export interface ModelClient {
  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
