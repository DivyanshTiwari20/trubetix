import { z } from "zod";

export const sourcedClaimSchema = z.object({
  title: z.string(),
  detail: z.string(),
  sourceIndices: z.array(z.number().int()).default([]),
});

export const riskSchema = sourcedClaimSchema.extend({
  severity: z.enum(["low", "medium", "high"]),
});

export const recommendedActionSchema = z.object({
  action: z.string(),
  rationale: z.string(),
});

export const prAnalysisSchema = z.object({
  executiveSummary: z.string(),
  narratives: z.array(sourcedClaimSchema),
  changes: z.array(sourcedClaimSchema),
  whyItMatters: z.string(),
  risks: z.array(riskSchema),
  opportunities: z.array(sourcedClaimSchema),
  recommendedActions: z.array(recommendedActionSchema),
  confidence: z.enum(["low", "medium", "high"]),
  limitations: z.array(z.string()),
});

export type SourcedClaim = z.infer<typeof sourcedClaimSchema>;
export type RiskClaim = z.infer<typeof riskSchema>;
export type RecommendedAction = z.infer<typeof recommendedActionSchema>;
export type PRAnalysis = z.infer<typeof prAnalysisSchema>;
