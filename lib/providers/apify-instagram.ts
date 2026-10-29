import "server-only";
import { fetchJson } from "@/lib/http";

export interface ApifyInstagramConfig {
  apiToken: string;
  actorId: string;
  maxResults: number;
  timeoutMs: number;
}

export interface ApifyInstagramSearchInput {
  query: string;
  searchType: "hashtag" | "keyword";
  limit: number;
}

/** Runs the configured, documented Apify Instagram Hashtag Scraper once. */
export async function searchApifyInstagram(
  config: ApifyInstagramConfig,
  input: ApifyInstagramSearchInput,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const actorPath = config.actorId.replace(/\//g, "~");
  const params = new URLSearchParams({
    timeout: String(Math.max(1, Math.ceil(config.timeoutMs / 1000))),
    maxItems: String(input.limit),
    limit: String(input.limit),
    format: "json",
    clean: "true",
  });
  const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(actorPath)}/run-sync-get-dataset-items?${params.toString()}`;

  const response = await fetchJson<unknown>(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hashtags: [input.query],
        keywordSearch: input.searchType === "keyword",
        resultsType: "posts",
        resultsLimit: input.limit,
      }),
    },
    {
      timeoutMs: config.timeoutMs,
      // A failed/slow POST may already have started a paid Actor run; never auto-retry it.
      retries: 0,
      signal,
    },
  );

  if (!Array.isArray(response)) {
    throw new Error("Apify returned an unexpected dataset format.");
  }
  return response;
}
