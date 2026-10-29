import "server-only";
import { z } from "zod";
import type { GeminiClient } from "@/lib/ai/gemini";
import { getApifyInstagramConfig, getIntegrationStatus } from "@/lib/env";
import { APP_TZ } from "@/lib/config";
import { formatCompactCount } from "@/lib/format";
import { logger } from "@/lib/logger";
import { searchApifyInstagram } from "@/lib/providers/apify-instagram";
import { resolveDateRangeApp, isWithinRangeApp } from "@/lib/research/dateRange";
import { toGeminiSchema } from "@/lib/validation/gemini-schema";
import type { DatePreset, HistoryTurn, ResearchMeta } from "@/types";
import type { ResolvedDateRangeApp } from "@/lib/research/dateRange";

const extractionSchema = z.object({
  query: z.string().nullable(),
  searchType: z.enum(["hashtag", "keyword"]),
  intent: z.enum(["count", "narrative"]),
});

const answerSchema = z.object({ answer: z.string() });

interface ApifyPostView {
  title: string;
  url: string;
  caption: string | null;
  snippet: string;
  hashtags: string[];
  snippetHashtags: string[];
  account: string;
  likes: string | null;
  comments: null;
  postedDate: string | null;
}

interface PostParseResult {
  post: ApifyPostView | null;
  dateISO: string | null;
  dedupeKey: string | null;
}

function promptHistory(history: HistoryTurn[]): string {
  return history
    .filter((turn) => turn.content.trim())
    .slice(-6)
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content.trim()}`)
    .join("\n");
}

function numberFromQuestion(question: string): number | null {
  const match = question.toLowerCase().match(/\b(?:last|past|over the last|within the last)\s+(\d{1,3})\s+days?\b/);
  if (!match) return null;
  const days = Number(match[1]);
  return days > 0 && days <= 365 ? days : null;
}

function resolveWindow(
  question: string,
  dateFrom: string | null,
  dateTo: string | null,
  datePreset: DatePreset | null,
  now: Date,
): ResolvedDateRangeApp {
  const text = question.toLowerCase();
  if (/\b(?:last|past)\s+24\s+hours?\b/.test(text)) {
    return resolveDateRangeApp({ preset: "24h" }, now);
  }
  if (/\b(?:last|past)\s+week\b/.test(text)) {
    return resolveDateRangeApp({ preset: "7d" }, now);
  }
  if (/\b(?:last|past)\s+month\b/.test(text)) {
    return resolveDateRangeApp({ preset: "30d" }, now);
  }
  if (/\b(?:last|past)\s+year\b/.test(text)) {
    const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    return resolveDateRangeApp({ preset: "custom", from, to: now.toISOString() }, now);
  }
  const days = numberFromQuestion(question);
  if (days !== null) {
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    return resolveDateRangeApp({ preset: "custom", from, to: now.toISOString() }, now);
  }

  const preset = datePreset ?? "7d";
  return resolveDateRangeApp(
    dateFrom && dateTo
      ? { preset, from: dateFrom, to: dateTo }
      : { preset },
    now,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function instagramPostUrl(value: unknown, shortCode: unknown): string | null {
  const candidate = firstString(value) ?? (typeof shortCode === "string" && shortCode.trim()
    ? `https://www.instagram.com/p/${encodeURIComponent(shortCode.trim())}/`
    : null);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractHashtags(value: unknown, caption: string): string[] {
  const supplied = Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string")
    : [];
  const fromCaption = [...caption.matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu)].map((match) => match[1] ?? "");
  const unique = new Map<string, string>();
  for (const tag of [...supplied, ...fromCaption]) {
    const normalized = tag.trim().replace(/^#/, "");
    if (normalized) unique.set(normalized.toLowerCase(), normalized);
  }
  return [...unique.values()];
}

