import "server-only";
import { fetchJson } from "@/lib/http";
import { toSerpApiTbsApp } from "@/lib/research/dateRange";
import type { RawProviderResult, SearchProvider, ProviderQuery } from "./types";

interface SerpApiNewsResult {
  title?: string;
  link?: string;
  snippet?: string;
  source?: string | { name?: string };
  date?: string;
}

interface SerpApiOrganicResult {
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
  caption?: string;
  caption_text?: string;
  hashtags?: string[];
  owner?: string | { username?: string };
  username?: string;
  likes?: string | number;
  comments?: string | number;
  [key: string]: unknown;
}

interface SerpApiSearchInformation {
  total_results?: number | string;
  search_time?: number;
  query_displayed?: string;
}

interface SerpApiSearchMetadata {
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

interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  news_results?: SerpApiNewsResult[];
  search_information?: SerpApiSearchInformation;
  search_metadata?: SerpApiSearchMetadata;
  error?: string;
}

export interface ProviderHttpOptions {
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
}

export interface SerpApiProviderOptions extends ProviderHttpOptions {
  apiKey: string;
}

function pickNewsSource(source: SerpApiNewsResult["source"]): string | null {
  if (!source) return null;
  if (typeof source === "string") return source;
  return source.name ?? null;
}

/**
 * SerpAPI signals "the query is valid but Google has no results" as an error
 * body. That is an empty result set, not a provider failure, so it must not
 * abort pagination or surface as a failed request.
 */
const EMPTY_RESULT_PATTERN =
  /hasn'?t returned any results|did not match any documents|no results(?:\s+found)?|no search results/i;

function isEmptyResultError(message: string): boolean {
  return EMPTY_RESULT_PATTERN.test(message.toLowerCase());
}

function parseOrganic(data: SerpApiResponse): RawProviderResult[] {
  const results: RawProviderResult[] = [];
  for (const item of data.organic_results ?? []) {
    if (!item.link || !item.title) continue;
    results.push({
      title: item.title,
      url: item.link,
      source: item.source ?? null,
      snippet: item.snippet ?? null,
      publishedAt: item.date ?? null,
    });
  }
  return results;
}

function parseNews(data: SerpApiResponse): RawProviderResult[] {
  const results: RawProviderResult[] = [];
  for (const item of data.news_results ?? []) {
    if (!item.link || !item.title) continue;
    results.push({
      title: item.title,
      url: item.link,
      source: pickNewsSource(item.source),
      snippet: item.snippet ?? null,
      publishedAt: item.date ?? null,
      platform: "news",
      sourceType: "news",
    });
  }
  return results;
}

export interface SerpApiSearchResult {
  results: RawProviderResult[];
  searchInformation: SerpApiSearchInformation | null;
  searchMetadata: SerpApiSearchMetadata | null;
  rawOrganicResults: SerpApiOrganicResult[];
  /** Actual first-page request parameters, excluding the secret API key. */
  requestParameters: Record<string, string>;
  pagesFetched: number;
  pagesRequested: number | null;
  pageLimitReached: boolean;
  paginationError: string | null;
}

export function createSerpApiProvider(options: SerpApiProviderOptions): Omit<SearchProvider, "searchWithInfo"> & {
  searchWithInfo(query: ProviderQuery, options?: { signal?: AbortSignal }): Promise<SerpApiSearchResult>;
} {
  const provider = {
    id: "serpapi",
    label: "SerpAPI (Google)",
    capabilities: ["web", "news"] as const,
    isConfigured: () => options.apiKey.trim().length > 0,
    async search(query: ProviderQuery, opts: { signal?: AbortSignal } = {}) {
      const result = await provider.searchWithInfo(query, opts);
      return result.results;
    },
    async searchWithInfo(query: ProviderQuery, opts: { signal?: AbortSignal } = {}) {
      const buildParams = (start: number) => {
        const params = new URLSearchParams({
          engine: "google",
          q: query.query,
          num: String(query.numResults),
          hl: "en",
          gl: "us",
          google_domain: "google.com",
          tbs: query.dateRange ? toSerpApiTbsApp(query.dateRange) : "",
          start: String(start),
        });
        if (query.newsOnly) params.set("tbm", "nws");
        return params;
      };

      // Pagination is for organic discovery (site-scoped social listening).
      // News stays on one page because the news cap is applied upstream.
      const maxPages = query.newsOnly
        ? 1
        : query.fetchAllPages
          ? Number.POSITIVE_INFINITY
          : Math.max(1, query.pages ?? 1);

      const results: RawProviderResult[] = [];
      let searchInformation: SerpApiSearchInformation | null = null;
      let searchMetadata: SerpApiSearchMetadata | null = null;
      const rawOrganicResults: SerpApiOrganicResult[] = [];
      let pagesFetched = 0;
      let requestParameters: Record<string, string> = {};
      let lastPageResultCount = 0;
      let paginationError: string | null = null;
      const seenPageLinks = new Set<string>();

      for (let page = 1; page <= maxPages; page += 1) {
        let data: SerpApiResponse;
        const pageParameters = buildParams((page - 1) * query.numResults);
        if (page === 1) requestParameters = Object.fromEntries(pageParameters.entries());
        pageParameters.set("api_key", options.apiKey);
        try {
          data = await fetchJson<SerpApiResponse>(
            `https://serpapi.com/search.json?${pageParameters.toString()}`,
            {},
            {
              timeoutMs: options.timeoutMs,
              retries: options.maxRetries,
              signal: opts.signal,
              fetchImpl: options.fetchImpl,
            },
          );
        } catch (error) {
          if (page === 1) throw error;
          paginationError = error instanceof Error ? error.message : String(error);
          break;
        }
        pagesFetched = page;

        if (data.error) {
          if (isEmptyResultError(data.error)) break;
          if (page === 1) throw new Error(`SerpAPI reported an error: ${data.error}`);
          paginationError = data.error;
          // Later pages failing must not lose the pages already collected.
          break;
        }

        // Capture search_information and search_metadata from first page only
        if (page === 1) {
          if (data.search_information) {
            searchInformation = data.search_information;
          }
          if (data.search_metadata) {
            searchMetadata = data.search_metadata;
          }
        }

        const pageResults = query.newsOnly ? parseNews(data) : parseOrganic(data);
        results.push(...pageResults);

        const rawPageResults = data.organic_results ?? [];
        if (!query.newsOnly) {
          rawOrganicResults.push(...rawPageResults);
          lastPageResultCount = rawPageResults.length;
          const newLinks = rawPageResults.reduce((count, item) => {
            if (!item.link || seenPageLinks.has(item.link)) return count;
            seenPageLinks.add(item.link);
            return count + 1;
          }, 0);
          if (rawPageResults.length === 0) break;
          if (query.fetchAllPages && newLinks === 0) break;
        }
        if (query.newsOnly && pageResults.length === 0) break;
      }

      return {
        results,
        searchInformation,
        searchMetadata,
        rawOrganicResults,
        requestParameters,
        pagesFetched,
        pagesRequested: Number.isFinite(maxPages) ? maxPages : null,
        pageLimitReached: !query.newsOnly && Number.isFinite(maxPages) && pagesFetched === maxPages && lastPageResultCount > 0,
        paginationError,
      };
    },
  };

  return provider;
}
