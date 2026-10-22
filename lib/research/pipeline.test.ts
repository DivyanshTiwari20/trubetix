import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "@/lib/ai/gemini";
import type {
  InstagramProfile,
  InstagramProfileProvider,
  ProviderQuery,
  RawProviderResult,
  SearchProvider,
} from "@/lib/providers/types";
import type { IntegrationStatus } from "@/types";
import { makeAnalysis } from "@/tests/fixtures";
import { runResearch, type ResearchConfig } from "./pipeline";

const NOW = new Date("2026-05-10T12:00:00.000Z");

const config: ResearchConfig = { maxQueries: 3, maxResultsPerQuery: 5, maxEvidence: 10, temperature: 0.3, strictDateFilter: false };
const socialConfig: ResearchConfig = {
  ...config,
  maxInstagramQueries: 4,
  maxInstagramProfiles: 2,
  maxGooglePages: 3,
};

const integrations: IntegrationStatus = {
  gemini: { configured: true, model: "gemini-2.5-flash" },
  serpapi: { configured: true },
  newsapi: { configured: false },
};

function makeProvider(
  handler: RawProviderResult[] | ((query: ProviderQuery) => RawProviderResult[]),
  configured = true,
): SearchProvider {
  const searchImpl = async (query: ProviderQuery) => {
    return typeof handler === "function" ? handler(query) : handler;
  };
  return {
    id: "stub",
    label: "Stub",
    isConfigured: () => configured,
    async search(query) {
      return searchImpl(query);
    },
    async searchWithInfo(query) {
      const results = await searchImpl(query);
      return {
        results,
        searchInformation: { total_results: results.length, query_displayed: query.query },
        searchMetadata: { status: "Success" },
        rawOrganicResults: results.map((r) => ({
          title: r.title,
          link: r.url,
          snippet: r.snippet ?? undefined,
          source: r.source ?? undefined,
          date: r.publishedAt ?? undefined,
        })),
      };
    },
  };
}

const gemini: GeminiClient = {
  model: "stub",
  fallbackModel: null,
  async generateStructured(args) {
    // Check if this is an entity extraction call (has primaryEntity in schema)
    const schema = args.responseSchema as Record<string, unknown>;
    const properties = (schema.properties as Record<string, unknown>) || {};
    if (properties.primaryEntity && properties.mentionedEntities && properties.platform && properties.days && properties.intent) {
      // Determine platform from user content
      const userContent = args.userContent ?? "";
      const isInstagram = /instagram|insta|ig\b/i.test(userContent);
      return {
        primaryEntity: "Ramayana",
        mentionedEntities: ["Ranbir Kapoor"],
        platform: isInstagram ? "instagram" : "web",
        days: 7,
        intent: "reaction",
      };
    }

    return makeAnalysis();
  },
};

function datedResult(title: string, url: string, publishedAt = new Date(NOW.getTime() - 3_600_000)): RawProviderResult {
  return { title, url, snippet: title, publishedAt: publishedAt.toISOString() };
}

function instagramProfile(username: string): InstagramProfile {
  return {
    username,
    url: `https://www.instagram.com/${username}/`,
    fullName: "Acme",
    biography: "Official account",
    followers: 1_000,
    following: null,
    postsCount: null,
    verified: false,
    isPrivate: false,
    recentPosts: [],
  };
}

function resultFor(query: ProviderQuery): RawProviderResult {
  const from = new Date(query.dateRange.from).getTime();
  const slug = query.query.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return {
    title: `Acme Corp update ${slug}`,
    url: `https://news.test/${slug}`,
    snippet: "Acme Corp coverage.",
    publishedAt: new Date(from + 60 * 60 * 1000).toISOString(),
  };
}

