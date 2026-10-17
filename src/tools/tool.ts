import { z } from "zod";
import type { ToolDefinition } from "../protocol/contracts.js";

export interface Tool {
  definition: ToolDefinition;
  // Checks model-supplied arguments; run() must only receive validated ones.
  validate(args: unknown): { ok: true } | { ok: false; error: string };
  run(args: unknown, signal: AbortSignal): Promise<string>;
}

// The JSON Schema sent to models is generated from the same Zod schema that
// validates arguments, so the two cannot drift apart.
export function defineTool<S extends z.ZodObject>(spec: {
  name: string;
  description: string;
  args: S;
  execute(args: z.infer<S>, signal: AbortSignal): Promise<string>;
}): Tool {
  const { $schema: _, ...parameters } = z.toJSONSchema(spec.args);
  return {
    definition: {
      name: spec.name,
      description: spec.description,
      parameters,
    },
    validate(args) {
      const parsed = spec.args.safeParse(args);
      return parsed.success
        ? { ok: true }
        : { ok: false, error: z.prettifyError(parsed.error) };
    },
    run(args, signal) {
      return spec.execute(spec.args.parse(args), signal);
    },
  };
}
