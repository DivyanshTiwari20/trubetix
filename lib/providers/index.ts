import "server-only";
import { createNewsApiProvider } from "./newsapi";
import { createSerpApiProvider, type ProviderHttpOptions } from "./serpapi";
import type { SearchProvider } from "./types";

export { createInstagramProfileProvider } from "./instagram";

export interface SearchProviderFactoryOptions extends ProviderHttpOptions {
  serpApiKey: string | null;
  newsApiKey: string | null;
}

export function createSearchProviders(options: SearchProviderFactoryOptions): SearchProvider[] {
  const providers: SearchProvider[] = [];
  if (options.serpApiKey) {
    providers.push(
      createSerpApiProvider({
        apiKey: options.serpApiKey,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
        fetchImpl: options.fetchImpl,
      }),
    );
  }
  if (options.newsApiKey) {
    providers.push(
      createNewsApiProvider({
        apiKey: options.newsApiKey,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
        fetchImpl: options.fetchImpl,
      }),
    );
  }
  return providers;
}

export type {
  InstagramPost,
  InstagramProfile,
  InstagramProfileProvider,
  ProviderQuery,
  RawProviderResult,
  SearchCapability,
  SearchProvider,
} from "./types";
