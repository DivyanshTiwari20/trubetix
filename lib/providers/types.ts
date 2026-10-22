import type { Platform, ResolvedDateRange, SourceType } from "@/types";

export interface ProviderQuery {
  query: string;
  numResults: number;
  dateRange: ResolvedDateRange;
  newsOnly?: boolean;
  /**
   * Number of result pages to fetch for this query (SerpAPI `start` offsets).
   * Providers stop early when a page comes back short or empty, so this is a
   * ceiling on pagination spend rather than a guaranteed request count.
   */
  pages?: number;
}

export interface RawProviderResult {
  title: string;
  url: string;
  source?: string | null;
  snippet?: string | null;
  publishedAt?: string | null;
  platform?: Platform;
  sourceType?: SourceType;
  /** Set by the pipeline to the query that discovered the result. */
  queryUsed?: string;
}

export type SearchCapability = "web" | "news";

export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  /** Which query kinds this provider can serve. Undefined means "web". */
  readonly capabilities?: readonly SearchCapability[];
  isConfigured(): boolean;
  search(query: ProviderQuery, options?: { signal?: AbortSignal }): Promise<RawProviderResult[]>;
  /** Optional: returns raw organic results and search_information for Instagram post normalization. */
  searchWithInfo?: (query: ProviderQuery, options?: { signal?: AbortSignal }) => Promise<{
    results: RawProviderResult[];
    searchInformation: SerpApiSearchInformation | null;
    searchMetadata: SerpApiSearchMetadata | null;
    rawOrganicResults: SerpApiOrganicResult[];
  }>;
}

export interface SerpApiSearchInformation {
  total_results?: number | string;
  search_time?: number;
  query_displayed?: string;
}

export interface SerpApiSearchMetadata {
  status?: string;
  id?: string;
  json_endpoint?: string;
  created_at?: string;
  processed_at?: string;
  total_time_taken?: number;
  google_domain?: string;
  location?: string;
  device?: string;
  engine?: string;
}

export interface SerpApiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  source?: string;
  date?: string;
  rich_snippet?: {
    top?: {
      detected_extensions?: Record<string, string>;
    };
  };
  displayed_link?: string;
  extensions?: string[];
}

export interface InstagramPost {
  url: string | null;
  shortcode: string | null;
  caption: string | null;
  isVideo: boolean;
  likes: number | null;
  comments: number | null;
  publishedAt: string | null;
}

export interface InstagramProfile {
  username: string;
  url: string;
  fullName: string | null;
  biography: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  verified: boolean;
  isPrivate: boolean;
  recentPosts: InstagramPost[];
}

/**
 * Investigates a small number of Instagram accounts by username. Implementations
 * must never invent follower counts, engagement metrics or post data; fields
 * that the upstream API does not return stay `null`.
 */
export interface InstagramProfileProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  fetchProfile(
    username: string,
    options?: { signal?: AbortSignal },
  ): Promise<InstagramProfile | null>;
}
