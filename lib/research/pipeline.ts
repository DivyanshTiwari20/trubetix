import { AnalysisError, analyzeWithGemini } from "@/lib/ai/analyze";
import type { GeminiClient } from "@/lib/ai/gemini";
import { isAbortError } from "@/lib/http";
import { logger } from "@/lib/logger";
import type {
  InstagramProfileProvider,
  RawProviderResult,
  SearchProvider,
  SerpApiOrganicResult,
  SerpApiSearchInformation,
} from "@/lib/providers/types";
import { isDefined, unique } from "@/lib/utils";
import type {
  IntegrationStatus,
  PRAnalysis,
  ResearchMeta,
  ResearchResult,
  ResolvedDateRange,
} from "@/types";
import {
  previousPeriod,
  resolveDateRange,
  filterByDate,
  isWithinRange,
  type DateRangePreset,
} from "./dates";
import {
  resolveDateRangeApp,
  isWithinRangeApp,
  filterByDateApp,
  type ResolvedDateRangeApp,
  type DateFilterResultApp,
} from "./dateRange";
import { dedupeResults } from "./dedupe";
import type { ResearchIntentKind, ResearchMode, SocialPlatform } from "./entities";
import { buildEvidence, validateAnalysisSources } from "./evidence";
import {
  buildSocialDiscoveryQueries,
  instagramProfileToRawResult,
  filterInstagramPosts,
  NormalizedInstagramPost,
} from "./instagram";
import { normalizeProviderResults } from "./normalize";
import { buildResearchPlan } from "./plan";
import { filterByRelevance } from "./relevance";
import { filterSocialResults, isRelevantSocialResult, rankSocialResults } from "./social-filter";
import { buildAssistantText } from "./summarize";
import { shortcodeFromUrl } from "./igDate";
import { extractEntitiesWithGeminiWithRetry, validateEntity } from "./gemini-entities";

function mapDateSource(source: NormalizedInstagramPost["dateSource"]): "shortcode" | "snippet" | "provider" | undefined {
  switch (source) {
    case "shortcode":
    case "snippet":
      return source;
    case "serpapi_date":
    case "relative":
      return "provider";
    default:
      return undefined;
  }
}

export interface ResearchConfig {
  maxQueries: number;
  maxResultsPerQuery: number;
  maxEvidence: number;
  maxInstagramQueries?: number;
  maxInstagramProfiles?: number;
  maxGooglePages?: number;
  maxSerpApiSearches?: number;
  temperature: number;
  strictDateFilter: boolean;
}

export interface ResearchInput {
  question: string;
  datePreset?: DateRangePreset;
  dateFrom?: string;
  dateTo?: string;
  /** Prior conversation turns, oldest first, used to resolve "the film" etc. */
  history?: string[];
}

