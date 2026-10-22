import type { z } from "zod";
import type {
  prAnalysisSchema,
  recommendedActionSchema,
  riskSchema,
  sourcedClaimSchema,
} from "@/lib/validation/analysis";
import type {
  apiErrorSchema,
  chatMessageSchema,
  chatRequestSchema,
  chatResponseSchema,
  conversationSchema,
  dateRangeRequestSchema,
  feedbackSchema,
  historyTurnSchema,
  messageRoleSchema,
  messageStatusSchema,
} from "@/lib/validation/chat";
import type {
  dateRangeSchema,
  integrationStatusSchema,
  platformSchema,
  researchIntentSchema,
  researchMetaSchema,
  researchResultSchema,
  sourceTypeSchema,
} from "@/lib/validation/research";

export type PRAnalysis = z.infer<typeof prAnalysisSchema>;
export type SourcedClaim = z.infer<typeof sourcedClaimSchema>;
export type RiskClaim = z.infer<typeof riskSchema>;
export type RecommendedAction = z.infer<typeof recommendedActionSchema>;

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageStatus = z.infer<typeof messageStatusSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;
export type HistoryTurn = z.infer<typeof historyTurnSchema>;
export type DateRangeRequest = z.infer<typeof dateRangeRequestSchema>;
export type DatePreset = NonNullable<DateRangeRequest["preset"]>;

export type ResearchResult = z.infer<typeof researchResultSchema>;
export type ResearchMeta = z.infer<typeof researchMetaSchema>;
export type ResolvedDateRange = z.infer<typeof dateRangeSchema>;
export type ResearchIntent = z.infer<typeof researchIntentSchema>;
export type SourceType = z.infer<typeof sourceTypeSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
