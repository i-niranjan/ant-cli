import { randomUUID } from "node:crypto";
import type { ModelClient, ModelRequest } from "../model/client.js";
import {
  type Budget,
  type Event,
  Event as EventSchema,
  type FinalResult,
  type ModelMessage,
  SCHEMA_VERSION,
  type TerminalState,
  type ToolCall,
  type ToolResult,
  type Usage,
  type UsageTotals,
} from "../protocol/contracts.js";
import type { Tool } from "../tools/tool.js";

export interface EventSink {
  emit(event: Event): void;
}

export interface Clock {
  now(): Date;
}

export type IdSource = (kind: "session" | "run" | "attempt") => string;

export interface RunOptions {
  task: string;
  model: ModelClient;
  tools: readonly Tool[];
  events: EventSink;
  budget?: Budget;
  clock?: Clock;
  ids?: IdSource;
  signal?: AbortSignal;
}

// Proposed defaults from the technical plan; calibrated before release.
export const defaultBudget: Budget = {
  maxModelRequests: 40,
  maxToolCalls: 100,
  maxInvalidToolCalls: 3,
};

type EventDraft = {
  [K in Event["type"]]: {
    type: K;
    payload: Extract<Event, { type: K }>["payload"];
  };
}[Event["type"]];

interface ParsedCall {
  call: ToolCall;
  parseError?: string;
}

type Response =
  | {
      ok: true;
      stopReason: "end_turn" | "tool_use" | "length";
      calls: ParsedCall[];
      text: string;
      usage?: Usage;
    }
  | {
      ok: false;
      stopReason: "error" | "aborted";
      text: string;
      usage?: Usage;
      error: string;
    };

class StreamProtocolError extends Error {}

// Run one task to exactly one terminal result. Tool calls execute only after
// the model finishes a response cleanly and every call in it is complete.
export async function runAgent(options: RunOptions): Promise<FinalResult> {
  const budget = options.budget ?? defaultBudget;
  const clock = options.clock ?? { now: () => new Date() };
  const ids = options.ids ?? (() => randomUUID());
  const signal = options.signal ?? new AbortController().signal;

  const sessionId = ids("session");
  const runId = ids("run");
  const attemptId = ids("attempt");
  let sequence = 0;

  const emit = (draft: EventDraft) => {
    options.events.emit(
      EventSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        runId,
        attemptId,
        sequence: sequence++,
        timestamp: clock.now().toISOString(),
        ...draft,
      }),
    );
  };

  const toolsByName = new Map(options.tools.map((t) => [t.definition.name, t]));
  const messages: ModelMessage[] = [{ role: "user", content: options.task }];
  const request: ModelRequest = {
    messages,
    tools: options.tools.map((t) => t.definition),
  };
  const usage: UsageTotals = {
    modelRequests: 0,
    unreportedRequests: 0,
    unpricedRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  let toolCalls = 0;
  let invalidToolCalls = 0;
  let text = "";

  const finish = (state: TerminalState, reason?: string): FinalResult => {
    const result: FinalResult = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      runId,
      attemptId,
      state,
      ...(reason === undefined ? {} : { reason }),
      text,
      toolCalls,
      usage: { ...usage },
    };
    emit({ type: "run_finished", payload: { result } });
    return result;
  };

  emit({ type: "run_started", payload: { task: options.task } });

  try {
    for (;;) {
      if (signal.aborted) return finish("cancelled", "cancelled by caller");
      if (usage.modelRequests >= budget.maxModelRequests) {
        return finish(
          "budget_exhausted",
          `model request limit of ${budget.maxModelRequests} reached`,
        );
      }

      usage.modelRequests++;
      emit({
        type: "model_request_started",
        payload: { request: usage.modelRequests },
      });
      const response = await collectResponse(
        options.model,
        request,
        signal,
        (delta) => emit({ type: "text_delta", payload: { text: delta } }),
      );

      if (response.usage) {
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        usage.cacheReadTokens += response.usage.cacheReadTokens ?? 0;
        usage.cacheWriteTokens += response.usage.cacheWriteTokens ?? 0;
      } else {
        usage.unreportedRequests++;
      }
      if (response.usage?.costUsd === undefined) usage.unpricedRequests++;
      else usage.costUsd += response.usage.costUsd;
      emit({
        type: "model_response_completed",
        payload: {
          stopReason: response.stopReason,
          ...(response.usage ? { usage: response.usage } : {}),
        },
      });
      text = response.text;

      if (!response.ok) {
        return response.stopReason === "aborted"
          ? finish("cancelled", "cancelled by caller")
          : finish("failed", `model error: ${response.error}`);
      }
      if (response.stopReason === "length") {
        return finish("failed", "model stopped at its output length limit");
      }

      messages.push({
        role: "assistant",
        text: response.text,
        toolCalls: response.calls.map((c) => c.call),
      });
      if (response.stopReason === "end_turn") return finish("answered");

      // V1 executes tool calls sequentially, pairing each result with its call.
      for (const { call, parseError } of response.calls) {
        if (signal.aborted) return finish("cancelled", "cancelled by caller");
        if (toolCalls >= budget.maxToolCalls) {
          return finish(
            "budget_exhausted",
            `tool call limit of ${budget.maxToolCalls} reached`,
          );
        }
        toolCalls++;
        emit({ type: "tool_call_requested", payload: { toolCall: call } });

        const tool = toolsByName.get(call.name);
        const check = parseError
          ? { ok: false as const, error: parseError }
          : tool
            ? tool.validate(call.arguments)
            : { ok: false as const, error: `unknown tool "${call.name}"` };

        let result: ToolResult;
        if (!check.ok || !tool) {
          const reason = check.ok ? "unknown tool" : check.error;
          invalidToolCalls++;
          emit({
            type: "tool_call_rejected",
            payload: { toolCallId: call.id, toolName: call.name, reason },
          });
          result = {
            toolCallId: call.id,
            toolName: call.name,
            isError: true,
            content: `Tool call rejected: ${reason}`,
          };
        } else {
          try {
            const content = await tool.run(call.arguments, signal);
            result = {
              toolCallId: call.id,
              toolName: call.name,
              isError: false,
              content,
            };
          } catch (error) {
            if (signal.aborted)
              return finish("cancelled", "cancelled by caller");
            result = {
              toolCallId: call.id,
              toolName: call.name,
              isError: true,
              content: `Tool failed: ${errorMessage(error)}`,
            };
          }
        }
        emit({ type: "tool_result", payload: { result } });
        messages.push({ role: "tool", result });

        if (invalidToolCalls > budget.maxInvalidToolCalls) {
          return finish(
            "failed",
            `more than ${budget.maxInvalidToolCalls} invalid tool calls`,
          );
        }
      }
    }
  } catch (error) {
    return finish("failed", `internal error: ${errorMessage(error)}`);
  }
}

