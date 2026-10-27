import "server-only";
import { fetchJson } from "@/lib/http";
import type { ProviderHttpOptions } from "./serpapi";
import type { RawProviderResult, SearchProvider } from "./types";

interface NewsApiArticle {
  title?: string | null;
  url?: string | null;
  description?: string | null;
  publishedAt?: string | null;
  source?: { name?: string | null } | null;
}

interface NewsApiResponse {
  status?: string;
  message?: string;
  articles?: NewsApiArticle[];
}

export interface NewsApiProviderOptions extends ProviderHttpOptions {
  apiKey: string;
}

export function createNewsApiProvider(options: NewsApiProviderOptions): SearchProvider {
  return {
    id: "newsapi",
    label: "NewsAPI",
    capabilities: ["news"],
    isConfigured: () => options.apiKey.trim().length > 0,
    async search(query, { signal } = {}) {
      if (!query.dateRange) throw new Error("NewsAPI requires a date range");
      const params = new URLSearchParams({
        q: query.query,
        language: "en",
        sortBy: "publishedAt",
        pageSize: String(Math.min(query.numResults, 100)),
        apiKey: options.apiKey,
      });

      const url = `https://newsapi.org/v2/everything?${params.toString()}`;
      const data = await fetchJson<NewsApiResponse>(
        url,
        {},
        {
          timeoutMs: options.timeoutMs,
          retries: options.maxRetries,
          signal,
          fetchImpl: options.fetchImpl,
        },
      );

      if (data.status !== "ok") {
        throw new Error(`NewsAPI reported an error: ${data.message ?? data.status ?? "unknown"}`);
      }

      const results: RawProviderResult[] = [];
      for (const article of data.articles ?? []) {
        if (!article.url || !article.title) continue;
        results.push({
          title: article.title,
          url: article.url,
          source: article.source?.name ?? null,
          snippet: article.description ?? null,
          publishedAt: article.publishedAt ?? null,
          platform: "news",
          sourceType: "news",
        });
      }
      return results;
    },
  };
}
