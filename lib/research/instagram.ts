import type { InstagramProfile, RawProviderResult } from "@/lib/providers/types";
import type { ResearchResult } from "@/types";
import { truncate, unique } from "@/lib/utils";
import { toDateOnly } from "./dates";
import type { ResearchIntentKind, SocialPlatform } from "./entities";
import { SOCIAL_PLATFORM_DOMAINS } from "./platforms";
import { validateEntity, FILLER_WORDS } from "./gemini-entities";
import { shortcodeFromUrl, instagramContentKind, dateFromShortcode, InstagramContentKind, RESERVED_SEGMENTS, USERNAME_PATTERN } from "./igDate";

function adjustDateByDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date.toISOString());
}

const INTENT_WORD_PATTERN =
  /\b(numbers?|metrics?|stats?|statistics?|figures?|buzz(?:ing)?|latest|recent|reactions?|reacting|sentiment|social|media|posts?|reels?|comments?|engagement|followers?|profile|account|overall|happening|update|updates|news|data)\b/gi;

function sanitizeSubject(value: string | null | undefined): string | null {
  if (!value) return null;
  const withoutIntentWords = value.replace(INTENT_WORD_PATTERN, " ").replace(/[#@]/g, " ");
  const cleaned = withoutIntentWords
    .replace(/^\s*(?:on|in|about|from|the|a|an|of|for|to)\b/gi, " ")
    .replace(/\b(?:on|in|about|from|of|for|to)\s*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Also check against filler words
  const words = cleaned.split(/\s+/).filter((w) => !FILLER_WORDS.has(w.toLowerCase()));
  const result = words.join(" ");
  return result.length >= 2 ? result : null;
}

const MAX_PROFILE_POSTS = 3;

export function normalizeInstagramUsername(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return extractInstagramUsername(trimmed);
  const candidate = trimmed.replace(/^@+/, "");
  if (!USERNAME_PATTERN.test(candidate)) return null;
  return candidate.toLowerCase();
}

/**
 * Extracts a profile handle from an Instagram URL. Post/reel/story and other
 * reserved paths return null because they are not profile pages.
 */
export function extractInstagramUsername(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;

  const segment = url.pathname.split("/").filter(Boolean)[0];
  if (!segment) return null;
  const candidate = segment.toLowerCase();
  if (RESERVED_SEGMENTS.has(candidate)) return null;
  if (!USERNAME_PATTERN.test(candidate)) return null;
  return candidate;
}

export function collectInstagramUsernames(
  results: Pick<ResearchResult, "originalUrl" | "canonicalUrl">[],
  limit: number,
): string[] {
  if (limit <= 0) return [];
  const usernames: string[] = [];
  for (const result of results) {
    for (const url of [result.originalUrl, result.canonicalUrl]) {
      const username = extractInstagramUsername(url);
      if (username) usernames.push(username);
    }
  }
  return unique(usernames).slice(0, limit);
}

/**
 * Extracts explicit Instagram handles from free text, either as `@handle`
 * mentions or as pasted Instagram profile URLs. Reserved paths are ignored.
 */
export function extractInstagramHandles(text: string): string[] {
  if (!text) return [];
  const handles: string[] = [];

  for (const match of text.match(/https?:\/\/[^\s)"'<>]*instagram\.com[^\s)"'<>]*/gi) ?? []) {
    const username = extractInstagramUsername(match);
    if (username) handles.push(username);
  }

  const mention = /(?:^|[^\w.@])@([A-Za-z0-9._]{1,30})/g;
  let found: RegExpExecArray | null;
  while ((found = mention.exec(text)) !== null) {
    const candidate = found[1]!.toLowerCase();
    if (!RESERVED_SEGMENTS.has(candidate) && USERNAME_PATTERN.test(candidate)) {
      handles.push(candidate);
    }
  }

  return unique(handles);
}

export interface SocialDiscoveryInput {
  /** Primary subject, e.g. the film or brand. Never an intent word. */
  subject: string | null;
  /** Additional entities to pair with the subject (actor, client, etc.). */
  entities?: string[];
  /** Supporting keywords, used only when no entity is available. */
  keywords?: string[];
  /** Named platforms. Instagram is the only one with dork support today. */
  platforms?: SocialPlatform[];
  /** Explicit account handles for profile requests. */
  handles?: string[];
  intentKind?: ResearchIntentKind;
  /** Requested window, used only as a soft `after:`/`before:` hint. */
  dateRange?: { from: string; to: string } | null;
  /** Maximum number of queries to return. */
  limit: number;
}

function quoteTerm(term: string): string {
  const cleaned = term.replace(/"/g, "").replace(/\s+/g, " ").trim();
  return cleaned ? `"${cleaned}"` : "";
}

/**
 * Builds a small, diverse set of Google dorks for social discovery.
 *
 * Rules:
 * - The subject is never an intent word ("numbers", "buzz", "reactions").
 * - Instagram dorks only; no generic web/news queries.
 * - Date operators are a soft hint, not proof of publication time.
 * - For profile requests the queries target the account itself.
 */
const SUBJECT_FALLBACK_NOISE = new Set([
  "content",
  "both",
  "breaking",
  "alert",
  "update",
  "updates",
]);

/**
 * Keyword-derived pairing terms (for example a lower-case film title such as
 * "ramayan" that never appeared capitalized) become extra quoted dork variants
 * so the subject's other names are still searched.
 */
function extractKeywordTerms(
  keywords: string[],
  exclude: string[],
): string[] {
  const excluded = new Set(
    exclude.map((value) => value.toLowerCase().replace(/\s+/g, "")),
  );
  const terms: string[] = [];
  for (const keyword of keywords) {
    const term = validateEntity(keyword);
    if (!term || term.length < 3) continue;
    if (SUBJECT_FALLBACK_NOISE.has(term.toLowerCase())) continue;
    if (excluded.has(term.toLowerCase())) continue;
    if (terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) continue;
    terms.push(term);
    if (terms.length >= 2) break;
  }
  return terms;
}

export function buildSocialDiscoveryQueries(input: SocialDiscoveryInput): string[] {
  if (input.limit <= 0) return [];
  const platforms = input.platforms && input.platforms.length > 0 ? input.platforms : ["instagram"];
  const instagramOnly = platforms.every((platform) => platform === "instagram");
  if (!instagramOnly) return [];

  const handles = unique((input.handles ?? []).map((handle) => handle.replace(/^@+/, "").toLowerCase()));

  if (input.intentKind === "profile_metrics" || input.intentKind === "profile_lookup" || input.intentKind === "post_discovery") {
    if (handles.length === 0) return [];
    const handle = handles[0]!;
    const candidates: string[] = [
      `site:instagram.com/${handle}`,
      `site:instagram.com "${handle}"`,
      `site:instagram.com inurl:/reel/ "${handle}"`,
      `site:instagram.com inurl:/p/ "${handle}"`,
    ];
    if (input.dateRange) {
      // Google's before: excludes that day, so use from-1 and to+1 for text operators
      const after = adjustDateByDays(input.dateRange.from, -1);
      const before = adjustDateByDays(input.dateRange.to, 1);
      return unique(candidates.map((query) => `${query} after:${after} before:${before}`)).slice(0, input.limit);
    }
    return unique(candidates).slice(0, input.limit);
  }

  const subjectTerm = sanitizeSubject(input.subject);
  if (!subjectTerm) return [];

  // Single main query per entity as per spec
  if (!input.dateRange) return [];
  // Google's before: excludes that day, so use from-1 and to+1 for text operators
  const afterText = adjustDateByDays(input.dateRange.from, -1);
  const beforeText = adjustDateByDays(input.dateRange.to, 1);
  // tbs uses exact from/to dates (handled by provider via toSerpApiTbsApp)
  const mainQuery = `site:instagram.com "${subjectTerm}" after:${afterText} before:${beforeText}`;
  
  return [mainQuery];
}

/** @deprecated Use {@link buildSocialDiscoveryQueries}. */
export const buildInstagramDiscoveryQueries = buildSocialDiscoveryQueries;

export function platformSiteOperators(platforms: SocialPlatform[]): string[] {
  return platforms.flatMap((platform) =>
    (SOCIAL_PLATFORM_DOMAINS[platform] ?? []).map((domain) => `site:${domain}`),
  );
}

function trimDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toString().replace(/\.0$/, "");
}

export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(Math.round(value));
}

export function instagramProfileToRawResult(profile: InstagramProfile): RawProviderResult {
  const stats: string[] = [];
  if (profile.followers !== null) stats.push(`${formatCompactCount(profile.followers)} followers`);
  if (profile.following !== null) stats.push(`${formatCompactCount(profile.following)} following`);
  if (profile.postsCount !== null) stats.push(`${formatCompactCount(profile.postsCount)} posts`);
  if (profile.verified) stats.push("verified");
  if (profile.isPrivate) stats.push("private account");

  const title = `Instagram @${profile.username}${profile.fullName ? ` — ${profile.fullName}` : ""}`;
  const lines = [title];
  if (stats.length > 0) lines.push(stats.join(" · "));
  if (profile.biography) lines.push(`Bio: ${truncate(profile.biography.replace(/\s+/g, " "), 200)}`);

  const posts = profile.recentPosts.slice(0, MAX_PROFILE_POSTS);
  if (posts.length > 0) {
    lines.push("Recent posts:");
    for (const post of posts) {
      const metrics: string[] = [];
      if (post.likes !== null) metrics.push(`${formatCompactCount(post.likes)} likes`);
      if (post.comments !== null) metrics.push(`${formatCompactCount(post.comments)} comments`);
      if (post.isVideo) metrics.push("video");
      const caption = post.caption ? truncate(post.caption.replace(/\s+/g, " "), 180) : "(no caption)";
      const suffix = post.url ? ` — ${post.url}` : "";
      lines.push(`- ${caption}${metrics.length ? ` [${metrics.join(", ")}]` : ""}${suffix}`);
    }
  }

  const publishedAt = profile.recentPosts.find((post) => post.publishedAt)?.publishedAt ?? null;

  return {
    title,
    url: profile.url,
    source: `Instagram (@${profile.username})`,
    snippet: lines.join("\n"),
    publishedAt,
    platform: "instagram",
    sourceType: "social",
  };
}

/** Normalized Instagram post card for UI */
export interface NormalizedInstagramPost {
  url: string;
  shortcode: string | null;
  title: string;
  account: string; // "handle" without @
  dateISO: string | null; // ISO string from shortcode or parsed
  dateText: string | null; // Formatted date for display
  dateSource: "shortcode" | "serpapi_date" | "snippet" | "relative" | null; // Source of the date
  googleRelativeTime: string | null; // e.g., "1 day ago"
  likesText: string | null; // Exactly as Google shows, e.g., "58.1K+ likes"
  likesNum: number | null; // Numeric for sorting
  commentsText: string | null; // e.g., "56 comments"
  commentsNum: number | null;
  snippet: string; // Caption/snippet (max 220 chars for Gemini)
}

/** Parse likes from text like "58.1K+ likes" or "1,234 likes" */
function parseLikesNum(text: string): number | null {
  const m = text.match(/([\d.,]+)\s*([KM]?)\+?\s*likes?/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  const mult = m[2]?.toUpperCase();
  if (mult === "K") return Math.round(num * 1_000);
  if (mult === "M") return Math.round(num * 1_000_000);
  return Math.round(num);
}

/** Parse comments from text like "56 comments" */
function parseCommentsNum(text: string): number | null {
  const m = text.match(/([\d.,]+)\s*([KM]?)\+?\s*comments?/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  const mult = m[2]?.toUpperCase();
  if (mult === "K") return Math.round(num * 1_000);
  if (mult === "M") return Math.round(num * 1_000_000);
  return Math.round(num);
}

/** Extract account handle from title/snippet patterns like "(@handle)" or "username on Date:" */
function extractAccountFromText(title: string, snippet: string | null): string | null {
  // Pattern: (@handle) in title or snippet
  const parenMatch = (title + " " + (snippet ?? "")).match(/\(@([A-Za-z0-9._]{1,30})\)/);
  if (parenMatch) return parenMatch[1].toLowerCase();

  // Pattern: "username on Date:" in snippet
  const onMatch = (snippet ?? "").match(/^([A-Za-z0-9._]{1,30})\s+on\s+\d/);
  if (onMatch) return onMatch[1].toLowerCase();

  // Pattern from displayed_link: instagram.com/handle
  return null;
}

/** Extract Google's relative time like "1 day ago", "3 hours ago" */
function extractGoogleRelativeTime(snippet: string | null): string | null {
  if (!snippet) return null;
  const m = snippet.match(/(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)/i);
  return m ? m[1] : null;
}

interface SerpApiOrganicResultRaw {
  title?: string;
  link?: string;
  snippet?: string;
  rich_snippet?: { top?: { detected_extensions?: Record<string, string> } };
  displayed_link?: string;
  extensions?: string[];
  date?: string;
}

/** Parse Google relative time like "1 day ago", "3 hours ago" into absolute date */
function parseGoogleRelativeTime(relativeText: string, now: Date = new Date()): Date | null {
  const m = relativeText.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  let ms = 0;
  switch (unit) {
    case "second": ms = value * 1000; break;
    case "minute": ms = value * 60 * 1000; break;
    case "hour": ms = value * 60 * 60 * 1000; break;
    case "day": ms = value * 24 * 60 * 60 * 1000; break;
    case "week": ms = value * 7 * 24 * 60 * 60 * 1000; break;
    case "month": ms = value * 30 * 24 * 60 * 60 * 1000; break;
    case "year": ms = value * 365 * 24 * 60 * 60 * 1000; break;
  }
  if (ms === 0) return null;
  return new Date(now.getTime() - ms);
}

/** Normalize a raw SerpAPI organic result into a post card */
export function normalizeInstagramPost(
  raw: SerpApiOrganicResultRaw | null,
  rangeFrom: string,
  rangeTo: string
): NormalizedInstagramPost | null {
  if (!raw || !raw.link || !raw.title) return null;

  const title: string = raw.title;
  const url: string = raw.link;
  const snippet: string | null = raw.snippet ?? null;
  const now = new Date();

  const shortcode = shortcodeFromUrl(url);
  if (!shortcode) return null; // Not a post/reel URL

  // Skip profile pages
  const kind = instagramContentKind(url);
  if (kind === "profile" || kind === "other" || kind === "none") return null;

  // Date from shortcode (primary)
  const dateFromShortcodeResult = shortcode ? dateFromShortcode(shortcode) : null;
  let dateISO: string | null = dateFromShortcodeResult?.toISOString() ?? null;
  let dateText: string | null = dateFromShortcodeResult ? dateFromShortcodeResult.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  let dateSource: "shortcode" | "serpapi_date" | "snippet" | "relative" | null = dateFromShortcodeResult ? "shortcode" : null;

  // Fallback 1: Use SerpAPI's raw.date field if available
  if (!dateISO && raw.date) {
    const parsed = new Date(raw.date);
    if (!isNaN(parsed.getTime())) {
      dateISO = parsed.toISOString();
      dateText = parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      dateSource = "serpapi_date";
    }
  }

  // Fallback 2: Parse absolute date from snippet (e.g., "Oct 15, 2024")
  if (!dateISO && snippet) {
    const dateMatch = snippet.match(/(\w+\s+\d{1,2},\s+\d{4})/);
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed.getTime())) {
        dateISO = parsed.toISOString();
        dateText = parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        dateSource = "snippet";
      }
    }
  }

  // Fallback 3: Parse Google relative time (e.g., "1 day ago", "3 hours ago")
  let googleRelativeTime: string | null = null;
  if (snippet) {
    const relativeMatch = snippet.match(/(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)/i);
    if (relativeMatch) {
      googleRelativeTime = relativeMatch[1];
      if (!dateISO) {
        const relativeDate = parseGoogleRelativeTime(googleRelativeTime, now);
        if (relativeDate) {
          dateISO = relativeDate.toISOString();
          dateText = relativeDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          dateSource = "relative";
        }
      }
    }
  }

  // Date is decoded for DISPLAY only (and sorting when likes missing).
  // No date-based dropping here; filtering happens in filterInstagramPosts.

  // Likes and comments from rich_snippet, extensions, or snippet
  let likesText: string | null = null;
  let likesNum: number | null = null;
  let commentsText: string | null = null;
  let commentsNum: number | null = null;

  // Check rich_snippet.top.detected_extensions
  const detected = raw.rich_snippet?.top?.detected_extensions;
  if (detected) {
    for (const [key, value] of Object.entries(detected)) {
      if (/likes?/i.test(key) && !likesText) {
        likesText = value as string;
        likesNum = parseLikesNum(value as string);
      }
      if (/comments?/i.test(key) && !commentsText) {
        commentsText = value as string;
        commentsNum = parseCommentsNum(value as string);
      }
    }
  }

  // Check extensions array (older format)
  if (!likesText || !commentsText) {
    for (const ext of raw.extensions ?? []) {
      if (!likesText && /likes?/i.test(ext)) {
        likesText = ext;
        likesNum = parseLikesNum(ext);
      }
      if (!commentsText && /comments?/i.test(ext)) {
        commentsText = ext;
        commentsNum = parseCommentsNum(ext);
      }
    }
  }

  // Fallback: parse from snippet text
  if ((!likesText || !commentsText) && snippet) {
    if (!likesText) {
      const likesMatch = snippet.match(/([\d.,]+\s*[KM]?\+?\s*likes?)/i);
      if (likesMatch) {
        likesText = likesMatch[1];
        likesNum = parseLikesNum(likesText);
      }
    }
    if (!commentsText) {
      const commentsMatch = snippet.match(/([\d.,]+\s*[KM]?\+?\s*comments?)/i);
      if (commentsMatch) {
        commentsText = commentsMatch[1];
        commentsNum = parseCommentsNum(commentsText);
      }
    }
  }

  // Account handle
  const account = extractAccountFromText(title, snippet) ?? "unknown";

  // Snippet for Gemini (cap at 220 chars)
  const snippetForGemini = truncate((snippet ?? "").replace(/\s+/g, " "), 220);

  return {
    url,
    shortcode,
    title,
    account,
    dateISO,
    dateText,
    dateSource,
    googleRelativeTime,
    likesText,
    likesNum,
    commentsText,
    commentsNum,
    snippet: snippetForGemini,
  };
}

export interface InstagramPostFilterResult {
  posts: NormalizedInstagramPost[];
  rawCount: number;
  keptCount: number;
  dropped: {
    nonPostUrl: number;
    duplicate: number;
    outsideRange: number;
  };
  firstRawResults: Array<{ url: string; title: string }>;
}

/**
 * Filters raw SerpAPI organic results to Instagram posts using simplified rules:
 * - Keep only URLs containing /p/, /reel/, /reels/, /tv/
 * - Deduplicate by shortcode
 * - Optionally drop posts whose shortcode date is >1 day outside range (STRICT_DATE_FILTER)
 * - Keep undated posts
 */
export function filterInstagramPosts(
  rawResults: SerpApiOrganicResultRaw[],
  rangeFrom: string,
  rangeTo: string,
  strictDateFilter: boolean
): InstagramPostFilterResult {
  const rawCount = rawResults.length;
  const firstRawResults = rawResults.slice(0, 3).map((r) => ({ url: r.link ?? "", title: r.title ?? "" }));

  const seenShortcodes = new Set<string>();
  const posts: NormalizedInstagramPost[] = [];
  let nonPostUrl = 0;
  let duplicate = 0;
  let outsideRange = 0;

  const fromTime = new Date(rangeFrom).getTime();
  const toTime = new Date(rangeTo).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;

  for (const raw of rawResults) {
    if (!raw.link || !raw.title) {
      nonPostUrl += 1;
      continue;
    }

    const shortcode = shortcodeFromUrl(raw.link);
    if (!shortcode) {
      nonPostUrl += 1;
      continue;
    }

    const shortcodeKey = shortcode.toLowerCase();
    if (seenShortcodes.has(shortcodeKey)) {
      duplicate += 1;
      continue;
    }

    const normalized = normalizeInstagramPost(raw, rangeFrom, rangeTo);
    if (!normalized) {
      nonPostUrl += 1;
      continue;
    }

    // Check date range only if strictDateFilter is enabled
    if (strictDateFilter && normalized.dateISO) {
      const postTime = new Date(normalized.dateISO).getTime();
      if (postTime < fromTime - oneDayMs || postTime > toTime + oneDayMs) {
        outsideRange += 1;
        continue;
      }
    }

    seenShortcodes.add(shortcodeKey);
    posts.push(normalized);
  }

  return {
    posts,
    rawCount,
    keptCount: posts.length,
    dropped: { nonPostUrl, duplicate, outsideRange },
    firstRawResults,
  };
}