export interface ResearchDeps {
  providers: SearchProvider[];
  gemini: GeminiClient | null;
  config: ResearchConfig;
  integrations: IntegrationStatus;
  instagram?: InstagramProfileProvider | null;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface ResearchOutcome {
  status: "ok" | "degraded";
  analysis: PRAnalysis | null;
  sources: ResearchResult[];
  meta: ResearchMeta;
  message: string;
}

interface RetrieveOutcome {
  evidence: ResearchResult[];
  /** Relevance-filtered results before date filtering, used for social discovery. */
  discovery: ResearchResult[];
  retrieved: number;
  afterDedupe: number;
  included: number;
  undated: number;
  errors: string[];
}

interface SocialRetrieval {
  evidence: ResearchResult[];
  usernames: string[];
  instagramUsed: boolean;
  retrieved: number;
  afterDedupe: number;
  dated: number;
  undated: number;
  outOfRange: number;
  queriesRun: number;
  errors: string[];
  postCount: number;
  postsPerDay: Record<string, number>;
}

const MAX_PREVIOUS_QUERIES = 2;
const MAX_SOCIAL_EVIDENCE = 30;
const MAX_CONTEXT_EVIDENCE = 4;
const FIRST_WAVE_QUERIES = 3;
const MIN_RELEVANT_BEFORE_EXPANSION = 3;

function emptySocial(): SocialRetrieval {
  return {
    evidence: [],
    usernames: [],
    instagramUsed: false,
    retrieved: 0,
    afterDedupe: 0,
    dated: 0,
    undated: 0,
    outOfRange: 0,
    queriesRun: 0,
    errors: [],
    postCount: 0,
    postsPerDay: {},
  };
}

function computePostCount(
  results: ResearchResult[],
  range: ResolvedDateRangeApp,
): { postCount: number; postsPerDay: Record<string, number>; uniqueByShortcode: ResearchResult[] } {
  const seenShortcodes = new Set<string>();
  const uniqueByShortcode: ResearchResult[] = [];
  const postsPerDay: Record<string, number> = {};

  for (const result of results) {
    const sc = result.originalUrl ? shortcodeFromUrl(result.originalUrl) : null;
    if (sc && seenShortcodes.has(sc)) continue;
    if (sc) seenShortcodes.add(sc);

    uniqueByShortcode.push(result);

    if (result.publishedAt) {
      const day = new Date(result.publishedAt).toISOString().slice(0, 10);
      postsPerDay[day] = (postsPerDay[day] || 0) + 1;
    }
  }

  return { postCount: uniqueByShortcode.length, postsPerDay, uniqueByShortcode };
}

async function runQueries(
  queries: string[],
  providers: SearchProvider[],
  dateRange: ResolvedDateRangeApp,
  config: ResearchConfig,
  pages: number,
  signal?: AbortSignal,
  searchCounter?: { count: number },
): Promise<{ raw: RawProviderResult[]; errors: string[]; searchesUsed: number }> {
  const raw: RawProviderResult[] = [];
  const errors: string[] = [];
  let searchesUsed = 0;

  const maxSearches = config.maxSerpApiSearches ?? 15;
  const tasks: Array<Promise<void>> = [];
  for (const query of queries) {
    for (const provider of providers) {
      if (searchCounter && searchCounter.count >= maxSearches) break;
      tasks.push(
        (async () => {
          try {
            if (searchCounter) searchCounter.count += 1;
            searchesUsed += 1;
            const results = await provider.search(
              {
                query,
                numResults: config.maxResultsPerQuery,
                dateRange,
                pages,
              },
              { signal },
            );
            raw.push(...results.map((result) => ({ ...result, queryUsed: query })));
          } catch (error) {
            if (isAbortError(error)) throw error;
            const message = error instanceof Error ? error.message : "unknown error";
            errors.push(`${provider.label}: ${message}`);
            logger.warn("Search provider failed", { provider: provider.id, query, message });
          }
        })(),
      );
    }
    if (searchCounter && searchCounter.count >= maxSearches) break;
  }

  await Promise.all(tasks);
  return { raw, errors, searchesUsed };
}

async function retrieve(
  plan: { queries: string[]; entities: string[]; keywords: string[] },
  providers: SearchProvider[],
  dateRange: ResolvedDateRangeApp,
  config: ResearchConfig,
  now: Date,
  signal?: AbortSignal,
): Promise<RetrieveOutcome> {
  const { raw, errors } = await runQueries(plan.queries, providers, dateRange, config, 1, signal, undefined);
  const retrievedAt = now.toISOString();

  const normalized = normalizeProviderResults(raw, {
    queryUsed: "",
    entities: plan.entities,
    retrievedAt,
    now,
  }).map((result) => ({ ...result }));

  for (const result of normalized) {
    if (!result.queryUsed) result.queryUsed = plan.queries[0] ?? "";
  }

  const deduped = dedupeResults(normalized);
  const relevant = filterByRelevance(deduped.unique, {
    entities: plan.entities,
    keywords: plan.keywords,
  });
  const dated = filterByDateApp(relevant.relevant, dateRange);

  return {
    evidence: dated.included,
    discovery: relevant.relevant,
    retrieved: normalized.length,
    afterDedupe: deduped.unique.length,
    included: dated.included.length,
    undated: dated.undated.length,
    errors,
  };
}

interface SocialCriteria {
  entities: string[];
  keywords: string[];
  platform: SocialPlatform | null;
  instagramOnly: boolean;
  postsOnly: boolean;
}

/**
 * Runs social discovery dorks and turns the results themselves into evidence.
 *
 * New simplified workflow for Instagram/social questions:
 * 1. Run ONE Google dork via SerpAPI with date operators in query + tbs
 * 2. Read search_information.total_results from page 1
 * 3. Keep EVERY organic result whose URL contains /p/, /reel/, /reels/ or /tv/
 * 4. Dedupe by shortcode
 * 5. Only drop: non-post URLs, duplicates, posts >1 day outside range (if STRICT_DATE_FILTER)
 * 6. Keep undated posts
 * 7. Log raw/kept/drops with reasons
 * 8. Fetch more pages (up to ~10 pages / 12 searches) for "Show more posts"
 */
async function retrieveSocialEvidence(args: {
  mode: ResearchMode;
  intentKind: ResearchIntentKind;
  discoveryQueries: string[];
  handles: string[];
  criteria: SocialCriteria;
  providers: SearchProvider[];
  instagram: InstagramProfileProvider | null;
  dateRange: ResolvedDateRange;
  config: ResearchConfig;
  now: Date;
  signal?: AbortSignal;
}): Promise<SocialRetrieval> {
  const out = emptySocial();
  const webProviders = args.providers.filter((provider) =>
    (provider.capabilities ?? ["web"]).includes("web"),
  );
  if (args.discoveryQueries.length === 0 || webProviders.length === 0) {
    logger.debug("No social discovery queries or web providers", { discoveryQueries: args.discoveryQueries.length, webProviders: webProviders.length });
    return out;
  }

  // Use only the first (and only) query
  const query = args.discoveryQueries[0]!;
  const provider = webProviders[0]; // SerpAPI is the only web provider with searchWithInfo

  // Log the exact query and range
  logger.info("Instagram social query", {
    query,
    rangeFrom: args.dateRange.from,
    rangeTo: args.dateRange.to,
    rangeLabel: (args.dateRange as ResolvedDateRangeApp).label,
  });

  // Fetch first page with searchWithInfo to get search_information and raw organic results
  const searchResult = await provider.searchWithInfo?.(
    {
      query,
      numResults: args.config.maxResultsPerQuery,
      dateRange: args.dateRange,
      pages: 1,
      newsOnly: false,
    },
    { signal: args.signal }
  );

  if (!searchResult) {
    logger.warn("Provider does not support searchWithInfo", { provider: provider.id });
    return out;
  }

  out.queriesRun = 1;
  out.errors.push(...(searchResult.results.map(r => r.queryUsed).filter(Boolean) as string[])); // No errors from searchWithInfo directly

  const searchInfo = searchResult.searchInformation;
  const rawOrganicResults = searchResult.rawOrganicResults;

  // Log search_information.total_results
  if (searchInfo?.total_results) {
    logger.info("Google search estimate", {
      totalResults: searchInfo.total_results,
      queryDisplayed: searchInfo.query_displayed,
    });
  }

  // Filter Instagram posts using simplified rules
  const filterResult = filterInstagramPosts(
    rawOrganicResults,
    args.dateRange.from,
    args.dateRange.to,
    args.config.strictDateFilter
  );

  // Log drops
  logger.info("Instagram post filter result", {
    rawCount: filterResult.rawCount,
    keptCount: filterResult.keptCount,
    dropped: filterResult.dropped,
    firstRawResults: filterResult.firstRawResults,
  });

  // Convert normalized posts to ResearchResult evidence
  const normalizedPosts: ResearchResult[] = filterResult.posts.map((post) => ({
    title: post.title,
    canonicalUrl: post.url,
    originalUrl: post.url,
    sourceName: `Instagram · ${post.account}`,
    sourceType: "social" as const,
    platform: "instagram" as const,
    publishedAt: post.dateISO,
    retrievedAt: args.now.toISOString(),
    contentSnippet: post.snippet,
    matchedEntities: args.criteria.entities.filter((entity) =>
      (post.title + " " + post.snippet).toLowerCase().includes(entity.toLowerCase())
    ),
    queryUsed: query,
    relatedUrls: [],
    likes: post.likesNum ?? undefined,
    comments: post.commentsNum ?? undefined,
    username: post.account,
    cleanedCaption: post.snippet,
    dateSource: mapDateSource(post.dateSource),
  }));

  out.retrieved = filterResult.rawCount;
  out.afterDedupe = filterResult.keptCount;
  out.dated = filterResult.posts.filter(p => p.dateISO).length;
  out.undated = filterResult.posts.filter(p => !p.dateISO).length;
  out.outOfRange = filterResult.dropped.outsideRange;

  // Compute post count from filtered posts
  const { postCount, postsPerDay, uniqueByShortcode } = computePostCount(
    normalizedPosts,
    args.dateRange as ResolvedDateRangeApp
  );
  out.postCount = postCount;
  out.postsPerDay = postsPerDay;

  // Use filtered posts as evidence (up to MAX_SOCIAL_EVIDENCE)
  out.evidence = uniqueByShortcode.slice(0, MAX_SOCIAL_EVIDENCE);

  // Fetch additional pages for "Show more posts" (up to 10 pages / 12 searches)
  // This is a best-effort background fetch to populate more posts
  const maxAdditionalPages = 9; // Already fetched page 1, so 9 more = 10 total
  const maxAdditionalSearches = 11; // Already used 1 search
  let searchesUsed = 1;
  let allRawOrganicResults = [...rawOrganicResults];

  for (let page = 2; page <= maxAdditionalPages && searchesUsed < maxAdditionalSearches; page += 1) {
    const additionalResult = await provider.searchWithInfo?.(
      {
        query,
        numResults: args.config.maxResultsPerQuery,
        dateRange: args.dateRange,
        pages: 1,
        newsOnly: false,
      },
      { signal: args.signal }
    );

    if (!additionalResult || additionalResult.rawOrganicResults.length === 0) {
      break;
    }

    searchesUsed += 1;
    allRawOrganicResults = [...allRawOrganicResults, ...additionalResult.rawOrganicResults];

    // Re-filter with accumulated results
    const additionalFilterResult = filterInstagramPosts(
      allRawOrganicResults,
      args.dateRange.from,
      args.dateRange.to,
      args.config.strictDateFilter
    );

    // Update evidence with more posts
    const additionalNormalizedPosts: ResearchResult[] = additionalFilterResult.posts.map((post) => ({
      title: post.title,
      canonicalUrl: post.url,
      originalUrl: post.url,
      sourceName: `Instagram · ${post.account}`,
      sourceType: "social" as const,
      platform: "instagram" as const,
      publishedAt: post.dateISO,
      retrievedAt: args.now.toISOString(),
      contentSnippet: post.snippet,
      matchedEntities: args.criteria.entities.filter((entity) =>
        (post.title + " " + post.snippet).toLowerCase().includes(entity.toLowerCase())
      ),
      queryUsed: query,
      relatedUrls: [],
      likes: post.likesNum ?? undefined,
      comments: post.commentsNum ?? undefined,
      username: post.account,
      cleanedCaption: post.snippet,
      dateSource: mapDateSource(post.dateSource),
    }));

    const { uniqueByShortcode: allUniqueByShortcode } = computePostCount(
      additionalNormalizedPosts,
      args.dateRange as ResolvedDateRangeApp
    );

    out.evidence = allUniqueByShortcode.slice(0, MAX_SOCIAL_EVIDENCE);
    out.postCount = additionalFilterResult.keptCount;

    if (additionalFilterResult.posts.length === filterResult.posts.length) {
      // No new posts found, stop pagination
      break;
    }
  }

  if (args.mode !== "profile" || !args.instagram) return out;

  const maxProfiles = args.config.maxInstagramProfiles ?? 0;
  if (maxProfiles <= 0) return out;

  const usernames = unique(args.handles).slice(0, maxProfiles);
  out.usernames = usernames;
  if (usernames.length === 0) return out;

  out.instagramUsed = true;
  const profiles = await Promise.all(
    usernames.map(async (username) => {
      try {
        return await args.instagram!.fetchProfile(username, { signal: args.signal });
      } catch (error) {
        if (isAbortError(error)) throw error;
        const message = error instanceof Error ? error.message : "unknown error";
        out.errors.push(`Instagram (@${username}): ${message}`);
        logger.warn("Instagram profile failed", { username, message });
        return null;
      }
    }),
  );

  const profileRaws = profiles.filter(isDefined).map(instagramProfileToRawResult);
  const profileEvidence = normalizeProviderResults(profileRaws, {
    queryUsed: args.discoveryQueries[0] ?? "",
    entities: args.criteria.entities,
    retrievedAt: args.now.toISOString(),
    now: args.now,
  }).filter((result) =>
    isRelevantSocialResult(result, { ...args.criteria, postsOnly: false }),
  );

  out.evidence = dedupeResults([...out.evidence, ...profileEvidence]).unique;
  return out;
}

/**
 * Picks the final evidence set. In social/profile mode only relevant social
 * results are used. In general mode social results are interleaved with a
 * capped share so they cannot dominate.
 */
function selectEvidence(
  combined: ResearchResult[],
  maxEvidence: number,
  mode: ResearchMode,
): ResearchResult[] {
  const social = combined.filter((result) => result.sourceType === "social");
  const general = combined.filter((result) => result.sourceType !== "social");
  if (social.length === 0) return buildEvidence(combined, maxEvidence);

  if (mode === "general") {
    const quota = Math.min(social.length, MAX_SOCIAL_EVIDENCE, Math.floor(maxEvidence / 2));
    return [...general.slice(0, Math.max(0, maxEvidence - quota)), ...social.slice(0, quota)];
  }

  const contextQuota =
    general.length > 0
      ? Math.min(general.length, MAX_CONTEXT_EVIDENCE, Math.max(1, Math.floor(maxEvidence / 4)))
      : 0;
  const socialQuota = Math.min(social.length, Math.max(0, maxEvidence - contextQuota));
  return [...social.slice(0, socialQuota), ...general.slice(0, contextQuota)];
}

function buildLimitations(args: {
  integrations: IntegrationStatus;
  providers: SearchProvider[];
  mode: ResearchMode;
  platform: SocialPlatform | null;
  unsupportedPlatform: SocialPlatform | null;
  undatedExcluded: number;
  socialDated: number;
  socialUndated: number;
  socialIncluded: boolean;
  socialQueriesRun: number;
  profileRequested: boolean;
  profileAvailable: boolean;
  comparisonRequested: boolean;
  comparisonAvailable: boolean;
  providerErrors: string[];
}): string[] {
  const limitations: string[] = [
    "Search results are a sample of indexed coverage, not a measure of total media or social activity.",
  ];
  if (args.providers.length === 0) {
    limitations.push(
      "Live search is unavailable because it is not configured in this workspace.",
    );
  }
  if (!args.integrations.gemini.configured) {
    limitations.push("AI analysis is unavailable because it is not configured in this workspace.");
  }
  if (args.undatedExcluded > 0) {
    limitations.push(
      `${args.undatedExcluded} retrieved news/web result(s) had no reliable publication date and were excluded from the time window.`,
    );
  }
  if (args.mode !== "general") {
    if (args.socialIncluded) {
      limitations.push(
        "Instagram results are a sampled view of public content found in this search. Captions, counts and dates may be incomplete or stale and are not comprehensive Instagram analytics.",
      );
      limitations.push(
        "Engagement metrics are shown only when the retrieved page supplied them; missing counts are unknown, not zero.",
      );
    } else {
      limitations.push(
        "No relevant Instagram posts or Reels were found for this subject, so unrelated news or profiles were not substituted for social analysis.",
      );
    }
    if (args.socialQueriesRun === 0) {
      limitations.push("No social discovery queries were run for this request.");
    }
    if (args.socialUndated > 0) {
      limitations.push(
        `${args.socialUndated} social result(s) had no reliable timestamp and could not be strictly placed in the requested window.`,
      );
    }
    if (args.platform === null && args.socialIncluded) {
      limitations.push(
        "No platform was named, so discovery was limited to Instagram.",
      );
    }
    if (args.unsupportedPlatform) {
      limitations.push(
        `Social research currently supports Instagram only; results for ${args.unsupportedPlatform} were not retrieved.`,
      );
    }
    if (args.profileRequested && !args.profileAvailable) {
      limitations.push(
        "Instagram profile data is unavailable because profile search is not configured in this workspace.",
      );
    }
  }
  if (args.comparisonRequested && !args.comparisonAvailable) {
    limitations.push(
      "A previous comparison window was researched but returned no usable dated coverage; change over time cannot be established reliably.",
    );
  }
  if (args.providerErrors.length > 0) {
    limitations.push(
      "Some searches could not complete, so coverage may be missing.",
    );
  }
  return limitations;
}

function degradedMessage(args: {
  integrations: IntegrationStatus;
  providerCount: number;
  sourceCount: number;
}): string {
  const lines: string[] = ["Unable to produce a full research briefing."];
  if (args.providerCount === 0) {
    lines.push(
      "Live search is not configured in this workspace, so there is no evidence to analyse yet.",
    );
  } else if (args.sourceCount === 0) {
    lines.push(
      "No relevant dated coverage was found in the requested window, so there is no evidence to analyse.",
    );
  }
  if (!args.integrations.gemini.configured) {
    lines.push(
      "AI analysis is not configured, so narrative analysis and recommendations are unavailable.",
    );
  }
  lines.push(
    "Tubitex does not invent sources or findings, so this response is intentionally limited until the missing integrations are configured.",
  );
  return lines.join(" ");
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  twitter: "Twitter/X",
  tiktok: "TikTok",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  threads: "Threads",
};

function noSocialMessage(args: {
  subject: string;
  discoveryQueries: string[];
  platform: SocialPlatform | null;
  geminiConfigured: boolean;
}): string {
  const platformLabel = args.platform ? PLATFORM_LABELS[args.platform] : "Instagram";
  const lines = [
    `No relevant ${platformLabel} posts or Reels were found for "${args.subject}" in the requested window.`,
    args.discoveryQueries.length > 0
      ? `Tubitex checked ${args.discoveryQueries.length} targeted angles and rejected results that did not mention the subject or contained no usable post content.`
      : "Tubitex could not check social coverage for this request.",
    "It does not substitute unrelated news articles, Facebook pages or Instagram profiles for social media analysis.",
    "Try widening the time window, naming a specific account or hashtag, or asking about a more active subject.",
  ];
  if (!args.geminiConfigured) {
    lines.push("AI analysis is also unavailable because it is not configured in this workspace.");
  }
  return lines.join(" ");
}

export async function runResearch(
  input: ResearchInput,
  deps: ResearchDeps,
): Promise<ResearchOutcome> {
  const requestId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  logger.info("runResearch started", { requestId, questionLength: input.question.length, mode: "unknown" });

  const now = deps.now?.() ?? new Date();

  let geminiEntity: string | null = null;
  let geminiPlatform: SocialPlatform | null = null;
  let geminiDays: number | null = null;
  let geminiIntent: "volume" | "reaction" | "overview" | "show_more" | "other" | undefined = undefined;
  let geminiMentionedEntities: string[] = [];

  if (deps.gemini) {
    try {
      const extraction = await extractEntitiesWithGeminiWithRetry(input.question, deps.gemini, 1);
      geminiEntity = extraction.primaryEntity;
      geminiMentionedEntities = extraction.mentionedEntities;
      geminiPlatform = extraction.platform as SocialPlatform | null;
      geminiDays = extraction.days;
      geminiIntent = extraction.intent;
      logger.info("Gemini entity extraction", {
        requestId,
        primaryEntity: geminiEntity,
        mentionedEntities: geminiMentionedEntities,
        platform: geminiPlatform,
        days: geminiDays,
        intent: geminiIntent,
      });
    } catch (error) {
      logger.warn("Gemini entity extraction failed, falling back to heuristic", {
        requestId,
        error: error instanceof Error ? error.message : "unknown",
      });
      geminiEntity = null;
      geminiMentionedEntities = [];
      geminiPlatform = null;
      geminiDays = null;
      geminiIntent = undefined;
    }
  }

  const plan = buildResearchPlan({
    question: input.question,
    datePreset: input.datePreset,
    maxQueries: deps.config.maxQueries,
    history: input.history,
    geminiEntity,
    geminiMentionedEntities,
    geminiPlatform,
    geminiDays,
    geminiIntent,
  });

  logger.info("Research plan built", { requestId, intent: plan.intent, mode: plan.mode, entities: plan.entities, subject: plan.subject, queries: plan.queries.length, queriesList: plan.queries });

  const dateRange: ResolvedDateRangeApp =
    input.dateFrom || input.dateTo
      ? resolveDateRangeApp({ preset: "custom", from: input.dateFrom, to: input.dateTo }, now)
      : resolveDateRangeApp({ preset: plan.datePreset }, now);

  const comparisonRequested = plan.intent === "change" && plan.mode === "general";
  const previousDateRange = comparisonRequested ? previousPeriod(dateRange) : null;

  const providers = deps.providers.filter((provider) => provider.isConfigured());
  const providerErrors: string[] = [];

  const mode = plan.mode;
  const unsupportedPlatform =
    mode !== "general" && plan.platform !== null && plan.platform !== "instagram"
      ? plan.platform
      : null;
  const socialOnly = mode !== "general";
  const instagramOnly = unsupportedPlatform === null;

  const baseMeta = {
    question: input.question,
    intent: plan.intent,
    intentKind: plan.intentKind,
    dateRange,
    previousDateRange,
    queries: [] as string[],
    resultsRetrieved: 0,
    resultsAfterDedupe: 0,
    resultsIncluded: 0,
    undatedExcluded: 0,
    sourceTypesSearched: [] as ResearchMeta["sourceTypesSearched"],
    providersSearched: providers.map((provider) => provider.id),
    comparisonAvailable: false,
    integrations: deps.integrations,
    generatedAt: now.toISOString(),
  };

  if (plan.needsClarification) {
    const message =
      plan.clarification ??
      "Which person, brand or hashtag should I look into?";
    const meta: ResearchMeta = {
      ...baseMeta,
      status: "degraded",
      limitations: [
        "No research was run because the request did not identify a subject.",
        "Tubitex does not run generic searches on intent words such as 'numbers' or 'buzz'.",
      ],
      warnings: [],
    };
    logger.info("Research needs clarification", { requestId, message });
    return { status: "degraded", analysis: null, sources: [], meta, message };
  }

  let current: RetrieveOutcome = {
    evidence: [],
    discovery: [],
    retrieved: 0,
    afterDedupe: 0,
    included: 0,
    undated: 0,
    errors: [],
  };
  let previousEvidence: ResearchResult[] = [];
  let comparisonAvailable = false;

  if (providers.length > 0 && !socialOnly) {
    logger.info("Starting general retrieve", { requestId, providerCount: providers.length, queries: plan.queries });
    const retrieveStart = Date.now();
    current = await retrieve(plan, providers, dateRange, deps.config, now, deps.signal);
    logger.info("General retrieve completed", { requestId, elapsedMs: Date.now() - retrieveStart, retrieved: current.retrieved, included: current.included, errors: current.errors.length });
    providerErrors.push(...current.errors);

    if (previousDateRange) {
      const previous = await retrieve(
        { ...plan, queries: plan.queries.slice(0, MAX_PREVIOUS_QUERIES) },
        providers,
        previousDateRange,
        deps.config,
        now,
        deps.signal,
      );
      previousEvidence = previous.evidence;
      providerErrors.push(...previous.errors);
      comparisonAvailable = previousEvidence.length > 0;
    }
  }

  const shouldDork =
    socialOnly &&
    instagramOnly &&
    (deps.config.maxInstagramQueries ?? 0) > 0;

  const discoveryQueries = shouldDork
    ? buildSocialDiscoveryQueries({
        subject: plan.subject ?? plan.primaryEntity,
        entities: plan.entities,
        keywords: plan.keywords,
        platforms: plan.platforms.length > 0 ? plan.platforms : ["instagram"],
        handles: plan.handles,
        intentKind: plan.intentKind,
        dateRange,
        limit: deps.config.maxInstagramQueries ?? 0,
      })
    : [];

  if (discoveryQueries.length > 0) {
    logger.info("Instagram discovery queries", { requestId, queries: discoveryQueries });
  }

  const criteria: SocialCriteria = {
    entities: unique([
      ...plan.entities,
      ...(mode === "profile" ? plan.handles : []),
    ]),
    keywords: plan.keywords,
    platform: plan.platform ?? "instagram",
    instagramOnly: plan.platform === null || plan.platform === "instagram",
    postsOnly: plan.intentKind === "post_discovery",
  };

  const instagram = deps.instagram?.isConfigured() ? deps.instagram : null;
  let social = emptySocial();
  if (socialOnly && instagramOnly && providers.length > 0) {
    logger.info("Starting social evidence retrieval", { requestId, discoveryQueries: discoveryQueries.length, queries: discoveryQueries });
    const socialStart = Date.now();
    social = await retrieveSocialEvidence({
      mode,
      intentKind: plan.intentKind,
      discoveryQueries,
      handles: mode === "profile" ? plan.handles : [],
      criteria,
      providers,
      instagram,
      dateRange,
      config: deps.config,
      now,
      signal: deps.signal,
    });
    logger.info("Social evidence retrieval completed", { requestId, elapsedMs: Date.now() - socialStart, queriesRun: social.queriesRun, evidenceCount: social.evidence.length });
    providerErrors.push(...social.errors);
  }

  const combined = dedupeResults([
    ...(socialOnly ? [] : current.evidence),
    ...(socialOnly ? [] : previousEvidence),
    ...social.evidence,
  ]).unique;
  const evidence = selectEvidence(combined, deps.config.maxEvidence, mode);
  const socialCount = evidence.filter((result) => result.sourceType === "social").length;
  const requiresSocial = socialOnly && instagramOnly;

  const sourceTypes = unique(evidence.map((result) => result.sourceType));
  const limitations = buildLimitations({
    integrations: deps.integrations,
    providers,
    mode,
    platform: plan.platform,
    unsupportedPlatform,
    undatedExcluded: socialOnly ? 0 : current.undated,
    socialDated: social.dated,
    socialUndated: social.undated,
    socialIncluded: socialCount > 0,
    socialQueriesRun: social.queriesRun,
    profileRequested: mode === "profile",
    profileAvailable: instagram !== null,
    comparisonRequested,
    comparisonAvailable,
    providerErrors,
  });

  const metaBase = {
    ...baseMeta,
    queries: unique([...plan.queries, ...discoveryQueries]),
    resultsRetrieved: socialOnly ? social.retrieved : current.retrieved + social.retrieved,
    resultsAfterDedupe: socialOnly ? social.afterDedupe : current.afterDedupe + social.afterDedupe,
    resultsIncluded: evidence.length,
    undatedExcluded: socialOnly ? 0 : current.undated,
    sourceTypesSearched: sourceTypes,
    providersSearched: [
      ...providers.map((provider) => provider.id),
      ...(social.instagramUsed && instagram ? [instagram.id] : []),
    ],
    comparisonAvailable,
  };

  const isPostCount = plan.intentKind === "post_count";

  if (isPostCount) {
    const postCount = social.postCount ?? 0;
    const postsPerDay = social.postsPerDay ?? {};
    const subject = plan.subject ?? plan.primaryEntity ?? plan.handles[0] ?? "the subject";
    const rangeLabel = dateRange.label;

    let message: string;
    if (postCount === 0) {
      message = `No dated Instagram posts found for ${subject} in ${rangeLabel}.`;
    } else {
      const perDayEntries = Object.entries(postsPerDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, count]) => `${day}: ${count}`)
        .join(", ");
      message = `${subject}: at least ${postCount} Instagram posts found in ${rangeLabel}. Based on the posts found in this search; the real number is likely higher.`;
      if (perDayEntries) {
        message += ` Posts per day: ${perDayEntries}.`;
      }
    }