async function collectResponse(
  model: ModelClient,
  request: ModelRequest,
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<Response> {
  const pending = new Map<
    number,
    { id: string; name: string; json: string; ended: boolean }
  >();
  let text = "";
  let usage: Usage | undefined;
  let stopReason: "end_turn" | "tool_use" | "length" | undefined;
  const failed = (error: string): Response => ({
    ok: false,
    stopReason: signal.aborted ? "aborted" : "error",
    text,
    usage,
    error: signal.aborted ? "aborted" : error,
  });

  try {
    for await (const event of model.stream(request, signal)) {
      if (event.type === "text_delta") {
        text += event.text;
        onText(event.text);
      } else if (event.type === "tool_call_start") {
        if (pending.has(event.index)) {
          throw new StreamProtocolError(
            `tool call index ${event.index} started twice`,
          );
        }
        pending.set(event.index, {
          id: event.id,
          name: event.name,
          json: "",
          ended: false,
        });
      } else if (
        event.type === "tool_call_delta" ||
        event.type === "tool_call_end"
      ) {
        const call = pending.get(event.index);
        if (!call || call.ended) {
          throw new StreamProtocolError(
            `tool call index ${event.index} is not open`,
          );
        }
        if (event.type === "tool_call_delta") call.json += event.argumentsDelta;
        else call.ended = true;
      } else if (event.type === "usage") {
        usage = event.usage;
      } else if (event.type === "error") {
        return failed(event.message);
      } else {
        stopReason = event.stopReason;
        break;
      }
    }
  } catch (error) {
    return failed(errorMessage(error));
  }

  if (signal.aborted) return failed("aborted");
  if (!stopReason) return failed("stream ended without a stop reason");

  const calls = [...pending.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, c]) => c);
  const incomplete = calls.find((c) => !c.ended);
  if (incomplete) return failed(`incomplete tool call ${incomplete.id}`);
  if (new Set(calls.map((c) => c.id)).size !== calls.length) {
    return failed("duplicate tool call ids");
  }
  if ((stopReason === "tool_use") !== calls.length > 0) {
    return failed(`stop reason ${stopReason} with ${calls.length} tool calls`);
  }

  return { ok: true, stopReason, text, usage, calls: calls.map(parseCall) };
}

function parseCall(c: { id: string; name: string; json: string }): ParsedCall {
  const call = { id: c.id, name: c.name, arguments: {} };
  if (c.json.trim() === "") return { call };
  try {
    const parsed: unknown = JSON.parse(c.json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { call, parseError: "arguments must be a JSON object" };
    }
    return { call: { ...call, arguments: parsed as Record<string, unknown> } };
  } catch {
    return { call, parseError: "arguments are not valid JSON" };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
