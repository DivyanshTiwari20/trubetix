import type { ResearchResult } from "@/types";
import { extractHostname } from "./canonicalize";
import { instagramContentKind } from "./igDate";
import {
  isSocialHost,
  matchesRequestedPlatform,
  platformForHost,
} from "./platforms";
import type { SocialPlatform } from "./entities";

export interface SocialFilterCriteria {
  entities: string[];
  keywords: string[];
  /** Requested platform. When set, results from other social platforms are rejected. */
  platform?: SocialPlatform | null;
  /** Accept only Instagram results. Used for Instagram-focused requests. */
  instagramOnly?: boolean;
  /** Accept only actual posts/Reels (profile requests that need post content). */
  postsOnly?: boolean;
}

export interface SocialFilterOutcome {
  kept: ResearchResult[];
  dropped: ResearchResult[];
}

const SPAM_PATTERNS: RegExp[] = [
  /\bbuy\b[^.]{0,24}\b(followers?|likes?|views?)\b/i,
  /\b(followers?|likes?)\b[^.]{0,24}\b(free|buy|cheap|fast|boost|grow)\b/i,
  /\bfree\s+(instagram\s+)?(followers?|likes?|views?)\b/i,
  /\bhow to (get|gain|increase)\b[^.]{0,24}\b(followers?|likes?|engagement)\b/i,
  /\binstagram\s+(tips?|tricks?|tutorials?|hacks?)\b/i,
  /\binstagram\s+(marketing|growth)\s+(tools?|services?|agenc(?:y|ies))\b/i,
  /\bdownload\s+(instagram|reels?|videos?)\b/i,
  /\bverified\s+badge\b/i,
  /\b(follower|like|view)\s+(seller|service|panel|exchange)\b/i,
  /\binstagram\s+(downloader|viewer|anonymous viewer)\b/i,
];

const LOW_QUALITY_HOSTS = [
  "pinterest.com",
  "quora.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches a subject as whole words so short entities ("Ram") do not match
 * unrelated words ("drama"). Multi-word entities must appear as a phrase.
 */
export function mentionsSubject(haystack: string, subject: string): boolean {
  const needle = normalizeText(subject);
  if (needle.length < 2) return false;
  const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:$|[^a-z0-9])`, "i");
  return pattern.test(haystack);
}

function matchesSubject(haystack: string, criteria: SocialFilterCriteria): boolean {
  if (criteria.entities.length > 0) {
    return criteria.entities.some((entity) => mentionsSubject(haystack, entity));
  }
  if (criteria.keywords.length > 0) {
    return criteria.keywords.some((keyword) => mentionsSubject(haystack, keyword));
  }
  return false;
}

function isLowQualityHost(hostname: string): boolean {
  return LOW_QUALITY_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

/**
 * Accepts a result as relevant social evidence only when:
 * - it is hosted on the requested social platform,
 * - it mentions the subject as a whole word/phrase,
 * - it carries usable content (a post/Reel URL, or a meaningful snippet),
 * - and it is not a spam, growth-service or platform-tutorial page.
 *
 * An Instagram URL alone is never sufficient.
 */
export function isRelevantSocialResult(
  result: ResearchResult,
  criteria: SocialFilterCriteria,
): boolean {
  const host = extractHostname(result.originalUrl);
  if (!host || !isSocialHost(host)) return false;
  if (criteria.instagramOnly && platformForHost(host) !== "instagram") return false;
  if (!matchesRequestedPlatform(host, criteria.platform ?? null)) return false;
  if (isLowQualityHost(host)) return false;

  const haystack = normalizeText(`${result.title} ${result.contentSnippet}`);
  if (SPAM_PATTERNS.some((pattern) => pattern.test(haystack))) return false;
  if (!matchesSubject(haystack, criteria)) return false;

  const isInstagram = platformForHost(host) === "instagram";
  if (isInstagram) {
    const kind = instagramContentKind(result.originalUrl);
    if (kind === "post" || kind === "reel" || kind === "tv") return true;
    if (kind === "profile") {
      if (criteria.postsOnly) return false;
      return result.contentSnippet.trim().length >= 20;
    }
    return false;
  }

  if (criteria.postsOnly) return false;
  return result.contentSnippet.trim().length >= 15;
}

export function filterSocialResults(
  results: ResearchResult[],
  criteria: SocialFilterCriteria,
): SocialFilterOutcome {
  const kept: ResearchResult[] = [];
  const dropped: ResearchResult[] = [];
  for (const result of results) {
    if (isRelevantSocialResult(result, criteria)) kept.push(result);
    else dropped.push(result);
  }
  return { kept, dropped };
}

/**
 * Deterministic relevance ordering: exact subject matches, real post/Reel
 * content, and results inside the requested window rank first. The score is
 * only used for ordering, never presented as a measure of popularity.
 */
export function rankSocialResults(
  results: ResearchResult[],
  criteria: SocialFilterCriteria,
  isInWindow: (result: ResearchResult) => boolean = () => false,
): ResearchResult[] {
  const scored = results.map((result, index) => {
    const host = extractHostname(result.originalUrl);
    const kind = host && platformForHost(host) === "instagram"
      ? instagramContentKind(result.originalUrl)
      : "none";
    const haystack = normalizeText(`${result.title} ${result.contentSnippet}`);
    let score = 0;
    if (kind === "post" || kind === "reel" || kind === "tv") score += 4;
    if (criteria.entities.some((entity) => mentionsSubject(haystack, entity))) score += 3;
    if (result.contentSnippet.trim().length >= 60) score += 1;
    if (isInWindow(result)) score += 2;
    if (result.publishedAt) score += 1;
    return { result, score, index };
  });

  return scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .map((entry) => entry.result);
}
