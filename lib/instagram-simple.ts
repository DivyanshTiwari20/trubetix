import "server-only";
import { z } from "zod";
import type { GeminiClient } from "@/lib/ai/gemini";
import { toGeminiSchema } from "@/lib/validation/gemini-schema";
import { createSerpApiProvider } from "@/lib/providers/serpapi";
import type { SerpApiOrganicResult, SerpApiSearchInformation, SerpApiSearchMetadata } from "@/lib/providers/types";
import { getSerpApiKey, getResearchConfig } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ResearchMeta } from "@/types";
import { shortcodeFromUrl, dateFromShortcode } from "@/lib/research/igDate";

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

const entityExtractionSchema = z.object({
  entity: z.string().nullable(),
  isCorrection: z.boolean(),
  intent: z.enum(["count", "narrative", "show_more", "chat", "unclear", "business_fit"]),
});

export type EntityExtractionResult = z.infer<typeof entityExtractionSchema>;

const EXTRACTION_SYSTEM_INSTRUCTION = `You are an entity extraction assistant for an Instagram research tool.

Given the last 6 USER messages of a conversation, extract the primary entity (person, brand, hashtag, event) the user wants Instagram posts for.

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

async function extractEntityWithGemini(
  userHistory: string[],
  gemini: GeminiClient
): Promise<EntityExtractionResult> {
  const lastSixUser = userHistory.slice(-6);
  const prompt = `Last 6 user messages:\n${lastSixUser.map((m, i) => `${i + 1}. ${m}`).join("\n")}`;

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

  if (!dateISO) {
    const d = dateFromShortcode(shortcode);
    if (d) {
      dateISO = d.toISOString();
      dateText = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  searchMetadata: SerpApiSearchMetadata | null;
  rawFirstPageResult: SerpApiOrganicResult | null;
  error: string | null;
  rangeUsed: { from: string; to: string; label: string } | null;
  queriesTried: string[];
}

async function searchInstagramPosts(
  entities: string[],
  rangeFrom: string,
  rangeTo: string,
  rangeLabel: string,
  config: ReturnType<typeof getResearchConfig>,
  signal?: AbortSignal
): Promise<SearchResult> {
  const serpApiKey = getSerpApiKey();
  if (!serpApiKey) {
    throw new Error("SERPAPI_API_KEY not configured");
  }

  const provider = createSerpApiProvider({
    apiKey: serpApiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  // Build date ranges to try: original, 7d, 30d, no date
  const rangesToTry: Array<{ label: string; from: string; to: string; afterText: string; beforeText: string; tbs: string }> = [];
  
  // Original range
  const tbsFrom = formatDateForTbs(rangeFrom);
  const tbsTo = formatDateForTbs(rangeTo);
  const originalTbs = `cdr:1,cd_min:${tbsFrom},cd_max:${tbsTo}`;
  const originalAfter = adjustDateForTextOp(rangeFrom, -1);
  const originalBefore = adjustDateForTextOp(rangeTo, 1);
  rangesToTry.push({
    label: rangeLabel,
    from: rangeFrom,
    to: rangeTo,
    afterText: originalAfter,
    beforeText: originalBefore,
    tbs: originalTbs
  });

  // 7 days if original is shorter than 7 days
  const originalDays = (new Date(rangeTo).getTime() - new Date(rangeFrom).getTime()) / (1000 * 60 * 60 * 24);
  if (originalDays < 7) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysFrom = sevenDaysAgo.toISOString().split("T")[0];
    const sevenDaysTo = now.toISOString().split("T")[0];
    const tbs7From = formatDateForTbs(sevenDaysFrom);
    const tbs7To = formatDateForTbs(sevenDaysTo);
    const sevenTbs = `cdr:1,cd_min:${tbs7From},cd_max:${tbs7To}`;
    const sevenAfter = adjustDateForTextOp(sevenDaysFrom, -1);
    const sevenBefore = adjustDateForTextOp(sevenDaysTo, 1);
    rangesToTry.push({
      label: "Last 7 days",
      from: sevenDaysFrom,
      to: sevenDaysTo,
      afterText: sevenAfter,
      beforeText: sevenBefore,
      tbs: sevenTbs
    });
  }

  // 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysFrom = thirtyDaysAgo.toISOString().split("T")[0];
  const thirtyDaysTo = now.toISOString().split("T")[0];
  const tbs30From = formatDateForTbs(thirtyDaysFrom);
  const tbs30To = formatDateForTbs(thirtyDaysTo);
  const thirtyTbs = `cdr:1,cd_min:${tbs30From},cd_max:${tbs30To}`;
  const thirtyAfter = adjustDateForTextOp(thirtyDaysFrom, -1);
  const thirtyBefore = adjustDateForTextOp(thirtyDaysTo, 1);
  rangesToTry.push({
    label: "Last 30 days",
    from: thirtyDaysFrom,
    to: thirtyDaysTo,
    afterText: thirtyAfter,
    beforeText: thirtyBefore,
    tbs: thirtyTbs
  });

  // No date restriction
  rangesToTry.push({
    label: "All time",
    from: "",
    to: "",
    afterText: "",
    beforeText: "",
    tbs: ""
  });

  const allPosts: SimpleInstagramPost[] = [];
  let searchInformation: SerpApiSearchInformation | null = null;
  let searchMetadata: SerpApiSearchMetadata | null = null;
  let rawFirstPageResult: SerpApiOrganicResult | null = null;
  const seenShortcodes = new Set<string>();
  const queriesTried: string[] = [];
  let lastError: string | null = null;
  let usedRange: { from: string; to: string; label: string } | null = null;

  for (const range of rangesToTry) {
    // Build query variations for each entity: exact, broad, very broad
    const queryVariations: Array<{entity: string; query: string}> = [];
    for (const entity of entities) {
      if (range.tbs) {
        queryVariations.push({ entity, query: `site:instagram.com "${entity}" after:${range.afterText} before:${range.beforeText}` });
        queryVariations.push({ entity, query: `site:instagram.com ${entity} after:${range.afterText} before:${range.beforeText}` });
        queryVariations.push({ entity, query: `${entity} instagram after:${range.afterText} before:${range.beforeText}` });
      } else {
        queryVariations.push({ entity, query: `site:instagram.com "${entity}"` });
        queryVariations.push({ entity, query: `site:instagram.com ${entity}` });
        queryVariations.push({ entity, query: `${entity} instagram` });
      }
    }

    for (const { entity, query } of queryVariations) {
      queriesTried.push(query);
      
      logger.info("Instagram simple query", { query, entity, rangeLabel: range.label });

      const firstPage = await provider.searchWithInfo?.(
        {
          query,
          numResults: config.maxResultsPerQuery,
          dateRange: { from: range.from, to: range.to, label: range.label, timezone: "UTC", preset: null },
          pages: 1,
          newsOnly: false,
        },
        { signal }
      );

      if (!firstPage) {
        lastError = "Provider does not support searchWithInfo";
        continue;
      }

      // Check for SerpAPI errors
      const serpError = (firstPage as { error?: string }).error;
      const serpStatus = firstPage.searchMetadata?.status;
      
      if (serpError && !isEmptyResultError(serpError)) {
        lastError = `SerpAPI error: ${serpError}`;
        logger.error("SerpAPI error", { error: serpError, status: serpStatus, entity, query });
        continue;
      }
      
      if (serpStatus && serpStatus !== "Success") {
        lastError = `SerpAPI status: ${serpStatus}`;
        logger.error("SerpAPI non-success status", { status: serpStatus, entity, query });
        continue;
      }

      const rawOrganicResults = firstPage.rawOrganicResults;
      if (!searchInformation) searchInformation = firstPage.searchInformation;
      if (!searchMetadata) searchMetadata = firstPage.searchMetadata;

      if (rawOrganicResults.length > 0) {
        logger.debug("Raw organic result sample", { raw: rawOrganicResults[0] });
      }

      for (const raw of rawOrganicResults) {
        if (rawFirstPageResult === null && raw.link && raw.title) {
          rawFirstPageResult = raw;
        }
        const normalized = normalizePost(raw);
        if (!normalized) continue;
        const sc = shortcodeFromUrl(normalized.url);
        if (sc && seenShortcodes.has(sc)) continue;
        if (sc) seenShortcodes.add(sc);
        allPosts.push(normalized);
      }

      if (allPosts.length > 0) {
        usedRange = { from: range.from, to: range.to, label: range.label };
        break;
      }
    }

    if (allPosts.length > 0) break;
  }

  return { 
    posts: allPosts, 
    searchInformation, 
    searchMetadata, 
    rawFirstPageResult, 
    error: lastError,
    rangeUsed: usedRange,
    queriesTried
  };
}

function isEmptyResultError(message: string): boolean {
  return /hasn'?t returned any results|did not match any documents|no results(?:\s+found)?|no search results/i.test(message.toLowerCase());
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

function formatDateDisplay(post: SimpleInstagramPost): string {
  if (post.googleRelativeTime) return post.googleRelativeTime;
  if (post.dateText) return post.dateText;
  return "—";
}

function truncateCaption(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}

function renderPostsTable(posts: SimpleInstagramPost[], startIndex: number = 0): string {
  if (posts.length === 0) return "";
  
  const headers = ["#", "Title", "Account", "Caption", "Likes", "Comments", "Date"];
  const rows = posts.map((post, i) => [
    String(startIndex + i + 1),
    `<a href="${post.url}" target="_blank" rel="noopener noreferrer" class="underline hover:text-primary">${truncateCaption(post.title, 60)}</a>`,
    post.account === "unknown" ? "—" : `@${post.account}`,
    post.snippet ? truncateCaption(post.snippet, 140) : "—",
    post.likesText ?? "—",
    post.commentsText ?? "—",
    formatDateDisplay(post),
  ]);

  let table = "<div class=\"overflow-x-auto\"><table class=\"w-full text-sm border-collapse\">";
  table += "<thead><tr class=\"border-b border-border\">";
  for (const h of headers) {
    table += `<th class="text-left p-2 font-medium text-muted-foreground">${h}</th>`;
  }
  table += "</tr></thead><tbody>";
  for (const row of rows) {
    table += "<tr class=\"border-b border-border/50\">";
    for (const cell of row) {
      table += `<td class="p-2">${cell}</td>`;
    }
    table += "</tr>";
  }
  table += "</tbody></table></div>";
  
  return table;
}

function renderLikesSummary(posts: SimpleInstagramPost[]): string | null {
  const postsWithLikes = posts.filter(p => p.likesNum !== null);
  if (postsWithLikes.length < 3) return null;
  
  const total = postsWithLikes.reduce((sum, p) => sum + (p.likesNum ?? 0), 0);
  return `<p class="mt-2 text-xs text-muted-foreground">Likes shown on these posts: ~${formatNumberWithSeparators(total)} <span class="italic">(Only posts where Google shows likes are counted.)</span></p>`;
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
  let intent: "count" | "narrative" | "show_more" | "chat" | "unclear" | "business_fit" | `business_fit:${string}` = "narrative";
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

  // Try multiple entity variations: corrected name first, then original user query
  const originalQuery = question.trim();
  const entityVariations = [entity];
  if (originalQuery.toLowerCase() !== entity.toLowerCase()) {
    entityVariations.push(originalQuery);
  }

  const searchResult = await searchInstagramPosts(entityVariations, rangeFrom, rangeTo, rangeLabel, config, signal);
  const { posts, searchInformation, error, rangeUsed, queriesTried } = searchResult;

  // Handle SerpAPI errors
  if (error) {
    logger.error("Instagram search failed", { error, entity, queries: queriesTried });
    return {
      message: "I couldn't reach Google search just now. Please try again in a minute.",
      meta: { ...emptyMeta, limitations: [error] }
    };
  }

  // Use the range that actually returned posts
  const actualRangeLabel = rangeUsed?.label ?? rangeLabel;

  let estimateLine: string | null = null;
  if (searchInformation?.total_results) {
    const total = typeof searchInformation.total_results === "string"
      ? parseInt(searchInformation.total_results, 10)
      : searchInformation.total_results;
    if (Number.isFinite(total)) {
      estimateLine = `About ${formatNumberWithSeparators(total)} results on Google for ${entity} on Instagram, ${actualRangeLabel}.`;
    }
  }

  const sortedPosts = sortPostsByLikes(posts);
  const topPosts = sortedPosts.slice(0, 5);
  const allPosts = sortedPosts;

  const lines: string[] = [];
  
  if (estimateLine) {
    lines.push(estimateLine);
  }
  
  lines.push(`Showing results for ${entity}`);
  
  // Add widening note if range was widened
  if (rangeUsed && rangeUsed.label !== rangeLabel) {
    lines.push(`Nothing found for ${rangeLabel}, so this shows ${rangeUsed.label}.`);
  }
  
  lines.push("");

  if (intent === "show_more" || question.toLowerCase().includes("show more") || question.toLowerCase().includes("more posts")) {
    lines.push(`**All ${allPosts.length} posts**`);
    lines.push("");
    
    for (let i = 0; i < allPosts.length; i += 10) {
      const pagePosts = allPosts.slice(i, i + 10);
      lines.push(renderPostsTable(pagePosts, i));
      lines.push("");
    }
  } else if (posts.length > 0) {
    let geminiAnswer: string | null = null;
    try {
      const postsForGemini = posts.slice(0, 30).map(p => ({
        title: p.title,
        account: p.account,
        date: p.dateText ?? p.googleRelativeTime ?? p.dateISO,
        likes: p.likesText,
        snippet: p.snippet,
      }));
      
      // Determine analysis intent - use template literal for business_fit to pass business type
      let analysisIntent: "count" | "narrative" | "show_more" | "chat" | "unclear" | "business_fit" | `business_fit:${string}` = intent;
      if (intent === "business_fit") {
        // Extract business type from question
        const businessMatch = question.match(/(?:for my|for our|for the)\s+([a-z\s]+?)(?:\s|$|\?)/i);
        const businessType = businessMatch ? businessMatch[1].trim() : "business";
        analysisIntent = `business_fit:${businessType}`;
      }
      
      geminiAnswer = await analyzeWithGemini({ posts: postsForGemini, intent: analysisIntent, entity }, gemini);
    } catch (error) {
      logger.warn("Simple Instagram Gemini analysis failed", { error: error instanceof Error ? error.message : "unknown" });
    }

    if (geminiAnswer) {
      lines.push(geminiAnswer);
      lines.push("");
    }

    if (topPosts.length > 0) {
      lines.push("**Top posts**");
      lines.push("");
      lines.push(renderPostsTable(topPosts));
      const likesSummary = renderLikesSummary(topPosts);
      if (likesSummary) {
        lines.push(likesSummary);
      }
      lines.push("");
    }

    if (allPosts.length > 5) {
      lines.push(`<button data-show-more="true" class="text-primary underline hover:text-primary mt-2 inline-block">Show all ${allPosts.length} posts</button>`);
    }

    lines.push("");
    
    // Different follow-up questions based on intent
    if (intent === "business_fit") {
      lines.push("Want me to check another person or look at a different date range?");
    } else {
      lines.push("Want more posts, another person, or a different date range?");
    }
  } else {
    lines.push(`I couldn't find Instagram posts for ${entity}. Could you check the spelling or give me the Instagram handle?`);
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
  lines.push(`Showing results for ${entity}`);
  lines.push("");
  lines.push(`**All ${allPosts.length} posts**`);
  lines.push("");
  
  for (let i = 0; i < sortedPosts.length; i += 10) {
    const pagePosts = sortedPosts.slice(i, i + 10);
    lines.push(renderPostsTable(pagePosts, i));
    lines.push("");
  }
  
  const message = lines.join("\n").trim();
  
  return { message, allPosts: sortedPosts };
}