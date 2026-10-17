// The only module that imports Pi. It translates our normalized messages and
// tools into Pi requests and Pi's stream back into ModelStreamEvents; no Pi
// type crosses this boundary.
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  createModels,
  type FetchFunction,
  hasApi,
  type Message,
  type TSchema,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import type { ModelMessage, Usage } from "../protocol/contracts.js";
import type { ModelClient, ModelRequest, ModelStreamEvent } from "./client.js";

export interface PiModelConfig {
  provider: "anthropic";
  // An exact model ID, never a moving alias such as "latest".
  modelId: string;
  // Passed explicitly on every request; ambient credentials are never used.
  apiKey: string;
  maxOutputTokens: number;
  // Retries for transient failures (408, 409, 429, 5xx) only.
  maxRetries: number;
  timeoutMs: number;
  effort?: "low" | "medium" | "high";
  // Test seam: replaces the HTTP transport.
  fetch?: FetchFunction;
}

export class ModelConfigError extends Error {
  override name = "ModelConfigError";
}

const PROVIDERS = { anthropic: anthropicProvider } as const;

export class PiModelClient implements ModelClient {
  readonly #config: PiModelConfig;
  readonly #models = createModels();
  readonly #model;
  // Provider continuation state. Anthropic requires earlier assistant turns
  // (including opaque thinking signatures) to be sent back unchanged, so we
  // keep Pi's original message keyed by what core sees. It lives only in
  // memory; persisting it is a CH-015 decision.
  readonly #continuations = new Map<string, AssistantMessage>();

  constructor(config: PiModelConfig) {
    if (!config.apiKey.trim()) {
      throw new ModelConfigError("an explicit API key is required");
    }
    if (/latest/i.test(config.modelId)) {
      throw new ModelConfigError(`model "${config.modelId}" is a moving alias`);
    }
    this.#config = config;
    this.#models.setProvider(PROVIDERS[config.provider]());
    const model = this.#models.getModel(config.provider, config.modelId);
    if (!model) {
      throw new ModelConfigError(
        `unknown model ${config.provider}/${config.modelId}`,
      );
    }
    this.#model = model;
  }

  async *stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    let context: Context;
    try {
      context = this.#toContext(request);
    } catch (error) {
      yield { type: "error", message: (error as Error).message };
      return;
    }

    const config = this.#config;
    const options = {
      apiKey: config.apiKey,
      // An empty env keeps ambient variables out of provider resolution.
      env: {},
      signal,
      maxTokens: config.maxOutputTokens,
      maxRetries: config.maxRetries,
      timeoutMs: config.timeoutMs,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    };
    // Thinking summaries are omitted: we never show or store thinking text.
    const events = hasApi(this.#model, "anthropic-messages")
      ? this.#models.stream(this.#model, context, {
          ...options,
          thinkingDisplay: "omitted",
          ...(config.effort ? { effort: config.effort } : {}),
        })
      : this.#models.stream(this.#model, context, options);

    for await (const event of events) {
      const mapped = this.#translate(event);
      if (mapped) yield* mapped;
    }
  }

  #translate(event: AssistantMessageEvent): ModelStreamEvent[] | undefined {
    switch (event.type) {
      case "text_delta":
        return [{ type: "text_delta", text: event.delta }];
      case "toolcall_start": {
        const block = event.partial.content[event.contentIndex];
        if (block?.type !== "toolCall" || !block.id || !block.name) {
          return [
            { type: "error", message: "tool call started without id/name" },
          ];
        }
        return [
          {
            type: "tool_call_start",
            index: event.contentIndex,
            id: block.id,
            name: block.name,
          },
        ];
      }
      case "toolcall_delta":
        // Raw JSON text; core parses it only after the call ends.
        return [
          {
            type: "tool_call_delta",
            index: event.contentIndex,
            argumentsDelta: event.delta,
          },
        ];
      case "toolcall_end":
        return [{ type: "tool_call_end", index: event.contentIndex }];
      case "done": {
        const message = event.message;
        const stopReason =
          message.stopReason === "stop"
            ? "end_turn"
            : message.stopReason === "toolUse"
              ? "tool_use"
              : message.stopReason === "length"
                ? "length"
                : undefined;
        if (!stopReason) {
          return [
            {
              type: "error",
              message: `unsupported stop reason ${message.stopReason}`,
            },
          ];
        }
        this.#continuations.set(continuationKey(fromPi(message)), message);
        return [...usageEvent(message), { type: "finish", stopReason }];
      }
      case "error":
        return [
          ...usageEvent(event.error),
          {
            type: "error",
            message: event.error.errorMessage ?? `request ${event.reason}`,
          },
        ];
      default:
        // start, text_start/end, and thinking events carry nothing core needs;
        // thinking text is deliberately not surfaced.
        return undefined;
    }
  }

  #toContext(request: ModelRequest): Context {
    const messages: Message[] = request.messages.map((message) => {
      if (message.role === "user") {
        return { role: "user", content: message.content, timestamp: 0 };
      }
      if (message.role === "tool") {
        return {
          role: "toolResult",
          toolCallId: message.result.toolCallId,
          toolName: message.result.toolName,
          content: [{ type: "text", text: message.result.content }],
          isError: message.result.isError,
          timestamp: 0,
        };
      }
      const original = this.#continuations.get(continuationKey(message));
      if (!original) {
        // Resending without the provider's continuation state would silently
        // drop required context, so refuse instead.
        throw new Error(
          "missing provider continuation state for an earlier assistant turn",
        );
      }
      return original;
    });
    return {
      messages,
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        // Our parameters are plain JSON Schema, which is what TypeBox emits.
        parameters: tool.parameters as TSchema,
      })),
    };
  }
}

// What core records for an assistant turn, used to find Pi's original.
function fromPi(
  message: AssistantMessage,
): Extract<ModelMessage, { role: "assistant" }> {
  return {
    role: "assistant",
    text: message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(""),
    toolCalls: message.content.flatMap((block) =>
      block.type === "toolCall"
        ? [{ id: block.id, name: block.name, arguments: block.arguments }]
        : [],
    ),
  };
}

function continuationKey(
  message: Extract<ModelMessage, { role: "assistant" }>,
) {
  return JSON.stringify([message.text, message.toolCalls.map((c) => c.id)]);
}

// Anthropic reports input tokens at the start of every billed response, so
// zero input means the provider never reported usage.
function usageEvent(message: AssistantMessage): ModelStreamEvent[] {
  const { usage } = message;
  if (!usage || usage.input + usage.cacheRead + usage.cacheWrite === 0)
    return [];
  const reported: Usage = {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costUsd: usage.cost.total,
  };
  return [{ type: "usage", usage: reported }];
}
