import { z } from "zod";

// Public harness contracts. Everything here is ours: no provider or Pi types.
// Bump SCHEMA_VERSION on any incompatible change; readers reject other versions.
export const SCHEMA_VERSION = 1;

const schemaVersion = z.literal(SCHEMA_VERSION);
const id = z.string().min(1);
const count = z.int().nonnegative();
const timestamp = z.iso.datetime();

// --- Model conversation ---------------------------------------------------

export const ToolCall = z.strictObject({
  id,
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const ToolResult = z.strictObject({
  toolCallId: id,
  toolName: z.string().min(1),
  isError: z.boolean(),
  content: z.string(),
});
export type ToolResult = z.infer<typeof ToolResult>;

export const ModelMessage = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("user"), content: z.string() }),
  z.strictObject({
    role: z.literal("assistant"),
    text: z.string(),
    toolCalls: z.array(ToolCall),
  }),
  z.strictObject({ role: z.literal("tool"), result: ToolResult }),
]);
export type ModelMessage = z.infer<typeof ModelMessage>;

// Tool parameters are canonical JSON Schema generated from the tool's Zod schema.
export const ToolDefinition = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
});
export type ToolDefinition = z.infer<typeof ToolDefinition>;

export const StopReason = z.enum([
  "end_turn",
  "tool_use",
  "length",
  "error",
  "aborted",
]);
export type StopReason = z.infer<typeof StopReason>;

// Token counts for one model response. Absent means the provider did not
// report usage; it must never be treated as zero. Likewise an absent costUsd
// means the price is unknown, not free.
export const Usage = z.strictObject({
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count.optional(),
  cacheWriteTokens: count.optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof Usage>;

// Totals across a run. Tokens and cost sum known values only;
// unreportedRequests and unpricedRequests count the responses left out.
export const UsageTotals = z.strictObject({
  modelRequests: count,
  unreportedRequests: count,
  unpricedRequests: count,
  inputTokens: count,
  outputTokens: count,
  costUsd: z.number().nonnegative(),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

// --- Run outcome ----------------------------------------------------------

export const TerminalState = z.enum([
  "succeeded",
  "completed_unverified",
  "answered",
  "planned",
  "failed",
  "cancelled",
  "budget_exhausted",
  "needs_attention",
  "interrupted",
]);
export type TerminalState = z.infer<typeof TerminalState>;

export const FinalResult = z.strictObject({
  schemaVersion,
  sessionId: id,
  runId: id,
  attemptId: id,
  state: TerminalState,
  reason: z.string().optional(),
  text: z.string(),
  toolCalls: count,
  usage: UsageTotals,
});
export type FinalResult = z.infer<typeof FinalResult>;

// --- Events ---------------------------------------------------------------

const eventBase = {
  schemaVersion,
  sessionId: id,
  runId: id,
  attemptId: id,
  sequence: count,
  timestamp,
};

function event<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({ ...eventBase, type: z.literal(type), payload });
}

export const Event = z.discriminatedUnion("type", [
  event("run_started", z.strictObject({ task: z.string() })),
  event("model_request_started", z.strictObject({ request: count })),
  event("text_delta", z.strictObject({ text: z.string() })),
  event(
    "model_response_completed",
    z.strictObject({ stopReason: StopReason, usage: Usage.optional() }),
  ),
  event("tool_call_requested", z.strictObject({ toolCall: ToolCall })),
  event(
    "tool_call_rejected",
    z.strictObject({
      toolCallId: id,
      toolName: z.string(),
      reason: z.string(),
    }),
  ),
  event("tool_result", z.strictObject({ result: ToolResult })),
  event("run_finished", z.strictObject({ result: FinalResult })),
]);
export type Event = z.infer<typeof Event>;
export type EventType = Event["type"];

// --- Records filled in by later stories -----------------------------------
// Minimal shapes so IDs and versions are fixed now; fields grow with the
// stories that use them (sessions CH-015, approvals CH-017, checks CH-025).

export const Session = z.strictObject({
  schemaVersion,
  sessionId: id,
  createdAt: timestamp,
});
export type Session = z.infer<typeof Session>;

export const Run = z.strictObject({
  schemaVersion,
  sessionId: id,
  runId: id,
  task: z.string(),
  createdAt: timestamp,
  previousRunId: id.optional(),
});
export type Run = z.infer<typeof Run>;

export const Attempt = z.strictObject({
  schemaVersion,
  runId: id,
  attemptId: id,
  number: z.int().positive(),
  startedAt: timestamp,
});
export type Attempt = z.infer<typeof Attempt>;

export const Budget = z.strictObject({
  maxModelRequests: z.int().positive(),
  maxToolCalls: z.int().positive(),
  maxInvalidToolCalls: count,
});
export type Budget = z.infer<typeof Budget>;

export const Approval = z.strictObject({
  schemaVersion,
  approvalId: id,
  toolCallId: id,
  decision: z.enum(["approved", "denied"]),
  decidedAt: timestamp,
});
export type Approval = z.infer<typeof Approval>;

export const VerificationResult = z.strictObject({
  schemaVersion,
  checkName: z.string().min(1),
  status: z.enum(["passed", "failed", "error"]),
  exitCode: z.int().optional(),
  durationMs: count,
});
export type VerificationResult = z.infer<typeof VerificationResult>;

export const Artifact = z.strictObject({
  schemaVersion,
  artifactId: id,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: count,
  mediaType: z.string().min(1),
});
export type Artifact = z.infer<typeof Artifact>;

// --- Version boundary -----------------------------------------------------

export class IncompatibleSchemaVersionError extends Error {
  constructor(readonly found: unknown) {
    super(
      `Unsupported schemaVersion ${JSON.stringify(found)}; this harness reads version ${SCHEMA_VERSION}`,
    );
    this.name = "IncompatibleSchemaVersionError";
  }
}

// Parse a versioned record, failing with a clear error on another version
// before reporting field-level problems.
export function parseVersioned<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.infer<S> {
  const found =
    typeof input === "object" && input !== null
      ? (input as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (found !== SCHEMA_VERSION) {
    throw new IncompatibleSchemaVersionError(found);
  }
  return schema.parse(input);
}