function parsePost(value: unknown, range: ResolvedDateRangeApp): PostParseResult {
  const item = asRecord(value);
  if (!item) return { post: null, dateISO: null, dedupeKey: null };

  const url = instagramPostUrl(item.url, item.shortCode ?? item.shortcode);
  const shortcode = firstString(item.shortCode, item.shortcode);
  const id = firstString(item.id);
  const dedupeKey = shortcode?.toLowerCase() ?? url?.toLowerCase() ?? id ?? null;
  if (!url || !dedupeKey) return { post: null, dateISO: null, dedupeKey: null };

  const dateISO = normalizeTimestamp(item.timestamp);
  if (!dateISO || !isWithinRangeApp(dateISO, range)) {
    return { post: null, dateISO, dedupeKey };
  }

  const owner = asRecord(item.owner);
  const account = firstString(item.ownerUsername, owner?.username) ?? "Unavailable";
  const caption = firstString(item.caption);
  const suppliedLikes = typeof item.likesCount === "number" && item.likesCount >= 0
    ? String(item.likesCount)
    : null;
  const hashtags = extractHashtags(item.hashtags, caption ?? "");
  const snippetHashtags = [...(caption ?? "").matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu)]
    .map((match) => match[1] ?? "");
  const snippet = (caption ?? "").slice(0, 600);
  const localDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: range.timezone || APP_TZ,
  }).format(new Date(dateISO));

  return {
    post: {
      title: account === "Unavailable" ? "Instagram post" : `Post by @${account.replace(/^@/, "")}`,
      url,
      caption,
      snippet,
      hashtags,
      snippetHashtags,
      account,
      likes: suppliedLikes === null ? null : formatCompactCount(suppliedLikes) || suppliedLikes,
      comments: null,
      postedDate: localDate,
    },
    dateISO,
    dedupeKey,
  };
}

function ensureFollowUp(answer: string, intent: "count" | "narrative"): string {
  const trimmed = answer.trim();
  if (!trimmed || /\?\s*$/.test(trimmed)) return trimmed;
  const followUp = intent === "count"
    ? "Want me to narrow this by date range or search term?"
    : `Want me to focus on a theme or account in these results?`;
  return `${trimmed}\n\n${followUp}`;
}

function deterministicAnswer(
  intent: "count" | "narrative",
  count: number,
  query: string,
  rangeLabel: string,
): string {
  if (count === 0) {
    return `I couldn't find matching Instagram posts for "${query}" in ${rangeLabel}. The results depend on what Apify returned for this search. Want me to widen the date range or refine the term?`;
  }
  if (intent === "count") {
    return `Apify returned ${count} unique matching Instagram posts for "${query}" in ${rangeLabel}. This is the retrieved result count, not an Instagram-wide total. Want me to narrow it by date or search term?`;
  }
  return `I found ${count} unique matching Instagram posts for "${query}" in ${rangeLabel}. They are shown below; this is provider coverage, not an Instagram-wide count. Want me to focus on a theme or account?`;
}

function makeMeta(
  question: string,
  range: ResolvedDateRangeApp,
  query: string,
  postViews: ApifyPostView[],
  rawCount: number,
  undatedExcluded: number,
  intent: "count" | "narrative",
  warnings: string[],
  limitations: string[],
  providerAttempted: boolean,
  dedupedCount: number,
): ResearchMeta {
  const integrations = getIntegrationStatus();
  return {
    status: warnings.length ? "degraded" : "ok",
    question,
    intent: "narratives",
    intentKind: intent === "count" ? "post_count" : "social_listening",
    dateRange: { ...range },
    previousDateRange: null,
    queries: [query],
    resultsRetrieved: rawCount,
    resultsAfterDedupe: dedupedCount,
    resultsIncluded: postViews.length,
    undatedExcluded,
    sourceTypesSearched: ["social"],
    providersSearched: providerAttempted ? ["apify"] : [],
    comparisonAvailable: false,
    integrations: {
      ...integrations,
      apify: { configured: integrations.apify?.configured ?? false },
    },
    limitations,
    warnings,
    generatedAt: new Date().toISOString(),
    instagramResults: {
      entity: query,
      dateRangeLabel: range.label,
      googleEstimatedResults: null,
      estimateQuery: null,
      isCountRequest: intent === "count",
      retrievalSource: "apify",
      posts: postViews,
    },
  };
}