    const limitations = buildLimitations({
      integrations: deps.integrations,
      providers,
      mode,
      platform: plan.platform,
      unsupportedPlatform,
      undatedExcluded: socialOnly ? 0 : current.undated,
      socialDated: social.dated,
      socialUndated: social.undated,
      socialIncluded: socialCount > 0,
      socialQueriesRun: social.queriesRun,
      profileRequested: mode === "profile",
      profileAvailable: instagram !== null,
      comparisonRequested,
      comparisonAvailable,
      providerErrors,
    });
    limitations.push(
      `${social.undated} Instagram result(s) had no reliable timestamp and were excluded from the count.`,
    );
    if (social.outOfRange > 0) {
      limitations.push(`${social.outOfRange} Instagram result(s) were outside the requested date range.`);
    }

    const meta: ResearchMeta = {
      ...metaBase,
      resultsIncluded: evidence.length,
      status: "ok",
      limitations,
      warnings: [],
    };
    logger.info("Post count answer generated", { requestId, postCount, subject });
    return { status: "ok", analysis: null, sources: evidence, meta, message };
  }

  const canAnalyze =
    providers.length > 0 &&
    evidence.length > 0 &&
    deps.gemini !== null &&
    (!requiresSocial || socialCount > 0);

  if (!canAnalyze) {
    const noSocial = requiresSocial && socialCount === 0;
    const sources = noSocial ? [] : evidence;
    const message = noSocial
      ? noSocialMessage({
          subject: plan.subject ?? plan.primaryEntity ?? plan.handles[0] ?? input.question,
          discoveryQueries,
          platform: plan.platform,
          geminiConfigured: deps.integrations.gemini.configured,
        })
      : unsupportedPlatform
        ? `Social research currently supports Instagram only. No ${unsupportedPlatform} results were retrieved, and Tubitex did not substitute unrelated news or Instagram content.`
        : degradedMessage({
            integrations: deps.integrations,
            providerCount: providers.length,
            sourceCount: evidence.length,
          });
    const meta: ResearchMeta = {
      ...metaBase,
      resultsIncluded: sources.length,
      status: "degraded",
      limitations,
      warnings: [],
    };
    logger.info("Cannot analyze - degraded response", { requestId, noSocial, unsupportedPlatform: !!unsupportedPlatform, providerCount: providers.length, evidenceCount: evidence.length, geminiConfigured: deps.integrations.gemini.configured });
    return { status: "degraded", analysis: null, sources, meta, message };
  }

  logger.info("Starting Gemini analysis", { requestId, evidenceCount: evidence.length });
  const analysisStart = Date.now();
  try {
    const rawAnalysis = await analyzeWithGemini(
      {
        question: input.question,
        intent: plan.intent,
        intentKind: plan.intentKind,
        mode,
        subject: plan.subject,
        dateRange,
        previousDateRange,
        sources: evidence,
      },
      { gemini: deps.gemini as GeminiClient, signal: deps.signal, temperature: deps.config.temperature },
    );
    logger.info("Gemini analysis completed", { requestId, elapsedMs: Date.now() - analysisStart });

    const { analysis, warnings: sourceWarnings } = validateAnalysisSources(
      rawAnalysis,
      evidence.length,
    );
    const warnings = [...sourceWarnings];
    if (requiresSocial && socialCount > 0 && socialCount < 3) {
      warnings.push(
        `Only ${socialCount} relevant social post(s) were found; sentiment and reaction conclusions are preliminary.`,
      );
    }
    const meta: ResearchMeta = {
      ...metaBase,
      status: "ok",
      limitations,
      warnings,
    };

    return {
      status: "ok",
      analysis,
      sources: evidence,
      meta,
      message: buildAssistantText(analysis),
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    const detail =
      error instanceof AnalysisError
        ? error.details.join("; ")
        : error instanceof Error
          ? error.message
          : "unknown error";
    logger.error("Analysis failed", { message: detail });
    const meta: ResearchMeta = {
      ...metaBase,
      status: "degraded",
      limitations,
      warnings: ["AI analysis could not complete for this request."],
    };
    return {
      status: "degraded",
      analysis: null,
      sources: evidence,
      meta,
      message: "Research completed, but the AI analysis step could not run. The retrieved sources are shown below so you can still review them.",
    };
  }
}
