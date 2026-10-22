import "server-only";
import { z } from "zod";
import type { GeminiClient } from "@/lib/ai/gemini";
import { toGeminiSchema } from "@/lib/validation/gemini-schema";
import { createSerpApiProvider } from "@/lib/providers/serpapi";
import type { SerpApiOrganicResult, SerpApiSearchInformation } from "@/lib/providers/types";
import { getSerpApiKey, getResearchConfig } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ResearchMeta, ResolvedDateRange } from "@/types";

export interface SimpleInstagramPost {
  url: string;
  title: string;
  account: string;
  dateISO: string | null;
  dateText: string | null;
  googleRelativeTime: string | null;
  likesText: string | null;
  likesNum: number | null;
  commentsText: string | null;
  commentsNum: number | null;
  snippet: string;
}

export interface SimpleInstagramResult {
  estimateLine: string | null;
  geminiAnswer: string | null;
  topPosts: string[];
  allPosts: SimpleInstagramPost[];
  entity: string;
  rangeLabel: string;
  rawSearchInfo: SerpApiSearchInformation | null;
  rawFirstOrganicResult: SerpApiOrganicResult | null;
}

const entityExtractionSchema = z.object({
  entity: z.string().nullable(),
  intent: z.enum(["count", "narrative", "show_more", "other"]),
});

export type EntityExtractionResult = z.infer<typeof entityExtractionSchema>;

const EXTRACTION_SYSTEM_INSTRUCTION = `You are an entity extraction assistant for an Instagram research tool.

Given the last 6 messages of a conversation, extract the primary entity (person, brand, hashtag, event) the user wants Instagram posts for.

IGNORE these words - they are NEVER entities: tell, tll, me, total, number, numbr, post, posts, done, don, him, her, them, insta, instagram, last, days

A pronoun (him/her/them/his) means the entity from the previous message.

Return null for entity if there is no clear subject.

Also identify the intent:
- "count" = user wants a post count/number (how many posts, total posts, count)
- "narrative" = user wants what people are saying, sentiment, reactions, narratives, buzz
- "show_more" = user explicitly wants more posts/results
- "other" = anything else

Return ONLY valid JSON matching the schema.`;

const entityExtractionGeminiSchema = toGeminiSchema(entityExtractionSchema);

async function extractEntityWithGemini(
  history: string[],
  gemini: GeminiClient
): Promise<EntityExtractionResult> {
  const lastSix = history.slice(-6);
  const prompt = `Conversation:\n${lastSix.map((m, i) => `${i + 1}. ${m}`).join("\n")}`;

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

  return parsed.data;
}

function formatNumberWithSeparators(num: number | string): string {
  const n = typeof num === "string" ? parseInt(num, 10) : num;
  if (!Number.isFinite(n)) return String(num);
  return n.toLocaleString("en-US");
}

function formatDateForTbs(dateStr: string): string {
  const date = new Date(dateStr);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${month}/${day}/${year}`;
}

function adjustDateForTextOp(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${year}-${month}-${day}`;
}