export async function runApifyInstagramResearch(
  question: string,
  history: HistoryTurn[],
  dateFrom: string | null,
  dateTo: string | null,
  datePreset: DatePreset | null,
  gemini: GeminiClient | null,
  signal?: AbortSignal,
): Promise<{ message: string; meta: ResearchMeta; status: "complete" | "degraded" }> {
  const now = new Date();
  const range = resolveWindow(question, dateFrom, dateTo, datePreset, now);
  const config = getApifyInstagramConfig();
  const noPosts: ApifyPostView[] = [];

  const makeEmpty = (
    message: string,
    limitations: string[],
    providerAttempted = false,
    query = "Instagram search not run",
  ) => ({
    message,
    status: "degraded" as const,
    meta: makeMeta(
      question,
      range,
      query,
      noPosts,
      0,
      0,
      "narrative",
      ["Deep thinking did not complete the search."],
      limitations,
      providerAttempted,
      0,
    ),
  });

  if (!config) {
    return makeEmpty(
      "Deep thinking is not configured. Set APIFY_API_TOKEN and APIFY_INSTAGRAM_ACTOR_ID on the server; no Google/SerpAPI fallback was used.",
      ["Apify credentials and the reviewed actor ID are required for Deep thinking."],
    );
  }
  if (!gemini) {
    return makeEmpty(
      "Deep thinking needs GEMINI_API_KEY to understand the question and write a grounded answer. No Apify run or Google/SerpAPI fallback was started.",
      ["GEMINI_API_KEY is required for Deep thinking question parsing and conversational answers."],
    );
  }
  if (config.actorId.replace(/[~/]/g, "/").toLowerCase() !== "apify/instagram-hashtag-scraper") {
    return makeEmpty(
      "Deep thinking is configured for Apify's Instagram Hashtag Scraper input. Set APIFY_INSTAGRAM_ACTOR_ID to apify/instagram-hashtag-scraper or choose a supported actor; no fallback was used.",
      ["The configured Actor ID does not match the documented input this integration sends."],
    );
  }

  let extracted: z.infer<typeof extractionSchema>;
  try {
    const prior = promptHistory(history.filter((turn) => turn.content.trim() !== question.trim()));
    const extraction = await gemini.generateStructured({
      systemInstruction: `You identify the single Instagram search term in a user's natural-language request. Use the current message first and conversation history only to resolve a clear follow-up. Return query as the person, brand, or hashtag itself, never the whole question. Use searchType "hashtag" only when the user explicitly asks about or supplies a hashtag; otherwise use "keyword" for a person's or brand's name. Do not invent a profile handle or claim profile-timeline search. A keyword query uses Apify's documented Instagram keyword-search mode. Classify a direct request for a number of retrieved posts as count; otherwise narrative. If there is no search target, return query null.`,
      userContent: `Current message: ${question}\n\nPrior conversation:\n${prior || "(none)"}`,
      responseSchema: toGeminiSchema(extractionSchema),
      temperature: 0,
      signal,
    });
    const parsed = extractionSchema.safeParse(extraction);
    if (!parsed.success) throw new Error("The question parser returned an invalid response.");
    extracted = parsed.data;
  } catch (error) {
    logger.warn("Deep Instagram query extraction failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return makeEmpty(
      "I couldn't interpret that Instagram search. Please name a person, brand, or hashtag; no Apify run or Google/SerpAPI fallback was started.",
      ["Question parsing failed before retrieval."],
    );
  }

  const query = (extracted.query ?? "").trim().replace(/^[@#]/, "");
  if (!query) {
    return makeEmpty(
      "Deep thinking searches Instagram posts by person, brand, keyword, or hashtag. Who or what should I search?",
      ["No Instagram search term was identified; retrieval was not started."],
    );
  }

  // This Actor exposes a results limit, not page-number pagination. One bounded
  // run avoids pretending that maxPages is pagination or starting extra paid runs.
  const safeLimit = Math.max(1, Math.min(config.maxResults, 100));
  const searchType = extracted.searchType;
  let dataset: unknown[];
  try {
    dataset = await searchApifyInstagram(
      config,
      { query, searchType, limit: safeLimit },
      signal,
    );
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
    logger.warn("Apify Instagram retrieval failed", {
      status: Number.isFinite(status) ? status : undefined,
      actorId: config.actorId,
    });
    return makeEmpty(
      status === 401 || status === 403
        ? "Apify rejected the request. Check the server token and Actor access, then try again. No Google/SerpAPI fallback was used."
        : "Apify could not complete this Instagram search. Try again later or check the Actor configuration; no Google/SerpAPI fallback was used.",
      ["Apify retrieval failed; no other provider was used."],
      true,
      query,
    );
  }

  const unique = new Map<string, PostParseResult>();
  const seenKeys = new Set<string>();
  let undatedExcluded = 0;
  for (const item of dataset) {
    const parsed = parsePost(item, range);
    if (!parsed.dedupeKey || seenKeys.has(parsed.dedupeKey)) continue;
    seenKeys.add(parsed.dedupeKey);
    if (!parsed.dateISO) {
      undatedExcluded += 1;
      continue;
    }
    if (!parsed.post) continue;
    unique.set(parsed.dedupeKey, parsed);
  }
  const postViews = [...unique.values()].flatMap((entry) => entry.post ? [entry.post] : []);
  const warnings: string[] = [];
  if (dataset.length >= safeLimit) {
    warnings.push(`Apify returned the configured result cap (${safeLimit}); additional matches may exist.`);
  }
  if (undatedExcluded > 0) {
    warnings.push(`${undatedExcluded} result(s) without a usable timestamp were excluded from the selected date window.`);
  }
  const limitations = [
    "Apify keyword/hashtag search covers provider-returned public results, not every Instagram post or an Instagram-wide total.",
    "This Actor documents a results limit but no exact from/to date-window input; timestamps are filtered locally, so older or narrow windows can be under-covered.",
    "Show more reveals rows already fetched in this one bounded Actor run; it does not launch another paid run.",
    "Account attribution and hashtags are displayed only when present in returned post metadata or captions.",
  ];

  let message = deterministicAnswer(extracted.intent, postViews.length, query, range.label);
  if (postViews.length > 0) {
    try {
      const postsText = postViews.slice(0, 25).map((post, index) =>
        `${index + 1}. ${post.title}; account ${post.account}; date ${post.postedDate ?? "unknown"}; likes ${post.likes ?? "not returned"}; caption ${post.snippet}`,
      ).join("\n");
      const answer = await gemini.generateStructured({
        systemInstruction: `You are Tubitex, a warm, concise Instagram analyst. Answer the current question in natural language using only the supplied Apify posts and prior conversation. Attribute observations to the posts, never treat allegations as facts, and never claim these are all Instagram posts. For a count question, state only the number of unique posts returned in this search window, not an Instagram-wide total. For other questions, do not invent counts or details. Keep the answer focused and finish with one useful follow-up question.`,
        userContent: `Current question: ${question}\nSearch term: ${query}\nSelected date window: ${range.label}\nUnique posts returned within the window: ${postViews.length}\n\nConversation:\n${promptHistory(history.filter((turn) => turn.content.trim() !== question.trim())) || "(none)"}\n\nApify Instagram posts:\n${postsText}`,
        responseSchema: toGeminiSchema(answerSchema),
        temperature: 0.2,
        signal,
      });
      const parsed = answerSchema.safeParse(answer);
      if (parsed.success && parsed.data.answer.trim()) {
        message = ensureFollowUp(parsed.data.answer, extracted.intent);
      } else {
        warnings.push("Gemini returned an unusable answer; a plain result summary is shown instead.");
      }
    } catch (error) {
      logger.warn("Deep Instagram answer generation failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      warnings.push("Gemini answer generation failed; a plain result summary is shown instead.");
    }
  }

  return {
    message,
    status: warnings.length ? "degraded" : "complete",
    meta: makeMeta(
      question,
      range,
      query,
      postViews,
      dataset.length,
      undatedExcluded,
      extracted.intent,
      warnings,
      limitations,
      true,
      seenKeys.size,
    ),
  };
}
