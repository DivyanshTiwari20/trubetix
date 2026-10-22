import { LIMITS } from "@/lib/config";
import type { RawProviderResult } from "@/lib/providers/types";
import type { ResearchResult } from "@/types";
import { isDefined, truncate } from "@/lib/utils";
import { canonicalizeUrl, extractHostname, isValidHttpUrl } from "./canonicalize";
import { inferPlatform, inferSourceType } from "./classify";
import { parsePublishedDate } from "./dates";
import { shortcodeFromUrl, dateFromShortcode } from "./igDate";

export interface NormalizeContext {
  queryUsed: string;
  entities: string[];
  retrievedAt: string;
  now?: Date;
}

const ENGAGEMENT_REGEX =
  /(\d[\d,.]*(?:[KMkm])?)\s*(likes?|comments?)\s*,?\s*(\d[\d,.]*(?:[KMkm])?)\s*(likes?|comments?)\s*-\s*([^:]+?)\s*on\s+([A-Za-z]+ \d{1,2}, \d{4}):/i;

function parseEngagementCount(str: string): number {
  const normalized = str.replace(/,/g, "").trim().toLowerCase();
  if (normalized.endsWith("k")) return Math.round(parseFloat(normalized) * 1000);
  if (normalized.endsWith("m")) return Math.round(parseFloat(normalized) * 1000000);
  return parseInt(normalized, 10);
}

function extractEngagementAndCaption(snippet: string): { likes?: number; comments?: number; username?: string; caption: string; dateStr?: string } {
  const match = snippet.match(ENGAGEMENT_REGEX);
  if (!match) return { caption: snippet };
  const [, count1, type1, count2, type2, username, dateStr] = match;
  const likes = type1.startsWith("like") ? parseEngagementCount(count1) : type2.startsWith("like") ? parseEngagementCount(count2) : undefined;
  const comments = type1.startsWith("comment") ? parseEngagementCount(count1) : type2.startsWith("comment") ? parseEngagementCount(count2) : undefined;
  const prefix = match[0];
  const caption = snippet.slice(prefix.length).trim();
  return { likes, comments, username: username.trim(), caption, dateStr };
}

function isInstagramPostUrl(url: string): boolean {
  return /instagram\.com\/(?:[^\/]+\/)?(?:p|reel|reels|tv)\//i.test(url);
}

export function normalizeProviderResult(
  raw: RawProviderResult,
  context: NormalizeContext,
): ResearchResult | null {
  const url = raw.url?.trim();
  if (!url || !isValidHttpUrl(url)) return null;

  const hostname = extractHostname(url);
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = "";
  }

  const title = (raw.title ?? "").trim() || hostname || url;
  const snippet = truncate((raw.snippet ?? "").trim(), LIMITS.resultSnippetMaxLength);
  const haystack = `${title} ${snippet}`.toLowerCase();
  const matchedEntities = context.entities.filter((entity) =>
    haystack.includes(entity.toLowerCase()),
  );

  let publishedAt: string | null = parsePublishedDate(raw.publishedAt, context.now);
  let dateSource: "shortcode" | "snippet" | "provider" | undefined;

  if (isInstagramPostUrl(url)) {
    const sc = shortcodeFromUrl(url);
    if (sc) {
      const d = dateFromShortcode(sc);
      if (d) {
        publishedAt = d.toISOString();
        dateSource = "shortcode";
      }
    }
    if (!publishedAt) {
      const { dateStr } = extractEngagementAndCaption(snippet);
      if (dateStr) {
        const parsed = new Date(`${dateStr} UTC`);
        if (!Number.isNaN(parsed.getTime())) {
          publishedAt = parsed.toISOString();
          dateSource = "snippet";
        }
      }
    }
    if (!publishedAt) {
      publishedAt = parsePublishedDate(raw.publishedAt, context.now);
      if (publishedAt) dateSource = "provider";
    }
  }

  let likes: number | undefined;
  let comments: number | undefined;
  let username: string | undefined;
  let cleanedCaption: string | undefined;

  if (isInstagramPostUrl(url)) {
    const extracted = extractEngagementAndCaption(snippet);
    likes = extracted.likes;
    comments = extracted.comments;
    username = extracted.username;
    cleanedCaption = extracted.caption !== snippet ? extracted.caption : undefined;
  }

  return {
    title,
    canonicalUrl: canonicalizeUrl(url),
    originalUrl: url,
    sourceName: raw.source?.trim() || hostname,
    sourceType: raw.sourceType ?? inferSourceType(hostname, pathname),
    platform: raw.platform ?? inferPlatform(hostname),
    publishedAt,
    retrievedAt: context.retrievedAt,
    contentSnippet: snippet,
    matchedEntities,
    queryUsed: raw.queryUsed ?? context.queryUsed,
    relatedUrls: [],
    likes,
    comments,
    username,
    cleanedCaption,
    dateSource,
  };
}

export function normalizeProviderResults(
  raws: RawProviderResult[],
  context: NormalizeContext,
): ResearchResult[] {
  return raws.map((raw) => normalizeProviderResult(raw, context)).filter(isDefined);
}
