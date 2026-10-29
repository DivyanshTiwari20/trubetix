import "server-only";
import { z } from "zod";
import type { GeminiClient } from "@/lib/ai/gemini";
import { toGeminiSchema } from "@/lib/validation/gemini-schema";

export const entityExtractionSchema = z.object({
  primaryEntity: z.string().nullable(),
  mentionedEntities: z.array(z.string()).default([]),
  platform: z.enum(["instagram", "x", "reddit", "news", "web", "tiktok", "facebook", "youtube", "linkedin", "threads"]).nullable(),
  days: z.number().int().nullable(),
  intent: z.enum(["volume", "reaction", "overview", "show_more", "other"]),
});

export type EntityExtractionResult = z.infer<typeof entityExtractionSchema>;

export const FILLER_WORDS = new Set([
  "tell", "tll", "me", "about", "give", "show", "what", "how", "many", "posts", "number", "reaction", "people", "saying", "on", "insta", "instagram", "in", "last", "days", "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those", "there", "their", "them", "they", "it", "its", "of", "to", "for", "with", "from", "by", "into", "over", "under", "again", "further", "once", "here", "all", "any", "some", "no", "not", "only", "own", "same", "so", "too", "very", "just", "please", "find", "analyze", "analyse", "identify", "summarize", "summarise", "explain", "describe", "report", "around", "regarding", "concerning", "our", "my", "we", "i", "us", "you", "your", "client", "clients", "latest", "recent", "new", "major", "most", "past", "next", "week", "weeks", "month", "months", "day", "year", "years", "today", "yesterday", "media", "conversation", "narratives", "narrative", "risks", "risk", "changes", "change", "developments", "happening", "buzzing", "buzz", "happened", "cover", "coverage", "story", "stories", "outlet", "outlets", "press", "publication", "publications", "competitor", "competitors", "reputational", "reputation", "potential", "team", "should", "investigate", "recommend", "actions", "action", "things", "thing", "much", "more", "less", "anyone", "someone", "anything", "everything", "something", "ig", "tiktok", "twitter", "facebook", "youtube", "linkedin", "reddit", "threads", "social", "reel", "reels", "viral", "trending", "trend", "sentiment", "reactions", "reacting", "respond", "responding", "response", "comments", "comment", "engagement", "followers", "follower", "following", "profile", "profiles", "account", "accounts", "bio", "opinions", "opinion", "numbers", "metric", "metrics", "statistics", "statistic", "stats", "stat", "figures", "figure", "count", "counts", "data", "insights", "insight", "performance", "reach", "impressions", "views", "likes", "shares", "growth", "overall", "film", "movie", "series", "show", "person", "handle", "username", "user", "portrayal", "role",
]);

export function isFillerWord(word: string): boolean {
  return FILLER_WORDS.has(word.toLowerCase());
}

export function validateEntity(entity: string | null): string | null {
  if (!entity) return null;
  const trimmed = entity.trim();
  if (trimmed.length < 3) return null;
  const lower = trimmed.toLowerCase();
  if (FILLER_WORDS.has(lower)) return null;
  return trimmed;
}

const EXTRACTION_SYSTEM_INSTRUCTION = `You are an entity extraction assistant for Tubitex, a PR and social media intelligence app.

Extract the primary entity (person, brand, film, event, hashtag) the user wants posts or numbers for.
The message may contain typos, slang, mixed language, or filler words.

Ignore these filler words: tell, tll, me, about, give, show, what, how, many, posts, number, reaction, people, saying, on, insta, instagram, in, last, days, and common stopwords.

Return the real person/brand/hashtag as written, properly capitalised.
Return null for primaryEntity if there is no clear subject.

Also identify other mentioned entities (context only, e.g. "Tiger Shroff attacked by a gang related to Salman Khan" -> primary Tiger Shroff, mentioned Salman Khan).

Also identify:
- platform: instagram, x, reddit, news, web, tiktok, facebook, youtube, linkedin, threads, or null
- days: number of days mentioned in the time window, or null
- intent: "volume" (how many posts/count), "reaction" (what are people saying/sentiment), "overview" (general buzz/what's happening), "show_more" (user wants more results), or "other"

Return ONLY valid JSON matching the schema.`;

const entityExtractionGeminiSchema = toGeminiSchema(entityExtractionSchema);

export async function extractEntitiesWithGemini(
  question: string,
  gemini: GeminiClient,
): Promise<EntityExtractionResult> {
  const prompt = `Question: "${question}"`;

  const response = await gemini.generateStructured({
    systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
    userContent: prompt,
    responseSchema: entityExtractionGeminiSchema,
    temperature: 0,
  });

  const parsed = entityExtractionSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(`Gemini entity extraction returned invalid JSON: ${parsed.error.message}`);
  }

  const result = parsed.data;
  return {
    primaryEntity: validateEntity(result.primaryEntity),
    mentionedEntities: result.mentionedEntities.map(validateEntity).filter(Boolean) as string[],
    platform: result.platform,
    days: result.days,
    intent: result.intent,
  };
}

export async function extractEntitiesWithGeminiWithRetry(
  question: string,
  gemini: GeminiClient,
  maxRetries = 1,
): Promise<EntityExtractionResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await extractEntitiesWithGemini(question, gemini);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  }
  throw lastError ?? new Error("Entity extraction failed after retries");
}