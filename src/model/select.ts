import type { ModelClient } from "./client.js";
import { ModelConfigError, PiModelClient } from "./pi.js";

// Each provider reads only its own harness-specific variable, so a key that
// exists for another tool (for example ANTHROPIC_API_KEY) is never picked up.
export const API_KEY_VARIABLES = {
  anthropic: "ANT_AGENT_ANTHROPIC_API_KEY",
} as const;

// Conservative smoke-test defaults; calibrated before release.
export const MODEL_DEFAULTS = {
  maxOutputTokens: 1024,
  maxRetries: 2,
  timeoutMs: 120_000,
  effort: "low",
} as const;

// Build a real model client from "provider/model-id" and an explicit env map.
export function selectModel(
  spec: string,
  env: Record<string, string | undefined>,
): ModelClient {
  const slash = spec.indexOf("/");
  const provider = spec.slice(0, slash);
  const modelId = spec.slice(slash + 1);
  if (slash < 1 || !modelId || provider !== "anthropic") {
    throw new ModelConfigError(
      `unsupported model "${spec}"; expected anthropic/<model-id>`,
    );
  }
  const variable = API_KEY_VARIABLES[provider];
  const apiKey = env[variable];
  if (!apiKey?.trim()) {
    throw new ModelConfigError(`set ${variable} to use ${spec}`);
  }
  return new PiModelClient({ provider, modelId, apiKey, ...MODEL_DEFAULTS });
}
