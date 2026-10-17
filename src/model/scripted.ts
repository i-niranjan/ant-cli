import type { ModelClient, ModelRequest, ModelStreamEvent } from "./client.js";

// A deterministic model that plays back one script per request. It records
// each request so tests can inspect what the loop sent.
export class ScriptedModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  readonly #scripts: readonly (readonly ModelStreamEvent[])[];

  constructor(scripts: readonly (readonly ModelStreamEvent[])[]) {
    this.#scripts = scripts;
  }

  async *stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const script = this.#scripts[this.requests.length];
    this.requests.push(structuredClone(request));
    if (!script) {
      yield {
        type: "error",
        message: `script exhausted at request ${this.requests.length}`,
      };
      return;
    }
    for (const event of script) {
      // Yield to the event loop so callers can abort between events.
      await Promise.resolve();
      signal.throwIfAborted();
      yield event;
    }
  }
}

// Split a JSON argument string into fragments, as providers stream them.
export function fragmentedToolCall(
  index: number,
  id: string,
  name: string,
  argumentsJson: string,
  fragmentSize = 3,
): ModelStreamEvent[] {
  const events: ModelStreamEvent[] = [
    { type: "tool_call_start", index, id, name },
  ];
  for (let i = 0; i < argumentsJson.length; i += fragmentSize) {
    events.push({
      type: "tool_call_delta",
      index,
      argumentsDelta: argumentsJson.slice(i, i + fragmentSize),
    });
  }
  events.push({ type: "tool_call_end", index });
  return events;
}
