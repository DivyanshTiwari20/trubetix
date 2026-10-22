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
}

interface SerpApiSearchInformation {
  total_results?: number | string;
  search_time?: number;
  query_displayed?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  news_results?: SerpApiNewsResult[];
  search_information?: SerpApiSearchInformation;
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

const PAGE_HARD_CAP = 10;

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
  rawOrganicResults: SerpApiOrganicResult[];
}

export function createSerpApiProvider(options: SerpApiProviderOptions): SearchProvider & {
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
      const buildUrl = (start: number) => {
        const params = new URLSearchParams({
          engine: "google",
          q: query.query,
          api_key: options.apiKey,
          num: String(query.numResults),
          hl: "en",
          gl: "us",
          google_domain: "google.com",
          tbs: toSerpApiTbsApp(query.dateRange),
          start: String(start),
        });
        if (query.newsOnly) params.set("tbm", "nws");

        return `https://serpapi.com/search.json?${params.toString()}`;
      };

      // Pagination is for organic discovery (site-scoped social listening).
      // News stays on one page because the news cap is applied upstream.
      const maxPages = query.newsOnly
        ? 1
        : Math.max(1, Math.min(query.pages ?? 1, PAGE_HARD_CAP));

      const results: RawProviderResult[] = [];
      let searchInformation: SerpApiSearchInformation | null = null;
      const rawOrganicResults: SerpApiOrganicResult[] = [];

      for (let page = 1; page <= maxPages; page += 1) {
        const data = await fetchJson<SerpApiResponse>(
          buildUrl((page - 1) * query.numResults),
          {},
          {
            timeoutMs: options.timeoutMs,
            retries: options.maxRetries,
            signal: opts.signal,
            fetchImpl: options.fetchImpl,
          },
        );

        if (data.error) {
          if (isEmptyResultError(data.error)) break;
          if (page === 1) throw new Error(`SerpAPI reported an error: ${data.error}`);
          // Later pages failing must not lose the pages already collected.
          break;
        }

        // Capture search_information from first page only
        if (page === 1 && data.search_information) {
          searchInformation = data.search_information;
        }

        const pageResults = query.newsOnly ? parseNews(data) : parseOrganic(data);
        results.push(...pageResults);

        if (!query.newsOnly && data.organic_results) {
          rawOrganicResults.push(...data.organic_results);
        }

        // Stop only when a page returns 0 organic results (result set exhausted).
        // Use raw organic_results, not filtered pageResults, to avoid stopping
        // early when some results lack link/title.
        if (!query.newsOnly && data.organic_results && data.organic_results.length === 0) break;
        if (query.newsOnly && pageResults.length === 0) break;
      }

      return { results, searchInformation, rawOrganicResults };
    },
  };

  return provider;
}
