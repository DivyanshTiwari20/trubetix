import { z } from "zod";
import { LIMITS } from "@/lib/config";
import { prAnalysisSchema } from "./analysis";
import { researchMetaSchema, researchResultSchema } from "./research";

export const messageRoleSchema = z.enum(["user", "assistant"]);
export const messageStatusSchema = z.enum(["complete", "error", "degraded"]);
export const feedbackSchema = z.enum(["up", "down"]);

export const chatMessageSchema = z.object({
  id: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
  status: messageStatusSchema.default("complete"),
  analysis: prAnalysisSchema.nullable().default(null),
  sources: z.array(researchResultSchema).default([]),
  meta: researchMetaSchema.nullable().default(null),
  error: z.string().nullable().default(null),
  feedback: feedbackSchema.nullable().default(null),
});

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  messages: z.array(chatMessageSchema).default([]),
});

export const historyTurnSchema = z.object({
  role: messageRoleSchema,
  content: z.string().max(LIMITS.maxHistoryMessageLength),
});

export const dateRangeRequestSchema = z.object({
  preset: z.enum(["24h", "7d", "30d", "90d", "custom"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(LIMITS.questionMaxLength),
  conversationId: z.string().optional(),
  history: z.array(historyTurnSchema).max(LIMITS.maxHistoryMessages).default([]),
  dateRange: dateRangeRequestSchema.optional(),
});

export const chatResponseSchema = z.object({
  conversationId: z.string(),
  message: chatMessageSchema,
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.string()).optional(),
  }),
});

export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageStatus = z.infer<typeof messageStatusSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type HistoryTurn = z.infer<typeof historyTurnSchema>;
export type DateRangeRequest = z.infer<typeof dateRangeRequestSchema>;
export type DatePreset = NonNullable<z.infer<typeof dateRangeRequestSchema>["preset"]>;
