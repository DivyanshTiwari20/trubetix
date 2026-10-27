import "server-only";
import { z } from "zod";
import type { GeminiClient } from "@/lib/ai/gemini";
import { toGeminiSchema } from "@/lib/validation/gemini-schema";
import { createSerpApiProvider, type SerpApiSearchResult } from "@/lib/providers/serpapi";
import type { SerpApiOrganicResult } from "@/lib/providers/types";
import { getSerpApiKey, getResearchConfig } from "@/lib/env";
import { APP_TZ } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { ResearchMeta } from "@/types";
import { shortcodeFromUrl, dateFromShortcode } from "@/lib/research/igDate";
import { resolveDateRangeApp, toSerpApiTbsApp } from "@/lib/research/dateRange";
import type { ResolvedDateRangeApp } from "@/lib/research/dateRange";

export interface SimpleInstagramPost {
  url: string;
  title: string;
  account: string;
  accountSource: "provider" | "search-result text" | null;
  dateISO: string | null;
  dateText: string | null;
  googleRelativeTime: string | null;
  likesText: string | null;
  likesNum: number | null;
  commentsText: string | null;
  commentsNum: number | null;
  caption: string | null;
  hashtags: string[];
  snippetHashtags: string[];
  snippet: string;
  dateSource: "provider" | "shortcode" | null;
  providerMetadata: Record<string, unknown>;
}

const entityExtractionSchema = z.object({
  entity: z.string().nullable(),
  isCorrection: z.boolean(),
  intent: z.enum(["count", "narrative", "show_more", "chat", "unclear", "business_fit"]),
});

export type EntityExtractionResult = z.infer<typeof entityExtractionSchema>;

const EXTRACTION_SYSTEM_INSTRUCTION = `You are an entity extraction assistant for an Instagram research tool.

Extract the primary entity and intent for the CURRENT Instagram request. The current user message is authoritative; use prior user messages only to resolve a clear follow-up that has no entity of its own. Never let an older entity override a name or brand explicitly present in the current message.

IGNORE these filler words - they are NEVER entities: tell, tll, me, about, give, show, what, how, many, posts, number, reaction, people, saying, on, insta, instagram, in, last, days, good, bad, business, bussiness, image, fit, suitable, right, wrong, should, would, could, the, a, an, and, or, but, if, then, than, that, this, these, those, there, their, them, they, it, its, of, to, for, with, from, by, into, over, under, again, further, once, here, all, any, some, no, not, only, own, same, so, too, very, just, please, find, analyze, analyse, identify, summarize, summarise, explain, describe, report, around, regarding, concerning, our, my, we, i, us, you, your, client, clients, latest, recent, new, major, most, past, next, week, weeks, month, months, day, year, years, today, yesterday, media, conversation, narratives, narrative, risks, risk, changes, change, developments, happening, buzzing, buzz, happened, cover, coverage, story, stories, outlet, outlets, press, publication, publications, competitor, competitors, reputational, reputation, potential, team, investigate, recommend, actions, action, things, thing, much, more, less, anyone, someone, anything, everything, something, ig, tiktok, twitter, facebook, youtube, linkedin, reddit, threads, social, reel, reels, viral, trending, trend, sentiment, reactions, reacting, respond, responding, response, comments, comment, engagement, followers, follower, following, profile, profiles, account, accounts, bio, opinions, opinion, numbers, metric, metrics, statistics, statistic, stats, stat, figures, figure, count, counts, data, insights, insight, performance, reach, impressions, views, likes, shares, growth, overall, film, movie, series, show, person

A pronoun (him/her/them/his) means the entity from the previous USER message.

Return the REAL person/brand/hashtag name, properly capitalised. Correct common misspellings of famous people (e.g., "samain raina" → "Samay Raina", "srk" → "Shah Rukh Khan", "virat" → "Virat Kohli", "salman" → "Salman Khan"). If the name is not a known figure, keep the text as the user wrote it but capitalize properly.

Corrections ("i am asking for srk not salman khan", "no, I meant X", "not him, X"): isCorrection = true, entity = X; re-run the previous user question (same intent, same range) with entity X.

Return null for entity ONLY if there is genuinely no name-like word in the message.

Also identify the intent:
- "count" = user wants a post count/number (how many posts, total posts, count)
- "narrative" = user wants what people are saying, sentiment, reactions, narratives, buzz, image, reputation
- "business_fit" = user asks if person is good/suitable/fit for their business, brand fit, image for business
- "show_more" = user explicitly wants more posts/results
- "chat" = greeting, hi, thanks, bye, how are you, what can you do, small talk
- "unclear" = genuinely no entity-like word at all (e.g., "hello", "what can you do")

Default to "narrative" if an entity is found but intent is ambiguous.

Return ONLY valid JSON matching the schema.`;

const entityExtractionGeminiSchema = toGeminiSchema(entityExtractionSchema);

