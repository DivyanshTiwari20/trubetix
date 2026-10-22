import "server-only";
import { fetchJson } from "@/lib/http";
import { normalizeInstagramUsername } from "@/lib/research/instagram";
import type { ProviderHttpOptions } from "./serpapi";
import type { InstagramPost, InstagramProfile, InstagramProfileProvider } from "./types";

interface SerpApiInstagramCaption {
  text?: unknown;
}

interface SerpApiInstagramPost {
  link?: unknown;
  shortcode?: unknown;
  caption?: unknown;
  media_captions?: unknown;
  is_video?: unknown;
  likes?: unknown;
  like_count?: unknown;
  comments?: unknown;
  comment_count?: unknown;
  date?: unknown;
  taken_at?: unknown;
  timestamp?: unknown;
}

interface SerpApiInstagramProfile {
  username?: unknown;
  full_name?: unknown;
  name?: unknown;
  biography?: unknown;
  followers?: unknown;
  follower_count?: unknown;
  following?: unknown;
  following_count?: unknown;
  posts_count?: unknown;
  media_count?: unknown;
  is_verified?: unknown;
  verified?: unknown;
  is_private?: unknown;
  private?: unknown;
  profile_url?: unknown;
  posts?: unknown;
}

interface SerpApiInstagramResponse {
  profile_results?: SerpApiInstagramProfile | null;
  error?: string;
}

export interface InstagramProviderOptions extends ProviderHttpOptions {
  apiKey: string | null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[\s,]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = asString(value);
    if (parsed) return parsed;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractCaption(value: unknown): string | null {
  if (typeof value === "string") return asString(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") return asString((entry as SerpApiInstagramCaption).text);
        return null;
      })
      .filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}

function mapPost(raw: SerpApiInstagramPost): InstagramPost | null {
  const shortcode = asString(raw.shortcode);
  const providedUrl = asString(raw.link);
  const url = providedUrl ?? (shortcode ? `https://www.instagram.com/p/${shortcode}/` : null);
  if (!url) return null;

  const caption = extractCaption(raw.caption) ?? extractCaption(raw.media_captions);

  return {
    url,
    shortcode,
    caption,
    isVideo: asBoolean(raw.is_video),
    likes: firstNumber(raw.likes, raw.like_count),
    comments: firstNumber(raw.comments, raw.comment_count),
    publishedAt: toIsoDate(raw.taken_at ?? raw.timestamp ?? raw.date),
  };
}

function mapProfile(raw: SerpApiInstagramProfile, fallbackUsername: string): InstagramProfile {
  const username = asString(raw.username)?.replace(/^@+/, "") ?? fallbackUsername;
  const posts = Array.isArray(raw.posts)
    ? raw.posts
        .map((post) => mapPost((post ?? {}) as SerpApiInstagramPost))
        .filter((post): post is InstagramPost => post !== null)
    : [];

  return {
    username,
    url: asString(raw.profile_url) ?? `https://www.instagram.com/${username}/`,
    fullName: firstString(raw.full_name, raw.name),
    biography: asString(raw.biography),
    followers: firstNumber(raw.followers, raw.follower_count),
    following: firstNumber(raw.following, raw.following_count),
    postsCount: firstNumber(raw.posts_count, raw.media_count),
    verified: asBoolean(raw.is_verified) || asBoolean(raw.verified),
    isPrivate: asBoolean(raw.is_private) || asBoolean(raw.private),
    recentPosts: posts,
  };
}

/**
 * SerpAPI Instagram Profile provider. Returns `null` when the account cannot be
 * resolved. Metrics the API does not return stay `null`; nothing is inferred.
 */
export function createInstagramProfileProvider(
  options: InstagramProviderOptions,
): InstagramProfileProvider | null {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return null;

  return {
    id: "instagram",
    label: "SerpAPI (Instagram)",
    isConfigured: () => apiKey.length > 0,
    async fetchProfile(username, { signal } = {}) {
      const handle = normalizeInstagramUsername(username);
      if (!handle) return null;

      const params = new URLSearchParams({
        engine: "instagram_profile",
        profile_id: handle,
        api_key: apiKey,
        hl: "en",
      });

      const url = `https://serpapi.com/search.json?${params.toString()}`;
      const data = await fetchJson<SerpApiInstagramResponse>(
        url,
        {},
        {
          timeoutMs: options.timeoutMs,
          retries: options.maxRetries,
          signal,
          fetchImpl: options.fetchImpl,
        },
      );

      if (data.error) {
        throw new Error(`SerpAPI reported an error: ${data.error}`);
      }
      if (!data.profile_results) return null;

      return mapProfile(data.profile_results, handle);
    },
  };
}