describe("runResearch", () => {
  it("returns an analysed briefing when providers and the model are available", async () => {
    const provider = makeProvider((query) => [resultFor(query)]);

    const outcome = await runResearch(
      { question: "What are the latest narratives about Acme Corp?", datePreset: "7d" },
      { providers: [provider], gemini, config, integrations, now: () => NOW },
    );

    expect(outcome.status).toBe("ok");
    expect(outcome.analysis).not.toBeNull();
    expect(outcome.meta.status).toBe("ok");
    expect(outcome.sources.length).toBeGreaterThan(0);
    expect(outcome.meta.resultsIncluded).toBeGreaterThan(0);
    expect(outcome.message.length).toBeGreaterThan(0);
  });

  it("researches a comparison window for change questions", async () => {
    const provider = makeProvider((query) => [resultFor(query)]);

    const outcome = await runResearch(
      { question: "What changed in the media coverage about Acme Corp this week?" },
      { providers: [provider], gemini, config, integrations, now: () => NOW },
    );

    expect(outcome.meta.intent).toBe("change");
    expect(outcome.meta.previousDateRange).not.toBeNull();
    expect(outcome.meta.comparisonAvailable).toBe(true);
  });

  it("degrades honestly when no provider is configured", async () => {
    const outcome = await runResearch(
      { question: "Acme Corp overview", datePreset: "7d" },
      {
        providers: [makeProvider([], false)],
        gemini,
        config,
        integrations: { ...integrations, serpapi: { configured: false } },
        now: () => NOW,
      },
    );

    expect(outcome.status).toBe("degraded");
    expect(outcome.analysis).toBeNull();
    expect(outcome.message).toContain("not configured");
    expect(
      outcome.meta.limitations.some((limitation) => limitation.includes("Live retrieval is unavailable")),
    ).toBe(true);
  });

  it("degrades when no dated coverage is found", async () => {
    const outcome = await runResearch(
      { question: "Acme Corp overview", datePreset: "7d" },
      { providers: [makeProvider([])], gemini, config, integrations, now: () => NOW },
    );

    expect(outcome.status).toBe("degraded");
    expect(outcome.analysis).toBeNull();
    expect(outcome.sources).toHaveLength(0);
    expect(outcome.message).toContain("No relevant dated coverage");
  });

  it("still returns sources when the model is unavailable", async () => {
    const provider = makeProvider((query) => [resultFor(query)]);

    const outcome = await runResearch(
      { question: "Acme Corp overview", datePreset: "7d" },
      {
        providers: [provider],
        gemini: null,
        config,
        integrations: { ...integrations, gemini: { configured: false, model: "none" } },
        now: () => NOW,
      },
    );

    expect(outcome.status).toBe("degraded");
    expect(outcome.analysis).toBeNull();
    expect(outcome.sources.length).toBeGreaterThan(0);
    expect(outcome.message).toContain("AI synthesis is not configured");
  });

  it("uses Google dorks to surface Instagram posts for social listening", async () => {
    const fetchProfile = vi.fn(
      async (username: string) => instagramProfile(username),
    );
    const seenQueries: ProviderQuery[] = [];
    const instagram: InstagramProfileProvider = {
      id: "instagram",
      label: "Instagram stub",
      isConfigured: () => true,
      fetchProfile,
    };
    const provider = makeProvider((query) => {
      seenQueries.push(query);
      return query.query.includes("site:instagram.com")
        ? [datedResult("Ramayana review - Instagram", "https://www.instagram.com/p/AAA111/")]
        : [datedResult("Ramayana background coverage", "https://news.test/ramayana")];
    });

    const outcome = await runResearch(
      { question: "What are people saying about Ramayana on Instagram?", datePreset: "7d" },
      { providers: [provider], gemini, config: socialConfig, integrations, instagram, now: () => NOW },
    );

    expect(outcome.status).toBe("ok");
    expect(outcome.sources.some((source) => source.sourceType === "social")).toBe(true);
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(outcome.meta.providersSearched).not.toContain("instagram");
    const socialQueries = seenQueries.filter((query) => query.query.includes("site:instagram.com"));
    expect(socialQueries.length).toBeGreaterThan(0);
    for (const query of socialQueries) {
      expect(query.pages).toBe(3);
    }
  });

  it("does not let a flood of news override relevant social evidence", async () => {
    const provider = makeProvider((query) =>
      query.query.includes("site:instagram.com")
        ? [datedResult("Ramayana reel - Instagram", "https://www.instagram.com/reel/ZZZ/")]
        : Array.from({ length: 8 }, (_, index) =>
            datedResult(`Ramayana news ${index}`, `https://news.test/ramayana-${index}`),
          ),
    );

    const outcome = await runResearch(
      { question: "What are people reacting to about Ramayana on Instagram?", datePreset: "7d" },
      { providers: [provider], gemini, config: socialConfig, integrations, now: () => NOW },
    );

    const social = outcome.sources.filter((source) => source.sourceType === "social");
    const news = outcome.sources.filter((source) => source.sourceType !== "social");
    expect(social.length).toBeGreaterThan(0);
    expect(news.length).toBeLessThanOrEqual(4);
    expect(outcome.sources[0]!.sourceType).toBe("social");
  });

  it("drops undated social results and dated ones outside the window", async () => {
    const provider = makeProvider((query) =>
      query.query.includes("site:instagram.com")
        ? [
            datedResult(
              "Ramayana old reel",
              "https://www.instagram.com/reel/OLD/",
              new Date("2020-01-01T00:00:00.000Z"),
            ),
            datedResult("Ramayana new post", "https://www.instagram.com/p/NEW/"),
            {
              title: "Ramayana undated post",
              url: "https://www.instagram.com/p/UND/",
              snippet: "Ramayana caption",
            },
          ]
        : [],
    );

    const outcome = await runResearch(
      { question: "What are people posting about Ramayana on Instagram?", datePreset: "7d" },
      { providers: [provider], gemini, config: socialConfig, integrations, now: () => NOW },
    );

    const urls = outcome.sources.map((source) => source.originalUrl);
    expect(urls.some((url) => url.includes("/p/NEW"))).toBe(true);
    expect(urls.some((url) => url.includes("/p/UND"))).toBe(false);
    expect(urls.some((url) => url.includes("/reel/OLD"))).toBe(false);
    expect(
      outcome.meta.limitations.some((limitation) => limitation.includes("no reliable timestamp")),
    ).toBe(true);
  });

  it("degrades honestly and substitutes nothing when no social evidence is found", async () => {
    const provider = makeProvider((query) =>
      query.query.includes("site:instagram.com")
        ? []
        : [datedResult("Ramayana news", "https://news.test/ramayana")],
    );

    const outcome = await runResearch(
      { question: "What are people saying about Ramayana on Instagram?", datePreset: "7d" },
      { providers: [provider], gemini, config: socialConfig, integrations, now: () => NOW },
    );

    expect(outcome.status).toBe("degraded");
    expect(outcome.sources).toHaveLength(0);
    expect(outcome.message).toContain("No relevant Instagram");
  });

  it("uses the profile API only for explicit profile requests", async () => {
    const fetchProfile = vi.fn(
      async (username: string) => instagramProfile(username),
    );
    const instagram: InstagramProfileProvider = {
      id: "instagram",
      label: "Instagram stub",
      isConfigured: () => true,
      fetchProfile,
    };
    const provider = makeProvider(() => []);

    const outcome = await runResearch(
      { question: "Show me @ramayana's Instagram profile", datePreset: "7d" },
      { providers: [provider], gemini, config: socialConfig, integrations, instagram, now: () => NOW },
    );

    expect(fetchProfile).toHaveBeenCalledWith("ramayana", expect.anything());
    expect(outcome.sources.some((source) => source.platform === "instagram")).toBe(true);
    expect(outcome.meta.providersSearched).toContain("instagram");
  });

  it("asks for a subject instead of running generic searches on intent words", async () => {
    const provider = makeProvider(() => {
      throw new Error("no query should reach the provider");
    });

    const outcome = await runResearch(
      { question: "What's the buzz on Instagram?", datePreset: "24h" },
      { providers: [provider], gemini, config: socialConfig, integrations, now: () => NOW },
    );

    expect(outcome.status).toBe("degraded");
    expect(outcome.analysis).toBeNull();
    expect(outcome.sources).toHaveLength(0);
    expect(outcome.message).toContain("person, film, brand or event");
    expect(
      outcome.meta.limitations.some((limitation) => limitation.includes("did not identify a subject")),
    ).toBe(true);
  });

  it("rejects irrelevant Instagram results, expands queries, then reports insufficient evidence", async () => {
    const provider = makeProvider((query) =>
      query.query.includes("site:instagram.com")
        ? [
            datedResult(
              "How to get followers on Instagram fast",
              "https://www.instagram.com/tips/tricks/",
            ),
            datedResult(
              "Buy cheap Instagram likes now",
              "https://www.instagram.com/growth/",
            ),
          ]
        : [],
    );

    const outcome = await runResearch(
      { question: "What's the buzz on Instagram about Ramayana?", datePreset: "24h" },
      { providers: [provider], gemini, config: socialConfig, integrations, now: () => NOW },
    );

    expect(outcome.status).toBe("degraded");
    expect(outcome.sources).toHaveLength(0);
    expect(outcome.meta.queries.length).toBeGreaterThanOrEqual(4);
    expect(outcome.message).toContain("No relevant Instagram");
    expect(
      outcome.meta.limitations.some((limitation) =>
        limitation.includes("No relevant Instagram posts or Reels"),
      ),
    ).toBe(true);
  });

  it("keeps the displayed source list identical to the analysed evidence", async () => {
    const provider = makeProvider((query) =>
      query.query.includes("/reel/")
        ? [datedResult("Ramayana reel - Instagram", "https://www.instagram.com/reel/ZZZ/")]
        : query.query.includes("site:instagram.com")
          ? [datedResult("Ramayana post - Instagram", "https://www.instagram.com/p/QQQ111/")]
          : [],
    );

    const outcome = await runResearch(
      { question: "What's the buzz on Instagram about Ramayana?", datePreset: "7d" },
      { providers: [provider], gemini, config: socialConfig, integrations, now: () => NOW },
    );

    expect(outcome.status).toBe("ok");
    expect(outcome.meta.resultsIncluded).toBe(outcome.sources.length);
    expect(outcome.sources.length).toBeGreaterThan(0);
    for (const source of outcome.sources) {
      expect(source.canonicalUrl).toMatch(/^https:\/\//);
      expect(source.queryUsed.length).toBeGreaterThan(0);
      expect(source.retrievedAt).toBe(NOW.toISOString());
    }
    expect(outcome.sources.every((source) => source.sourceType === "social")).toBe(true);
  });

  it("keeps the briefing intact when a provider request fails", async () => {
    const provider = makeProvider((query) => {
      if (query.query.includes("/reel/")) {
        throw new Error("search backend down");
      }
      if (query.query.includes("site:instagram.com")) {
        return [datedResult("Ramayana reel - Instagram", "https://www.instagram.com/reel/ZZZ/")];
      }
      return [];
    });

    const outcome = await runResearch(
      { question: "What are people reacting to about Ramayana on Instagram?", datePreset: "7d" },
      { providers: [provider], gemini, config: socialConfig, integrations, now: () => NOW },
    );

    expect(outcome.status).toBe("ok");
    expect(outcome.sources.some((source) => source.sourceType === "social")).toBe(true);
    expect(
      outcome.meta.limitations.some((limitation) => limitation.includes("provider request")),
    ).toBe(true);
  });

  it("classifies Salman Khan Instagram query as social listening and runs targeted dorks", async () => {
    const seenQueries: ProviderQuery[] = [];
    const provider = makeProvider((query) => {
      seenQueries.push(query);
      if (query.query.includes("site:instagram.com")) {
        return [
          datedResult(
            "Salman Khan new movie announcement - Instagram",
            "https://www.instagram.com/p/SALMAN123/",
          ),
          datedResult(
            "Salman Khan fan reaction reel - Instagram",
            "https://www.instagram.com/reel/SALMAN456/",
          ),
        ];
      }
      return [];
    });

    const outcome = await runResearch(
      { question: "Tell me what's happening on Instagram about Salman Khan in the last 7 days.", datePreset: "7d" },
      { providers: [provider], gemini, config: socialConfig, integrations, now: () => NOW },
    );

    expect(outcome.status).toBe("ok");
    expect(outcome.meta.intent).toBe("overview");
    expect(outcome.sources.some((source) => source.sourceType === "social")).toBe(true);

    const socialQueries = seenQueries.filter((query) => query.query.includes("site:instagram.com"));
    expect(socialQueries.length).toBeGreaterThan(0);

    for (const query of socialQueries) {
      expect(query.query).toContain("Salman Khan");
      expect(query.query).not.toContain("buzz");
      expect(query.query).not.toContain("numbers");
    }
  });

  it("handles typo 'tll' and extracts Salman Khan as entity", async () => {
    const seenQueries: ProviderQuery[] = [];
    const geminiWithEntityExtraction: GeminiClient = {
      model: "stub",
      fallbackModel: null,
      async generateStructured(args) {
        const schema = args.responseSchema as Record<string, unknown>;
        const properties = (schema.properties as Record<string, unknown>) || {};
        if (properties.primaryEntity && properties.mentionedEntities && properties.platform && properties.days && properties.intent) {
          return {
            primaryEntity: "Salman Khan",
            mentionedEntities: [],
            platform: "instagram",
            days: 7,
            intent: "reaction",
          };
        }
        return makeAnalysis();
      },
    };
    const provider = makeProvider((query) => {
      seenQueries.push(query);
      if (query.query.includes("site:instagram.com")) {
        return [
          datedResult(
            "Salman Khan fan reaction - Instagram",
            "https://www.instagram.com/p/SALMAN789/",
          ),
        ];
      }
      return [];
    });

    const outcome = await runResearch(
      { question: "tll me what people are saying about Salman Khan on insta", datePreset: "7d" },
      { providers: [provider], gemini: geminiWithEntityExtraction, config: socialConfig, integrations, now: () => NOW },
    );

    expect(outcome.status).toBe("ok");
    expect(outcome.sources.some((source) => source.sourceType === "social")).toBe(true);

    const socialQueries = seenQueries.filter((query) => query.query.includes("site:instagram.com"));
    expect(socialQueries.length).toBeGreaterThan(0);

    for (const query of socialQueries) {
      expect(query.query).toContain("Salman Khan");
      expect(query.query).not.toContain("tll");
      expect(query.query).not.toContain("buzz");
      expect(query.query).not.toContain("numbers");
    }
  });
});
