import { describe, expect, it } from "vitest";
import { researchMetaSchema } from "@/lib/validation/research";
import { extractSearchKeywords } from "./instagram-simple";

describe("Instagram discovery keyword extraction", () => {
  it("does not send instruction filler like Tell as a search keyword", () => {
    const keywords = extractSearchKeywords(
      "Tell me total number of posts done in last week about Salman Khan",
      "Salman Khan",
    );

    expect(keywords).toEqual([]);
  });

  it("preserves the estimate query, request parameters, and total in stored research metadata", () => {
    const estimateProvenance = {
      query: "site:instagram.com Salman Khan",
      queryDisplayed: "site:instagram.com Salman Khan",
      parameters: {
        engine: "google",
        q: "site:instagram.com Salman Khan",
        num: "10",
        hl: "en",
        gl: "us",
        google_domain: "google.com",
        tbs: "cdr:1,cd_min:10/20/2026,cd_max:10/27/2026",
        start: "0",
      },
      totalResults: 34,
    };
    const meta = researchMetaSchema.parse({
      status: "ok",
      question: "Tell me the total number of posts about Salman Khan last week",
      intent: "overview",
      dateRange: {
        from: "2026-10-19T18:30:00.000Z",
        to: "2026-10-27T18:29:59.999Z",
        label: "Oct 20, 2026 – Oct 27, 2026",
        timezone: "Asia/Kolkata",
        preset: "7d",
      },
      previousDateRange: null,
      queries: [],
      resultsRetrieved: 10,
      resultsAfterDedupe: 0,
      resultsIncluded: 0,
      undatedExcluded: 0,
      sourceTypesSearched: ["social"],
      providersSearched: ["serpapi"],
      comparisonAvailable: false,
      integrations: {
        gemini: { configured: true, model: "gemini-1.5-flash" },
        serpapi: { configured: true },
        newsapi: { configured: false },
      },
      limitations: [],
      warnings: [],
      generatedAt: "2026-10-27T12:00:00.000Z",
      instagramResults: {
        entity: "Salman Khan",
        dateRangeLabel: "Oct 20, 2026 – Oct 27, 2026",
        googleEstimatedResults: "34",
        estimateQuery: "site:instagram.com Salman Khan",
        estimateDateRange: {
          from: "2026-10-19T18:30:00.000Z",
          to: "2026-10-27T18:29:59.999Z",
          label: "Oct 20, 2026 – Oct 27, 2026",
          timezone: "Asia/Kolkata",
          preset: "7d",
        },
        estimateDateFilter: "cdr:1,cd_min:10/20/2026,cd_max:10/27/2026",
        estimateNumResults: 10,
        estimateProviderTotalResults: 34,
        estimateProvenance,
        estimateError: null,
        isCountRequest: true,
        posts: [],
      },
    });

    expect(meta.instagramResults?.estimateProvenance).toEqual(estimateProvenance);
  });
});
