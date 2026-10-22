import { z } from "zod";

export const sourceTypeSchema = z.enum([
  "news",
  "blog",
  "social",
  "forum",
  "government",
  "company",
  "other",
]);

export const platformSchema = z.enum([
  "web",
  "news",
  "twitter",
  "facebook",
  "instagram",
  "youtube",
  "linkedin",
  "reddit",
  "other",
]);

export const researchIntentSchema = z.enum([
  "overview",
  "narratives",
  "change",
  "risk",
  "competitor",
  "coverage",
  "next_steps",
]);

export const researchResultSchema = z.object({
  title: z.string(),
  canonicalUrl: z.string(),
  originalUrl: z.string(),
  sourceName: z.string().nullable(),
  sourceType: sourceTypeSchema,
  platform: platformSchema,
  publishedAt: z.string().nullable(),
  retrievedAt: z.string(),
  contentSnippet: z.string(),
  matchedEntities: z.array(z.string()),
  queryUsed: z.string(),
  relatedUrls: z.array(z.string()).default([]),
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  username: z.string().optional(),
  cleanedCaption: z.string().optional(),
  dateSource: z.enum(["shortcode", "snippet", "provider"]).optional(),
});

export const dateRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string(),
  timezone: z.string(),
  preset: z.string().nullable(),
});

export const integrationStatusSchema = z.object({
  gemini: z.object({
    configured: z.boolean(),
    model: z.string(),
    useVertex: z.boolean().optional(),
    vertexProject: z.string().nullable().optional(),
    vertexRegion: z.string().nullable().optional(),
  }),
  serpapi: z.object({ configured: z.boolean() }),
  newsapi: z.object({ configured: z.boolean() }),
});

export const researchIntentKindSchema = z.enum([
  "social_listening",
  "sentiment",
  "post_discovery",
  "post_count",
  "profile_lookup",
  "profile_metrics",
  "general",
]);

export const researchMetaSchema = z.object({
  status: z.enum(["ok", "degraded", "failed"]),
  question: z.string(),
  intent: researchIntentSchema,
  intentKind: researchIntentKindSchema.optional(),
  dateRange: dateRangeSchema,
  previousDateRange: dateRangeSchema.nullable(),
  queries: z.array(z.string()),
  resultsRetrieved: z.number().int().nonnegative(),
  resultsAfterDedupe: z.number().int().nonnegative(),
  resultsIncluded: z.number().int().nonnegative(),
  undatedExcluded: z.number().int().nonnegative(),
  sourceTypesSearched: z.array(sourceTypeSchema),
  providersSearched: z.array(z.string()),
  comparisonAvailable: z.boolean(),
  integrations: integrationStatusSchema,
  limitations: z.array(z.string()),
  warnings: z.array(z.string()),
  generatedAt: z.string(),
});