function extractExplicitEntity(question: string): string | null {
  const matches = [...question.matchAll(/\b(?:about|regarding|concerning|for|on|from|by|of)\s+([#@]?[\p{L}\p{N}][\p{L}\p{N}._'’-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}._'’-]*){0,5})/giu)];
  const platformWords = new Set(["instagram", "insta", "ig", "facebook", "youtube", "tiktok", "twitter", "reddit", "linkedin", "threads"]);
  const stop = /\b(?:about|regarding|concerning|the|a|an|of|in|during|within|over|last|past|this|today|yesterday|between|after|before|week|month|year|day|hours?|posts?|content|mentions?|videos?|reels?|stories|hashtags?|count|number|total|on instagram|on insta|on ig|on x|for the last)\b/i;

  for (const match of matches) {
    const candidate = (match[1] ?? "").split(stop)[0].trim().replace(/[.,!?;:]+$/, "");
    const normalized = candidate.replace(/^[@#]/, "").trim().replace(/['’]s$/i, "");
    if (!normalized || platformWords.has(normalized.toLowerCase())) continue;
    if (/^(?:last|past|this)\s+(?:week|month|year|day)$/i.test(normalized)) continue;
    return /^srk$/i.test(normalized) ? "Shah Rukh Khan" : normalized;
  }
  return null;
}

function sameEntityText(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return normalize(left) === normalize(right);
}

async function extractEntityWithGemini(
  question: string,
  userHistory: string[],
  gemini: GeminiClient
): Promise<EntityExtractionResult> {
  const priorMessages = userHistory.filter((message) => message.trim() !== question.trim()).slice(-6);
  const prompt = `Current user message (use this first):\n${question}\n\nPrior user messages for follow-up context only:\n${priorMessages.map((m, i) => `${i + 1}. ${m}`).join("\n") || "(none)"}`;

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

  const explicitEntity = extractExplicitEntity(question);
  const modelEntity = parsed.data.entity;
  const entity = explicitEntity
    ? (modelEntity && sameEntityText(modelEntity, explicitEntity) ? modelEntity : explicitEntity)
    : modelEntity;
  return { ...parsed.data, entity };
}

function adjustDateForTextOp(dateStr: string, days: number): string {
  const date = new Date(dateAtUtcNoonForLocalDay(dateStr, APP_TZ));
  date.setUTCDate(date.getUTCDate() + days);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${year}-${month}-${day}`;
}

function explicitDateRange(question: string, now: Date) {
  const text = question.toLowerCase();
  if (/\b(?:last|past)\s+24\s+hours?\b/.test(text)) return resolveDateRangeApp({ preset: "24h" }, now);
  if (/\b(?:last|past)\s+week\b/.test(text)) return resolveDateRangeApp({ preset: "7d" }, now);
  if (/\b(?:last|past)\s+month\b/.test(text)) return resolveDateRangeApp({ preset: "30d" }, now);

  const numberWords: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const match = text.match(/\b(?:last|past|over the last|within the last)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+days?\b/);
  if (match) {
    const days = Number(match[1]) || numberWords[match[1]];
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    return resolveDateRangeApp({ preset: "custom", from, to: now.toISOString() }, now);
  }
  if (/\b(?:last|past)\s+year\b/.test(text)) {
    const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    return resolveDateRangeApp({ preset: "custom", from, to: now.toISOString() }, now);
  }
  return null;
}

function normalizeDatePreset(preset: string | null): "24h" | "7d" | "30d" | "90d" | "custom" {
  const normalized = (preset ?? "7d").toLowerCase().replace(/[ -]/g, "_");
  if (["24h", "last_24_hours", "last_24h"].includes(normalized)) return "24h";
  if (["7d", "last_7_days", "last_week", "7_days"].includes(normalized)) return "7d";
  if (["30d", "last_30_days", "last_month", "30_days"].includes(normalized)) return "30d";
  if (["90d", "last_90_days", "last_3_months", "90_days"].includes(normalized)) return "90d";
  return normalized === "custom" ? "custom" : "7d";
}

function resolveRequestedDateRange(
  question: string,
  dateFrom: string | null,
  dateTo: string | null,
  datePreset: string | null,
  now: Date,
) {
  const explicitRange = explicitDateRange(question, now);
  if (explicitRange) return explicitRange;
  const preset = normalizeDatePreset(datePreset);
  if (preset === "custom" && dateFrom && dateTo) {
    return resolveDateRangeApp({ preset: "custom", from: dateFrom, to: dateTo }, now);
  }
  if (dateFrom && dateTo) {
    return resolveDateRangeApp({ preset, from: dateFrom, to: dateTo }, now);
  }
  return resolveDateRangeApp({ preset }, now);
}

function extractEntitySearchVariants(question: string, entity: string): string[] {
  const variants = new Set([entity.trim()]);
  const platformWords = new Set(["instagram", "insta", "ig", "facebook", "youtube", "tiktok", "twitter", "reddit", "linkedin", "threads"]);
  const stop = /\b(?:about|regarding|concerning|for|on|from|of|in|during|within|over|last|past|this|today|yesterday|week|month|year|day|posts?|reels?|videos?|stories|total|count|number|instagram|insta|ig|my|our|the|a|an)\b/i;
  const subjectMatches = question.matchAll(/\b(?:about|regarding|concerning|for|on|from)\s+([#@]?[\p{L}\p{N}][\p{L}\p{N}._'’-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}._'’-]*){0,5})/giu);
  for (const match of subjectMatches) {
    const candidate = (match[1] ?? "").split(stop)[0].trim().replace(/[.,!?;:]+$/, "");
    const normalized = candidate.replace(/^[@#]/, "").trim();
    if (normalized && !platformWords.has(normalized.toLowerCase()) && !sameEntityText(normalized, entity)) {
      variants.add(candidate);
    }
  }

  const aliasMatches = question.matchAll(/\b(?:aka|also known as|known as|alias(?:ed)? as)\s+([^,.!?;]+)/giu);
  for (const match of aliasMatches) {
    const candidate = (match[1] ?? "").split(stop)[0].trim().replace(/[.,!?;:]+$/, "");
    if (candidate && !sameEntityText(candidate.replace(/^[@#]/, ""), entity)) variants.add(candidate);
  }

  return [...variants].filter(Boolean);
}

export function extractSearchKeywords(question: string, entity: string): string[] {
  const stopWords = new Set([
    "what", "are", "is", "the", "a", "an", "of", "for", "about", "on", "in", "to", "from", "by", "with",
    "how", "many", "number", "total", "count", "counts", "posts", "post", "done", "show", "find", "get", "give", "me", "please", "tell", "tll",
    "instagram", "insta", "ig", "last", "past", "week", "weeks", "month", "months", "year", "years", "day", "days",
    "today", "yesterday", "recent", "latest", "within", "during", "over", "after", "before", "this", "that", "these",
  ]);
  const entityTexts = [entity, extractExplicitEntity(question) ?? "", ...extractEntitySearchVariants(question, entity)];
  const entityWords = new Set(entityTexts.flatMap((value) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  const tokens = question.match(/#[\p{L}\p{N}_]+|[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  return [...new Set(tokens.filter((token) => {
    if (token.startsWith("#")) return !entityWords.has(token.slice(1).toLowerCase());
    const word = token.toLowerCase();
    return word.length > 1 && !stopWords.has(word) && !entityWords.has(word);
  }))].slice(0, 4);
}

type EngagementMetric = "likes" | "comments";
interface ParsedEngagementMetric {
  value: number;
  text: string;
}

const ENGAGEMENT_NUMBER_PATTERN = String.raw`(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?`;
const ENGAGEMENT_UNIT_PATTERN = String.raw`(k|m|l|lakh|lakhs|cr|crore|crores)?`;

function parseEngagementMetric(
  input: string | number,
  metric: EngagementMetric,
  allowBareValue = false,
): ParsedEngagementMetric | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return { value: Math.round(input), text: `${new Intl.NumberFormat("en-US").format(input)} ${metric}` };
  }

  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const labeledPattern = new RegExp(
    String.raw`(?:^|[^\p{L}\p{N}])${ENGAGEMENT_NUMBER_PATTERN}\s*${ENGAGEMENT_UNIT_PATTERN}\s*\+?\s*${metric}(?![\p{L}\p{N}])`,
    "giu",
  );
  const labeledMatches = [...text.matchAll(labeledPattern)];
  if (labeledMatches.length > 1) {
    const parsed = labeledMatches.map((match) => metricFromMatch(match, metric));
    const distinct = new Map(parsed.filter((item): item is ParsedEngagementMetric => item !== null).map((item) => [item.value, item]));
    return distinct.size === 1 ? [...distinct.values()][0] : null;
  }
  if (labeledMatches.length === 1) return metricFromMatch(labeledMatches[0], metric);
  if (!allowBareValue) return null;

  const barePattern = new RegExp(
    String.raw`^\s*${ENGAGEMENT_NUMBER_PATTERN}\s*${ENGAGEMENT_UNIT_PATTERN}\s*\+?\s*$`,
    "i",
  );
  const bareMatch = text.match(barePattern);
  return bareMatch ? metricFromMatch(bareMatch, metric) : null;
}

function metricFromMatch(
  match: RegExpMatchArray,
  metric: EngagementMetric,
): ParsedEngagementMetric | null {
  const numeric = Number(`${(match[1] ?? "").replace(/,/g, "")}${match[2] ? `.${match[2]}` : ""}`);
  if (!Number.isFinite(numeric) || numeric < 0) return null;

  const unit = (match[3] ?? "").toLowerCase();
  const multiplier = unit === "k" ? 1_000
    : unit === "m" ? 1_000_000
    : unit === "l" || unit === "lakh" || unit === "lakhs" ? 100_000
    : unit === "cr" || unit === "crore" || unit === "crores" ? 10_000_000
    : 1;
  const value = Math.round(numeric * multiplier);
  const amount = `${match[1]}${match[2] ? `.${match[2]}` : ""}${match[3] ? ` ${match[3]}` : ""}`;
  return { value, text: `${amount} ${metric}` };
}

function uniqueMetricFromValues(
  values: Array<string | number>,
  metric: EngagementMetric,
  allowBareValue: boolean,
): ParsedEngagementMetric | null {
  const parsed = values
    .map((value) => parseEngagementMetric(value, metric, allowBareValue))
    .filter((value): value is ParsedEngagementMetric => value !== null);
  const distinct = new Map(parsed.map((value) => [value.value, value]));
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}

function extractOwner(raw: SerpApiOrganicResult): string | null {
  const owner = raw.owner;
  if (typeof owner === "string" && owner.trim()) return owner.trim().replace(/^@/, "");
  if (owner && typeof owner === "object") {
    const username = "username" in owner ? owner.username : null;
    if (typeof username === "string" && username.trim()) return username.trim().replace(/^@/, "");
  }
  if (typeof raw.username === "string" && raw.username.trim()) return raw.username.trim().replace(/^@/, "");
  return null;
}

function extractHashtags(caption: string | null, supplied: unknown): string[] {
  const values = Array.isArray(supplied)
    ? supplied.filter((value): value is string => typeof value === "string")
    : [];
  const fromCaption = caption?.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set([...values, ...fromCaption])];
}

function extractSnippetHashtags(snippet: string | null): string[] {
  return [...new Set(snippet?.match(/#[\p{L}\p{N}_]+/gu) ?? [])];
}

function extractAccountFromText(title: string, snippet: string | null, displayedLink: string | null): string {
  const combined = title + " " + (snippet ?? "") + " " + (displayedLink ?? "");

  const parenMatch = combined.match(/\(@([A-Za-z0-9._]{1,30})\)/);
  if (parenMatch) return parenMatch[1].toLowerCase();

  const onMatch = (snippet ?? "").match(/^([A-Za-z0-9._]{1,30})\s+on\s+\d/);
  if (onMatch) return onMatch[1].toLowerCase();

  if (displayedLink) {
    const linkMatch = displayedLink.match(
      /instagram\.com\/(?!p(?:\/|$)|reel(?:\/|$)|reels(?:\/|$)|tv(?:\/|$))([A-Za-z0-9._]{1,30})/i,
    );
    if (linkMatch) return linkMatch[1].toLowerCase();
  }

  return "unknown";
}

function extractGoogleRelativeTime(snippet: string | null): string | null {
  if (!snippet) return null;
  const m = snippet.match(/(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)/i);
  return m ? m[1] : null;
}

function isPostUrl(url: string): boolean {
  return /\/(?:p|reel|reels|tv)\/[^/?#]+/i.test(url);
}

function canonicalInstagramPostUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;
    const [, route, shortcode] = parsed.pathname.match(/^\/(p|reel|reels|tv)\/([^/]+)/i) ?? [];
    if (!route || !shortcode) return null;
    return `https://www.instagram.com/${route.toLowerCase()}/${shortcode}/`;
  } catch {
    return null;
  }
}

function normalizePost(raw: SerpApiOrganicResult): SimpleInstagramPost | null {
  if (!raw.link || !isPostUrl(raw.link)) return null;
  const url = canonicalInstagramPostUrl(raw.link);
  if (!url) return null;

  const title = raw.title ?? "Not returned";
  const snippet = raw.snippet ?? null;
  const displayedLink = raw.displayed_link ?? null;

  const shortcode = shortcodeFromUrl(url);
  if (!shortcode) return null;

  const returnedOwner = extractOwner(raw);
  const account = returnedOwner ?? extractAccountFromText(title, snippet, displayedLink);
  const accountSource = returnedOwner ? "provider" : account !== "unknown" ? "search-result text" : null;
  const googleRelativeTime = extractGoogleRelativeTime(snippet);
  const captionValue = typeof raw.caption === "string" ? raw.caption : raw.caption_text;
  const caption = typeof captionValue === "string" && captionValue.trim() ? captionValue.trim() : null;
  const hashtags = extractHashtags(caption, raw.hashtags);
  const snippetHashtags = extractSnippetHashtags(snippet);

  const detected = raw.rich_snippet?.top?.detected_extensions ?? {};
  const detectedLikes = Object.entries(detected)
    .filter(([key]) => /likes?/i.test(key))
    .map(([, value]) => String(value));
  const detectedComments = Object.entries(detected)
    .filter(([key]) => /comments?/i.test(key))
    .map(([, value]) => String(value));
  const extensionValues = (raw.extensions ?? []).map(String);

  const likesMetric = uniqueMetricFromValues(
    raw.likes !== undefined ? [raw.likes] : [], "likes", true,
  ) ?? uniqueMetricFromValues(detectedLikes, "likes", true)
    ?? uniqueMetricFromValues(extensionValues, "likes", false)
    ?? (snippet ? parseEngagementMetric(snippet, "likes", false) : null);
  const commentsMetric = uniqueMetricFromValues(
    raw.comments !== undefined ? [raw.comments] : [], "comments", true,
  ) ?? uniqueMetricFromValues(detectedComments, "comments", true)
    ?? uniqueMetricFromValues(extensionValues, "comments", false)
    ?? (snippet ? parseEngagementMetric(snippet, "comments", false) : null);

  const likesText = likesMetric?.text ?? null;
  const likesNum = likesMetric?.value ?? null;
  const commentsText = commentsMetric?.text ?? null;
  const commentsNum = commentsMetric?.value ?? null;

  let dateISO: string | null = null;
  let dateText: string | null = null;
  let dateSource: "provider" | "shortcode" | null = null;

  if (raw.date) {
    const parsed = new Date(raw.date);
    if (!isNaN(parsed.getTime())) {
      dateISO = parsed.toISOString();
      dateText = parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      dateSource = "provider";
    }
  }

  if (!dateISO) {
    const d = dateFromShortcode(shortcode);
    if (d) {
      dateISO = d.toISOString();
      dateText = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      dateSource = "shortcode";
    }
  }

  const snippetForGemini = (snippet ?? "").replace(/\s+/g, " ");

  return {
    url,
    title,
    account,
    accountSource,
    dateISO,
    dateText,
    googleRelativeTime,
    likesText,
    likesNum,
    commentsText,
    commentsNum,
    caption,
    hashtags,
    snippetHashtags,
    snippet: snippetForGemini,
    dateSource,
    providerMetadata: { ...raw },
  };
}

function dateAtUtcNoonForLocalDay(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day"), 12)).toISOString();
}

function toGoogleEstimateDateRange(range: ResolvedDateRangeApp): ResolvedDateRangeApp {
  return {
    ...range,
    from: dateAtUtcNoonForLocalDay(range.from, range.timezone),
    to: dateAtUtcNoonForLocalDay(range.to, range.timezone),
  };
}

interface SearchResult {
  posts: SimpleInstagramPost[];
  googleEstimate: number | string | null;
  estimateQuery: string | null;
  estimateDateRange: { from: string; to: string; label: string; timezone: string; preset: string | null } | null;
  estimateDateFilter: string | null;
  estimateNumResults: number | null;
  estimateProviderTotalResults: number | string | null;
  estimateProvenance: {
    query: string;
    queryDisplayed: string | null;
    parameters: Record<string, string>;
    totalResults: number | string | null;
  } | null;
  estimateError: string | null;
  rawOrganicResultsFetched: number;
  pagesFetched: number;
  queriesAtPageLimit: string[];
  paginationErrors: string[];
  error: string | null;
  queriesTried: string[];
}

async function searchInstagramPosts(
  entities: string[],
  keywords: string[],
  range: ResolvedDateRangeApp,
  config: ReturnType<typeof getResearchConfig>,
  signal?: AbortSignal
): Promise<SearchResult> {
  const rangeFrom = range.from;
  const rangeTo = range.to;
  const rangeLabel = range.label;
  const serpApiKey = getSerpApiKey();
  if (!serpApiKey) throw new Error("SERPAPI_API_KEY not configured");

  const provider = createSerpApiProvider({
    apiKey: serpApiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
  const afterText = adjustDateForTextOp(rangeFrom, -1);
  const beforeText = adjustDateForTextOp(rangeTo, 1);
  const paths = ["/p/", "/reel/", "/reels/", "/tv/"];
  const representativeEntity = entities[0] ?? null;
  const estimateEntity = representativeEntity?.replace(/[\"\r\n]/g, " ").replace(/\s+/g, " ").trim() ?? "";
  const estimateQuery = estimateEntity ? `site:instagram.com ${estimateEntity}` : null;
  const estimateDateRange = range;
  const estimateProviderDateRange = toGoogleEstimateDateRange(range);
  const estimateDateFilter = toSerpApiTbsApp(estimateProviderDateRange);
  const estimateNumResults = estimateQuery ? config.maxResultsPerQuery : null;
  let googleEstimate: number | string | null = null;
  let estimateProviderTotalResults: number | string | null = null;
  let estimateProvenance: SearchResult["estimateProvenance"] = null;
  let estimateError: string | null = null;

  if (estimateQuery && estimateNumResults !== null) {
    try {
      // Google often omits the "About N results" count when a time filter
      // (cdr:) is applied, so run the estimate without it. The date window
      // still scopes the posts retrieved below via query-level after:/before:.
      const estimateResponse = await provider.searchWithInfo(
        {
          query: estimateQuery,
          numResults: estimateNumResults,
          dateRange: null,
          fetchAllPages: false,
          newsOnly: false,
        },
        { signal },
      );
      let providerTotalResults = estimateResponse.searchInformation?.total_results;
      estimateProvenance = {
        query: estimateQuery,
        queryDisplayed: estimateResponse.searchInformation?.query_displayed ?? null,
        parameters: estimateResponse.requestParameters ?? {},
        totalResults: providerTotalResults ?? null,
      };
      if (providerTotalResults === undefined || providerTotalResults === null) {
        estimateError = "SerpAPI omitted search_information.total_results.";
      } else {
        estimateError = null;
      }

      // Fallback: an all-Instagram entity query (e.g. "Instagram Nike posts")
      // usually still carries a total result count even when the site: query
      // does not.
      if ((providerTotalResults === undefined || providerTotalResults === null) && estimateEntity) {
        try {
          const fallbackResponse = await provider.searchWithInfo(
            {
              query: `Instagram ${estimateEntity} posts`,
              numResults: 10,
              dateRange: null,
              fetchAllPages: false,
              newsOnly: false,
            },
            { signal },
          );
          const fallbackTotal = fallbackResponse.searchInformation?.total_results;
          if (fallbackTotal !== undefined && fallbackTotal !== null) {
            providerTotalResults = fallbackTotal;
            estimateProvenance = {
              query: `Instagram ${estimateEntity} posts`,
              queryDisplayed: fallbackResponse.searchInformation?.query_displayed ?? null,
              parameters: fallbackResponse.requestParameters ?? {},
              totalResults: fallbackTotal,
            };
            estimateError = null;
          }
        } catch (fallbackError) {
          logger.warn("Instagram Google fallback estimate query failed", {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }

      if (providerTotalResults !== undefined && providerTotalResults !== null) {
        googleEstimate = providerTotalResults;
        estimateProviderTotalResults = providerTotalResults;
      }
    } catch (error) {
      estimateError = error instanceof Error ? error.message : String(error);
      logger.warn("Instagram Google estimate query failed", { error: estimateError, query: estimateQuery });
    }
  }

  const discoveryTerms = new Map<string, string>();
  for (const variant of entities) {
    const entityVariant = variant.trim();
    if (!entityVariant) continue;
    discoveryTerms.set(entityVariant, entityVariant);
    for (const keyword of keywords) {
      if (!sameEntityText(keyword, entityVariant)) {
        const combined = `${entityVariant} ${keyword}`.replace(/\s+/g, " ").trim();
        discoveryTerms.set(combined, entityVariant);
      }
    }
  }
  const discoveryQueries = paths.flatMap((path) =>
    [...discoveryTerms.entries()].flatMap(([term, entity]) => {
      const safeTerm = term.replace(/[\"\r\n]/g, " ").replace(/\s+/g, " ").trim();
      const queries = [`site:instagram.com inurl:${path} \"${safeTerm}\" after:${afterText} before:${beforeText}`];
      if (safeTerm.includes(" ")) {
        queries.push(`site:instagram.com inurl:${path} ${safeTerm} after:${afterText} before:${beforeText}`);
      }
      return queries.map((query) => ({ entity, query }));
    }),
  );
  const seenQueries = new Set<string>();
  const queryVariations = discoveryQueries.filter(({ query }) => {
    if (seenQueries.has(query)) return false;
    seenQueries.add(query);
    return true;
  });

  const allPosts: SimpleInstagramPost[] = [];
  const seenPostShortcodes = new Set<string>();
  const queriesTried: string[] = [];
  const queriesAtPageLimit: string[] = [];
  const paginationErrors: string[] = [];
  let rawOrganicResultsFetched = 0;
  let pagesFetched = 0;
  let lastError: string | null = null;

  for (const { entity, query } of queryVariations) {
    queriesTried.push(query);
    logger.info("Instagram simple query", { query, entity, rangeLabel });

    let result: SerpApiSearchResult;
    try {
      result = await provider.searchWithInfo(
        {
          query,
          numResults: config.maxResultsPerQuery,
          dateRange: estimateDateRange,
          fetchAllPages: true,
          newsOnly: false,
        },
        { signal },
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      paginationErrors.push(`${query}: ${lastError}`);
      logger.error("Instagram SerpAPI query failed", { error: lastError, entity, query });
      continue;
    }

    if (!result) {
      lastError = "Provider does not support searchWithInfo";
      paginationErrors.push(`${query}: ${lastError}`);
      continue;
    }
    rawOrganicResultsFetched += result.rawOrganicResults.length;
    pagesFetched += result.pagesFetched;
    if (result.pageLimitReached) queriesAtPageLimit.push(query);
    if (result.paginationError) paginationErrors.push(`${query}: ${result.paginationError}`);

    for (const raw of result.rawOrganicResults) {
      const normalized = normalizePost(raw);
      if (!normalized) continue;
      const canonicalUrl = canonicalInstagramPostUrl(normalized.url);
      const postShortcode = canonicalUrl ? shortcodeFromUrl(canonicalUrl) : null;
      if (!canonicalUrl || !postShortcode || seenPostShortcodes.has(postShortcode)) continue;
      seenPostShortcodes.add(postShortcode);
      allPosts.push({ ...normalized, url: canonicalUrl });
    }
  }

  return {
    posts: allPosts,
    googleEstimate,
    estimateQuery,
    estimateDateRange: estimateQuery ? estimateDateRange : null,
    estimateDateFilter: estimateQuery ? estimateDateFilter : null,
    estimateNumResults,
    estimateProviderTotalResults,
    estimateProvenance,
    estimateError,
    rawOrganicResultsFetched,
    pagesFetched,
    queriesAtPageLimit,
    paginationErrors,
    error: allPosts.length === 0 ? lastError : null,
    queriesTried,
  };
}

async function fetchMorePosts(
  entity: string,
  rangeFrom: string,
  rangeTo: string,
  config: ReturnType<typeof getResearchConfig>,
  existingPosts: SimpleInstagramPost[],
  signal?: AbortSignal
): Promise<SimpleInstagramPost[]> {
  const serpApiKey = getSerpApiKey();
  if (!serpApiKey) return existingPosts;

  const afterText = adjustDateForTextOp(rangeFrom, -1);
  const beforeText = adjustDateForTextOp(rangeTo, 1);
  const query = `site:instagram.com inurl:/p/ "${entity}" after:${afterText} before:${beforeText}`;
  const provider = createSerpApiProvider({
    apiKey: serpApiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
  const result = await provider.searchWithInfo?.(
    {
      query,
      numResults: config.maxResultsPerQuery,
      dateRange: { from: rangeFrom, to: rangeTo, label: "", timezone: "UTC", preset: null },
      fetchAllPages: true,
      newsOnly: false,
    },
    { signal },
  );
  if (!result) return existingPosts;

  const seenPostShortcodes = new Set(
    existingPosts
      .map((post) => canonicalInstagramPostUrl(post.url))
      .filter((url): url is string => Boolean(url))
      .map((url) => shortcodeFromUrl(url))
      .filter((shortcode): shortcode is string => Boolean(shortcode)),
  );
  const allPosts = [...existingPosts];
  for (const raw of result.rawOrganicResults) {
    const normalized = normalizePost(raw);
    if (!normalized) continue;
    const canonicalUrl = canonicalInstagramPostUrl(normalized.url);
    const postShortcode = canonicalUrl ? shortcodeFromUrl(canonicalUrl) : null;
    if (!canonicalUrl || !postShortcode || seenPostShortcodes.has(postShortcode)) continue;
    seenPostShortcodes.add(postShortcode);
    allPosts.push({ ...normalized, url: canonicalUrl });
  }
  return allPosts;
}

interface GeminiAnalysisInput {
  posts: Array<{
    title: string;
    account: string;
    date: string | null;
    likes: string | null;
    snippet: string;
  }>;
  intent: "count" | "narrative" | "show_more" | "chat" | "unclear" | "business_fit" | `business_fit:${string}` | "other";
  entity: string;
}

const analysisSchema = z.object({
  answer: z.string(),
});

async function analyzeWithGemini(
  input: GeminiAnalysisInput,
  gemini: GeminiClient
): Promise<string> {
  const postsText = input.posts.map((p, i) =>
    `${i + 1}. ${p.title} | @${p.account} | ${p.date ?? "no date"} | ${p.likes ?? "no likes"} | ${p.snippet}`
  ).join("\n");

  let systemInstruction = `You are Tubetix, a friendly and sharp social-media analyst. Talk like a smart, calm person: natural Indian English, short sentences, warm but direct, no corporate words, no emoji in results (at most one in casual chat). Never open with filler like 'Certainly' or 'Great question'. Use only the posts you are given; attribute claims ('according to posts by ...') and say 'reported' for allegations. Never write post counts, likes totals or estimate numbers yourself; the app shows those. If you do not understand, ask one short question. If the posts do not cover the question, say so in one line.`;

  if (input.intent === "count") {
    systemInstruction += `\n\nWrite EXACTLY ONE sentence summarizing the key themes or activity. Do NOT give or compute any post counts. Do NOT repeat any estimate numbers.`;
  } else if (input.intent.startsWith("business_fit")) {
    const businessType = input.intent.split(":")[1] || "business";
    systemInstruction += `\n\nThe user asks if "${input.entity}" is a good fit for their ${businessType} business. Write 5 to 7 short sentences using ONLY the supplied posts:
- What the person is mostly known for in these posts
- The tone of the conversation
- Any reported controversies (attribute with "reported")
- How this could fit or clash with a ${businessType} business
State in one line: "This assessment is based on Instagram posts only."
End with ONE short follow-up question (e.g., about their target audience).
Never state allegations as facts. Never invent facts not in the posts.`;
  } else if (input.intent === "narrative") {
    systemInstruction += `\n\nWrite a short answer (max 8 sentences). Themes as short bullets. Attribute claims. Use "reported" for allegations. Do NOT give or compute any post counts. Do NOT repeat any estimate numbers.`;
  } else {
    systemInstruction += `\n\nProvide a brief answer about Instagram posts for "${input.entity}". Do NOT give or compute any post counts. Do NOT repeat any estimate numbers.`;
  }

  const prompt = `Instagram posts for "${input.entity}" (up to 30 posts):\n${postsText}`;

  const response = await gemini.generateStructured({
    systemInstruction,
    userContent: prompt,
    responseSchema: toGeminiSchema(analysisSchema),
    temperature: 0,
  });

  const parsed = analysisSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(`Gemini analysis returned invalid JSON: ${parsed.error.message}`);
  }

  return parsed.data.answer;
}

async function chatWithGemini(message: string, gemini: GeminiClient): Promise<string> {
  const systemInstruction = `You are Tubetix, a friendly and sharp social-media analyst. Talk like a smart, calm person: natural Indian short sentences, warm but direct, no corporate words, no emoji (at most one in casual chat). Never open with filler like 'Certainly' or 'Great question'. Keep it to 1-3 lines.`;
  
  const schema = z.object({ answer: z.string() });
  
  const response = await gemini.generateStructured({
    systemInstruction,
    userContent: message,
    responseSchema: toGeminiSchema(schema),
    temperature: 0.7,
  });
  
  const parsed = schema.safeParse(response);
  if (!parsed.success) {
    return "Hey! Want to check Instagram buzz for someone?";
  }
  return parsed.data.answer;
}

function sortPostsByLikes(posts: SimpleInstagramPost[]): SimpleInstagramPost[] {
  const postsWithLikes = posts.filter(p => p.likesNum !== null);
  if (postsWithLikes.length >= 3) {
    return [...posts].sort((a, b) => (b.likesNum ?? 0) - (a.likesNum ?? 0));
  }
  return posts;
}

export async function runSimpleInstagramResearch(
  question: string,
  history: string[],
  dateFrom: string | null,
  dateTo: string | null,
  datePreset: string | null,
  gemini: GeminiClient | null,
  signal?: AbortSignal
): Promise<{ message: string; meta: ResearchMeta }> {
  const config = getResearchConfig();
  const now = new Date();

  const emptyMeta: ResearchMeta = {
    status: "degraded",
    question,
    intent: "overview",
    dateRange: { from: "", to: "", label: "", timezone: "UTC", preset: null },
    previousDateRange: null,
    queries: [],
    resultsRetrieved: 0,
    resultsAfterDedupe: 0,
    resultsIncluded: 0,
    undatedExcluded: 0,
    sourceTypesSearched: [],
    providersSearched: [],
    comparisonAvailable: false,
    integrations: { gemini: { configured: false, model: "" }, serpapi: { configured: false }, newsapi: { configured: false } },
    limitations: [],
    warnings: [],
    generatedAt: new Date().toISOString(),
  };

  if (!gemini) {
    return {
      message: "AI synthesis is unavailable because GEMINI_API_KEY is not configured.",
      meta: { ...emptyMeta, limitations: ["GEMINI_API_KEY not configured"] }
    };
  }

  const serpApiKey = getSerpApiKey();
  if (!serpApiKey) {
    return {
      message: "Live retrieval is unavailable because SERPAPI_API_KEY is not configured.",
      meta: { ...emptyMeta, limitations: ["SERPAPI_API_KEY not configured"] }
    };
  }

  let entity: string | null = extractExplicitEntity(question);
  let intent: "count" | "narrative" | "show_more" | "chat" | "unclear" | "business_fit" | `business_fit:${string}` = "narrative";
  try {
    const extraction = await extractEntityWithGemini(question, history, gemini);
    entity = entity ?? extraction.entity;
    intent = extraction.intent;
  } catch (error) {
    logger.warn("Simple Instagram entity extraction failed", { error: error instanceof Error ? error.message : "unknown" });
    if (!entity) {
      return {
        message: "Which person, brand or hashtag should I look into?",
        meta: { ...emptyMeta, limitations: ["Entity extraction failed"] }
      };
    }
  }

  if (/\b(?:how many|total number|number of|post count|count of|count)\b/i.test(question)) {
    intent = "count";
  }

  if (intent === "chat") {
    const reply = await chatWithGemini(question, gemini);
    return {
      message: reply,
      meta: { ...emptyMeta, status: "ok", intent: "overview", integrations: { gemini: { configured: true, model: "gemini-1.5-flash" }, serpapi: { configured: true }, newsapi: { configured: false } } }
    };
  }

  if (!entity) {
    return {
      message: "Which person or brand should I look at?",
      meta: { ...emptyMeta, limitations: ["No entity identified"] }
    };
  }

  if (intent === "unclear") {
    intent = "narrative";
  }

  const requestedRange = resolveRequestedDateRange(question, dateFrom, dateTo, datePreset, now);
  const rangeFrom = requestedRange.from;
  const rangeTo = requestedRange.to;
  const rangeLabel = requestedRange.label;
  const keywords = extractSearchKeywords(question, entity);
  const entityVariants = extractEntitySearchVariants(question, entity);

  // Search the resolved current entity and explicit aliases without losing the date window.
  const searchResult = await searchInstagramPosts(entityVariants, keywords, requestedRange, config, signal);
  const {
    posts,
    error,
    queriesTried,
    googleEstimate,
    estimateQuery,
    estimateDateRange,
    estimateDateFilter,
    estimateNumResults,
    estimateProviderTotalResults,
    estimateProvenance,
    estimateError,
    rawOrganicResultsFetched,
    queriesAtPageLimit,
    paginationErrors,
  } = searchResult;

  if (error && googleEstimate === null) {
    logger.error("Instagram search failed", { error, entity, queries: queriesTried });
    return {
      message: "I couldn't reach Google search just now. Please try again in a minute.",
      meta: { ...emptyMeta, limitations: [error] },
    };
  }

  const allPosts = sortPostsByLikes(posts);
  let message = "";

  if (allPosts.length > 0) {
    try {
      const postsForGemini = allPosts.slice(0, 30).map((post) => ({
        title: post.title,
        account: post.account,
        date: post.dateText ?? post.googleRelativeTime ?? post.dateISO,
        likes: post.likesText,
        snippet: post.snippet,
      }));
      let analysisIntent: "count" | "narrative" | "show_more" | "chat" | "unclear" | "business_fit" | `business_fit:${string}` = intent;
      if (intent === "business_fit") {
        const businessMatch = question.match(/(?:for my|for our|for the)\s+([a-z\s]+?)(?:\s|$|\?)/i);
        const businessType = businessMatch ? businessMatch[1].trim() : "business";
        analysisIntent = `business_fit:${businessType}`;
      }
      message = await analyzeWithGemini({ posts: postsForGemini, intent: analysisIntent, entity }, gemini);
    } catch (error) {
      logger.warn("Simple Instagram Gemini analysis failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }

  const instagramResults = {
    entity,
    dateRangeLabel: rangeLabel,
    googleEstimatedResults: googleEstimate === null ? null : String(googleEstimate),
    estimateQuery,
    estimateDateRange,
    estimateDateFilter,
    estimateNumResults,
    estimateProviderTotalResults,
    estimateProvenance,
    estimateError,
    isCountRequest: intent === "count",
    posts: allPosts.map((post) => ({
      title: post.title,
      url: post.url,
      caption: post.caption,
      snippet: post.snippet,
      hashtags: post.hashtags,
      snippetHashtags: post.snippetHashtags,
      account: post.account,
      likes: post.likesText,
      comments: post.commentsText,
      postedDate: post.dateText ?? post.googleRelativeTime,
    })),
  };

  const limitations = [
    "Google result estimates are approximate, can overlap across dorks, and are not Instagram-wide post counts.",
    "Retrieved unique post candidates are limited to results Google/SerpAPI returned for these queries.",
    "Caption, engagement, owner, and date fields remain unknown unless returned; Google dates/snippets are not independently verified.",
  ];
  const warnings = [
    ...(queriesAtPageLimit.length ? [`${queriesAtPageLimit.length} dork(s) reached a requested page ceiling; more results may exist.`] : []),
    ...(paginationErrors.length ? [`SerpAPI stopped pagination early for ${paginationErrors.length} dork(s).`] : []),
  ];

  const meta: ResearchMeta = {
    status: warnings.length ? "degraded" : "ok",
    question,
    intent: "narratives",
    dateRange: { ...requestedRange },
    previousDateRange: null,
    queries: [],
    resultsRetrieved: rawOrganicResultsFetched,
    resultsAfterDedupe: allPosts.length,
    resultsIncluded: allPosts.length,
    undatedExcluded: 0,
    sourceTypesSearched: ["social"],
    providersSearched: ["serpapi"],
    comparisonAvailable: false,
    integrations: { gemini: { configured: true, model: "gemini-1.5-flash" }, serpapi: { configured: true }, newsapi: { configured: false } },
    limitations,
    warnings,
    generatedAt: new Date().toISOString(),
    instagramResults,
  };

  return { message, meta };
}

export async function runShowMorePosts(
  entity: string,
  rangeFrom: string,
  rangeTo: string,
  rangeLabel: string,
  existingPosts: SimpleInstagramPost[],
  signal?: AbortSignal
): Promise<{ message: string; allPosts: SimpleInstagramPost[] }> {
  const config = getResearchConfig();
  
  const allPosts = await fetchMorePosts(entity, rangeFrom, rangeTo, config, existingPosts, signal);
  const sortedPosts = sortPostsByLikes(allPosts);
  return { message: "Additional Instagram posts are ready to display.", allPosts: sortedPosts };
}