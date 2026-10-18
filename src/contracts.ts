import { z } from "zod";

// --------------------------------------
// 1. Tool Call
// --------------------------------------

export const ToolCallSchema = z.object({
  schemaVersion: z.literal(1),
  callId: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

// --------------------------------------
// 2. Tool Result
// --------------------------------------

const BaseToolResultSchema = z.object({
  schemaVersion: z.literal(1),
  callId: z.string().min(1),
});

const SuccessToolResultSchema = BaseToolResultSchema.extend({
  status: z.literal("success"),
  output: z.unknown(),
});

const ErrorToolResultSchema = BaseToolResultSchema.extend({
  status: z.literal("error"),
  error: z.string().min(1),
});

export const ToolResultSchema = z.discriminatedUnion("status", [
  SuccessToolResultSchema,
  ErrorToolResultSchema,
]);

// --------------------------------------
// 3. Model Message
// --------------------------------------

const BaseModelMessageSchema = z.object({
  schemaVersion: z.literal(1),
});

const UserMessageSchema = BaseModelMessageSchema.extend({
  role: z.literal("user"),
  content: z.string(),
});

const AssistantMessageSchema = BaseModelMessageSchema.extend({
  role: z.literal("assistant"),
  content: z.string(),
  toolCalls: z.array(ToolCallSchema),
});

const ToolMessageSchema = BaseModelMessageSchema.extend({
  role: z.literal("tool"),
  result: ToolResultSchema,
});

export const ModelMessageSchema = z.discriminatedUnion("role", [
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

// --------------------------------------
// 4. Final Result
// --------------------------------------

const BaseFinalResultSchema = z.object({
  schemaVersion: z.literal(1),
});

const SuccessFinalResultSchema = BaseFinalResultSchema.extend({
  status: z.literal("success"),
  output: z.string(),
});

const FailureFinalResultSchema = BaseFinalResultSchema.extend({
  status: z.literal("failure"),
  error: z.string().min(1),
});

const CancelledFinalResultSchema = BaseFinalResultSchema.extend({
  status: z.literal("cancelled"),
  reason: z.string().optional(),
});

export const FinalResultSchema = z.discriminatedUnion("status", [
  SuccessFinalResultSchema,
  FailureFinalResultSchema,
  CancelledFinalResultSchema,
]);

// --------------------------------------
// TypeScript Types
// --------------------------------------

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ModelMessage = z.infer<typeof ModelMessageSchema>;
export type FinalResult = z.infer<typeof FinalResultSchema>;
