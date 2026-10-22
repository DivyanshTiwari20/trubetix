import { describe, expect, it, vi } from "vitest";
import type { ResolvedDateRange } from "@/types";
import { createSerpApiProvider } from "./serpapi";

const dateRange: ResolvedDateRange = {
  preset: "7d",
  from: "2026-05-01T00:00:00.000Z",
  to: "2026-05-08T00:00:00.000Z",
  label: "Last 7 days",
  timezone: "UTC",
};

function responseJson(results: number, prefix = "Result"): string {
  const organic = Array.from({ length: results }, (_, index) => ({
    title: `${prefix} ${index}`,
    link: `https://example.com/${prefix.toLowerCase()}-${index}`,
    snippet: "Snippet",
  }));
  return JSON.stringify({ organic_results: organic });
}

function makeFetch(pages: Array<{ count?: number; error?: string }>) {
  const urls: string[] = [];
  let called = 0;
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    const page = pages[called];
    called += 1;
    if (!page) return { ok: true, text: async () => "" };
    return {
      ok: true,
      text: async () =>
        page.error ? JSON.stringify({ error: page.error }) : responseJson(page.count ?? 0),
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, urls, getCalls: () => called };
}

const providerOptions = {
  apiKey: "test-key",
  timeoutMs: 1_000,
  maxRetries: 0,
};

describe("createSerpApiProvider pagination", () => {
  it("fetches the requested page count with start offsets", async () => {
    const fetch = makeFetch([{ count: 10 }, { count: 10 }, { count: 4 }]);
    const provider = createSerpApiProvider({ ...providerOptions, fetchImpl: fetch.fetchImpl });

    const results = await provider.search({ query: "site:instagram.com test", numResults: 10, dateRange, pages: 3 });

    expect(pageOffsets(fetch.urls)).toEqual([0, 10, 20]);
    expect(results.length).toBe(24);
    expect(fetch.getCalls()).toBe(3);
  });

  it("stops only when a page returns 0 results", async () => {
    const fetch = makeFetch([{ count: 10 }, { count: 2 }, { count: 0 }]);
    const provider = createSerpApiProvider({ ...providerOptions, fetchImpl: fetch.fetchImpl });

    const results = await provider.search({ query: "site:instagram.com test", numResults: 10, dateRange, pages: 5 });

    expect(fetch.getCalls()).toBe(3);
    expect(results.length).toBe(12);
  });

  it("keeps page-1 results when a later page errors", async () => {
    const fetch = makeFetch([{ count: 10 }, { error: "Invalid key" }]);
    const provider = createSerpApiProvider({ ...providerOptions, fetchImpl: fetch.fetchImpl });

    const results = await provider.search({ query: "site:instagram.com test", numResults: 10, dateRange, pages: 3 });

    expect(results.length).toBe(10);
    expect(fetch.getCalls()).toBe(2);
  });

  it("treats SerpAPI's empty-result error as an empty page, not a failure", async () => {
    const fetch = makeFetch([
      { error: "Google hasn't returned any results for this query." },
    ]);
    const provider = createSerpApiProvider({ ...providerOptions, fetchImpl: fetch.fetchImpl });

    const results = await provider.search({ query: "site:instagram.com/reel/ \"Ramayan\"", numResults: 10, dateRange, pages: 3 });

    expect(results).toEqual([]);
    // No follow-up pages after the empty result set.
    expect(fetch.getCalls()).toBe(1);
  });

  it("keeps results collected before a later empty-result error", async () => {
    const fetch = makeFetch([
      { count: 10 },
      { error: "Google hasn't returned any results for this query." },
    ]);
    const provider = createSerpApiProvider({ ...providerOptions, fetchImpl: fetch.fetchImpl });

    const results = await provider.search({ query: "site:instagram.com test", numResults: 10, dateRange, pages: 3 });

    expect(results.length).toBe(10);
    expect(fetch.getCalls()).toBe(2);
  });

  it("throws when the first page fails, and stays single-page for news", async () => {
    const fetch = makeFetch([{ error: "Missing API key" }]);
    const provider = createSerpApiProvider({ ...providerOptions, fetchImpl: fetch.fetchImpl });

    await expect(
      provider.search({ query: "test", numResults: 10, dateRange, pages: 3 }),
    ).rejects.toThrow("SerpAPI reported an error");

    await expect(
      provider.search({ query: "test", numResults: 10, dateRange, newsOnly: true, pages: 3 }),
    ).resolves.toEqual([]);
    expect(fetch.getCalls()).toBe(2);
  });
});

function pageOffsets(urls: string[]): number[] {
  return urls.map((url) => Number(new URL(url).searchParams.get("start") ?? "-1"));
}