function parseLikesNum(text: string): number | null {
  const m = text.match(/([\d.,]+)\s*([KM]?)\+?\s*likes?/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  const mult = m[2]?.toUpperCase();
  if (mult === "K") return Math.round(num * 1_000);
  if (mult === "M") return Math.round(num * 1_000_000);
  return Math.round(num);
}

function parseCommentsNum(text: string): number | null {
  const m = text.match(/([\d.,]+)\s*([KM]?)\+?\s*comments?/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  const mult = m[2]?.toUpperCase();
  if (mult === "K") return Math.round(num * 1_000);
  if (mult === "M") return Math.round(num * 1_000_000);
  return Math.round(num);
}

function extractAccountFromText(title: string, snippet: string | null, displayedLink: string | null): string {
  const combined = title + " " + (snippet ?? "") + " " + (displayedLink ?? "");
  
  const parenMatch = combined.match(/\(@([A-Za-z0-9._]{1,30})\)/);
  if (parenMatch) return parenMatch[1].toLowerCase();

  const onMatch = (snippet ?? "").match(/^([A-Za-z0-9._]{1,30})\s+on\s+\d/);
  if (onMatch) return onMatch[1].toLowerCase();

  if (displayedLink) {
    const linkMatch = displayedLink.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i);
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
  return /\/p\/|\/reel\/|\/reels\/|\/tv\//i.test(url);
}

function shortcodeFromUrl(url: string): string | null {
  const match = url.match(/(?:\/p\/|\/reel\/|\/reels\/|\/tv\/)([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function normalizePost(raw: SerpApiOrganicResult): SimpleInstagramPost | null {
  if (!raw.link || !raw.title) return null;
  if (!isPostUrl(raw.link)) return null;

  const title = raw.title;
  const url = raw.link;
  const snippet = raw.snippet ?? null;
  const displayedLink = raw.displayed_link ?? null;

  const shortcode = shortcodeFromUrl(url);
  if (!shortcode) return null;

  const account = extractAccountFromText(title, snippet, displayedLink);
  const googleRelativeTime = extractGoogleRelativeTime(snippet);

  let likesText: string | null = null;
  let likesNum: number | null = null;
  let commentsText: string | null = null;
  let commentsNum: number | null = null;

  const detected = raw.rich_snippet?.top?.detected_extensions;
  if (detected) {
    for (const [key, value] of Object.entries(detected)) {
      const val = String(value);
      if (/likes?/i.test(key) && !likesText) {
        likesText = val;
        likesNum = parseLikesNum(val);
      }
      if (/comments?/i.test(key) && !commentsText) {
        commentsText = val;
        commentsNum = parseCommentsNum(val);
      }
    }
  }

  if (!likesText || !commentsText) {
    for (const ext of raw.extensions ?? []) {
      const extStr = String(ext);
      if (!likesText && /likes?/i.test(extStr)) {
        likesText = extStr;
        likesNum = parseLikesNum(extStr);
      }
      if (!commentsText && /comments?/i.test(extStr)) {
        commentsText = extStr;
        commentsNum = parseCommentsNum(extStr);
      }
    }
  }

  if ((!likesText || !commentsText) && snippet) {
    if (!likesText) {
      const likesMatch = snippet.match(/([\d.,]+\s*[KM]?\+?\s*likes?)/i);
      if (likesMatch && likesMatch[1]) {
        likesText = likesMatch[1];
        likesNum = parseLikesNum(likesText);
      }
    }
    if (!commentsText) {
      const commentsMatch = snippet.match(/([\d.,]+\s*[KM]?\+?\s*comments?)/i);
      if (commentsMatch && commentsMatch[1]) {
        commentsText = commentsMatch[1];
        commentsNum = parseCommentsNum(commentsText);
      }
    }
  }

  let dateISO: string | null = null;
  let dateText: string | null = null;

  if (raw.date) {
    const parsed = new Date(raw.date);
    if (!isNaN(parsed.getTime())) {
      dateISO = parsed.toISOString();
      dateText = parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  }

  const snippetForGemini = (snippet ?? "").replace(/\s+/g, " ").slice(0, 220);

  return {
    url,
    title,
    account,
    dateISO,
    dateText,
    googleRelativeTime,
    likesText,
    likesNum,
    commentsText,
    commentsNum,
    snippet: snippetForGemini,
  };
}

interface SearchResult {
  posts: SimpleInstagramPost[];
  searchInformation: SerpApiSearchInformation | null;
  rawFirstPageResult: SerpApiOrganicResult | null;
}

async function searchInstagramPosts(
  entity: string,
  rangeFrom: string,
  rangeTo: string,
  config: ReturnType<typeof getResearchConfig>,
  signal?: AbortSignal
): Promise<SearchResult> {
  const serpApiKey = getSerpApiKey();
  if (!serpApiKey) {
    throw new Error("SERPAPI_API_KEY not configured");
  }

  const tbsFrom = formatDateForTbs(rangeFrom);
  const tbsTo = formatDateForTbs(rangeTo);
  const tbs = `cdr:1,cd_min:${tbsFrom},cd_max:${tbsTo}`;

  const afterText = adjustDateForTextOp(rangeFrom, -1);
  const beforeText = adjustDateForTextOp(rangeTo, 1);

  const query = `site:instagram.com "${entity}" after:${afterText} before:${beforeText}`;

  logger.info("Instagram simple query", { query, tbs, entity, rangeFrom, rangeTo });

  const provider = createSerpApiProvider({
    apiKey: serpApiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  const firstPage = await provider.searchWithInfo?.(
    {
      query,
      numResults: config.maxResultsPerQuery,
      dateRange: { from: rangeFrom, to: rangeTo, label: "", timezone: "UTC", preset: null },
      pages: 1,
      newsOnly: false,
    },
    { signal }
  );

  if (!firstPage) {
    throw new Error("Provider does not support searchWithInfo");
  }

  const rawOrganicResults = firstPage.rawOrganicResults;
  const searchInformation = firstPage.searchInformation;

  const posts: SimpleInstagramPost[] = [];
  const seenShortcodes = new Set<string>();
  let rawFirstPageResult: SerpApiOrganicResult | null = null;

  for (const raw of rawOrganicResults) {
    if (rawFirstPageResult === null && raw.link && raw.title) {
      rawFirstPageResult = raw;
    }
    const normalized = normalizePost(raw);
    if (!normalized) continue;
    const sc = shortcodeFromUrl(normalized.url);
    if (sc && seenShortcodes.has(sc)) continue;
    if (sc) seenShortcodes.add(sc);
    posts.push(normalized);
  }

  return { posts, searchInformation, rawFirstPageResult };
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

  const query = `site:instagram.com "${entity}" after:${afterText} before:${beforeText}`;

  const provider = createSerpApiProvider({
    apiKey: serpApiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  const seenShortcodes = new Set(existingPosts.map(p => shortcodeFromUrl(p.url)).filter(Boolean) as string[]);
  const allPosts = [...existingPosts];
  let searchesUsed = 1;

  for (let page = 2; page <= 10 && searchesUsed < 12; page += 1) {

    const additionalResult = await provider.searchWithInfo?.(
      {
        query,
        numResults: config.maxResultsPerQuery,
        dateRange: { from: rangeFrom, to: rangeTo, label: "", timezone: "UTC", preset: null },
        pages: 1,
        newsOnly: false,
      },
      { signal }
    );

    if (!additionalResult || additionalResult.rawOrganicResults.length === 0) {
      break;
    }

    searchesUsed += 1;

    for (const raw of additionalResult.rawOrganicResults) {
      const normalized = normalizePost(raw);
      if (!normalized) continue;
      const sc = shortcodeFromUrl(normalized.url);
      if (sc && seenShortcodes.has(sc)) continue;
      if (sc) seenShortcodes.add(sc);
      allPosts.push(normalized);
    }
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
  intent: "count" | "narrative" | "show_more" | "other";
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

  let systemInstruction = "";
  if (input.intent === "count") {
    systemInstruction = `You are a PR intelligence analyst. The user wants to know about Instagram posts for "${input.entity}".
    
    Write EXACTLY ONE sentence summarizing the key themes or activity. Do NOT give or compute any post counts. Do NOT repeat any estimate numbers.
    Themes as short bullets. Attribute claims. Use "reported" for allegations.
    Max 1 sentence.`;
  } else if (input.intent === "narrative") {
    systemInstruction = `You are a PR intelligence analyst. The user wants to know what people are saying on Instagram about "${input.entity}".
    
    Write a short answer (max 8 sentences). Themes as short bullets. Attribute claims. Use "reported" for allegations.
    Do NOT give or compute any post counts. Do NOT repeat any estimate numbers.`;
  } else {
    systemInstruction = `You are a PR intelligence analyst. Provide a brief answer about Instagram posts for "${input.entity}".
    
    Do NOT give or compute any post counts. Do NOT repeat any estimate numbers.`;
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

function sortPostsByLikes(posts: SimpleInstagramPost[]): SimpleInstagramPost[] {
  const postsWithLikes = posts.filter(p => p.likesNum !== null);
  if (postsWithLikes.length >= 3) {
    return [...posts].sort((a, b) => (b.likesNum ?? 0) - (a.likesNum ?? 0));
  }
  return posts;
}

function formatPostCard(post: SimpleInstagramPost): string {
  const lines: string[] = [];
  
  lines.push(`**${post.title}**`);
  
  const metaParts: string[] = [];
  metaParts.push("Instagram");
  metaParts.push(`· ${post.account}`);
  if (post.dateText) metaParts.push(post.dateText);
  if (post.googleRelativeTime) metaParts.push(post.googleRelativeTime);
  lines.push(metaParts.join(" · "));
  
  if (post.likesText) lines.push(post.likesText);
  if (post.commentsText) lines.push(post.commentsText);
  
  if (post.snippet) lines.push(post.snippet);
  
  lines.push(post.url);
  
  return lines.join("\n");
}

export interface SimpleInstagramResult {
  estimateLine: string | null;
  geminiAnswer: string | null;
  topPosts: string[];
  allPosts: SimpleInstagramPost[];
  entity: string;
  rangeLabel: string;
  rawSearchInfo: SerpApiSearchInformation | null;
  rawFirstOrganicResult: SerpApiOrganicResult | null;
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

  let entity: string | null = null;
  let intent: "count" | "narrative" | "show_more" | "other" = "other";

  try {
    const extraction = await extractEntityWithGemini(history, gemini);
    entity = extraction.entity;
    intent = extraction.intent;
  } catch (error) {
    logger.warn("Simple Instagram entity extraction failed", { error: error instanceof Error ? error.message : "unknown" });
    return {
      message: "Which person, brand or hashtag should I look into?",
      meta: { ...emptyMeta, limitations: ["Entity extraction failed"] }
    };
  }

  if (!entity) {
    return {
      message: "Which person, brand or hashtag should I look into?",
      meta: { ...emptyMeta, limitations: ["No entity identified"] }
    };
  }

  let rangeFrom: string;
  let rangeTo: string;
  let rangeLabel: string;

  if (dateFrom && dateTo) {
    rangeFrom = dateFrom;
    rangeTo = dateTo;
    rangeLabel = `${new Date(rangeFrom).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${new Date(rangeTo).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  } else {
    const preset = datePreset ?? "last_7_days";
const { resolveDateRangeApp } = await import("@/lib/research/dateRange");
  const resolved = resolveDateRangeApp({ preset: preset as "24h" | "7d" | "30d" | "90d" | "custom" }, now);
    rangeFrom = resolved.from;
    rangeTo = resolved.to;
    rangeLabel = resolved.label;
  }

  const searchResult = await searchInstagramPosts(entity, rangeFrom, rangeTo, config, signal);
  const { posts, searchInformation, rawFirstPageResult } = searchResult;

  let estimateLine: string | null = null;
  if (searchInformation?.total_results) {
    const total = typeof searchInformation.total_results === "string" 
      ? parseInt(searchInformation.total_results, 10) 
      : searchInformation.total_results;
    if (Number.isFinite(total)) {
      estimateLine = `About ${formatNumberWithSeparators(total)} results on Google for ${entity} on Instagram, ${rangeLabel}.`;
    }
  }

  let geminiAnswer: string | null = null;
  if (posts.length > 0) {
    const postsForGemini = posts.slice(0, 30).map(p => ({
      title: p.title,
      account: p.account,
      date: p.dateText ?? p.googleRelativeTime ?? p.dateISO,
      likes: p.likesText,
      snippet: p.snippet,
    }));
    try {
      geminiAnswer = await analyzeWithGemini({ posts: postsForGemini, intent, entity }, gemini);
    } catch (error) {
      logger.warn("Simple Instagram Gemini analysis failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }

  const sortedPosts = sortPostsByLikes(posts);
  const topPosts = sortedPosts.slice(0, 5).map(formatPostCard);
  const allPosts = sortedPosts;

  const lines: string[] = [];
  
  if (estimateLine) {
    lines.push(estimateLine);
    lines.push("*Google's own estimate, not an exact post count.*");
    lines.push("");
  }
  
  if (geminiAnswer) {
    lines.push(geminiAnswer);
    lines.push("");
  }
  
  if (topPosts.length > 0) {
    lines.push("**Top posts**");
    lines.push("");
    lines.push(topPosts.join("\n\n"));
    lines.push("");
  }
  
  if (allPosts.length > 5) {
    lines.push(`[Show more posts] — ${allPosts.length} total posts available`);
  }

  const message = lines.join("\n").trim();

  const limitations = [
    "Search results are a sample of Google-indexed Instagram content, not a measure of total activity.",
    "Engagement metrics shown only when the retrieved page supplied them; missing counts are unknown, not zero.",
    "Dates are for display only; no date-based filtering or dropping was applied."
  ];

  const meta: ResearchMeta = {
    status: "ok",
    question,
    intent: "narratives",
    dateRange: { from: rangeFrom, to: rangeTo, label: rangeLabel, timezone: "UTC", preset: null },
    previousDateRange: null,
    queries: [`site:instagram.com "${entity}"`],
    resultsRetrieved: allPosts.length,
    resultsAfterDedupe: allPosts.length,
    resultsIncluded: allPosts.length,
    undatedExcluded: 0,
    sourceTypesSearched: ["social"],
    providersSearched: ["serpapi"],
    comparisonAvailable: false,
    integrations: { gemini: { configured: true, model: "gemini-1.5-flash" }, serpapi: { configured: true }, newsapi: { configured: false } },
    limitations,
    warnings: [],
    generatedAt: new Date().toISOString(),
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
  
  const lines: string[] = [];
  lines.push(`**Show all ${allPosts.length} posts**`);
  lines.push("");
  
  for (let i = 0; i < sortedPosts.length; i += 10) {
    const pagePosts = sortedPosts.slice(i, i + 10);
    lines.push(`--- Page ${Math.floor(i / 10) + 1} ---`);
    lines.push("");
    lines.push(pagePosts.map(formatPostCard).join("\n\n"));
    lines.push("");
  }
  
  const message = lines.join("\n").trim();
  
  return { message, allPosts: sortedPosts };
}