import { describe, expect, it } from "vitest";
import type { InstagramProfile } from "@/lib/providers/types";
import {
  buildInstagramDiscoveryQueries,
  buildSocialDiscoveryQueries,
  collectInstagramUsernames,
  extractInstagramHandles,
  extractInstagramUsername,
  formatCompactCount,
  instagramProfileToRawResult,
  normalizeInstagramUsername,
} from "./instagram";
import { instagramContentKind, shortcodeFromUrl } from "./igDate";

describe("normalizeInstagramUsername", () => {
  it("strips a leading @ and lowercases", () => {
    expect(normalizeInstagramUsername("@NASA")).toBe("nasa");
  });

  it("extracts the handle from a profile URL", () => {
    expect(normalizeInstagramUsername("https://www.instagram.com/NASA/")).toBe("nasa");
  });

  it("rejects empty, malformed and reserved values", () => {
    expect(normalizeInstagramUsername("")).toBeNull();
    expect(normalizeInstagramUsername("   ")).toBeNull();
    expect(normalizeInstagramUsername("not a handle")).toBeNull();
    expect(normalizeInstagramUsername("https://www.instagram.com/p/ABC123/")).toBeNull();
  });
});

describe("extractInstagramUsername", () => {
  it("returns the first path segment for profile URLs", () => {
    expect(extractInstagramUsername("https://instagram.com/nasa/")).toBe("nasa");
  });

  it("ignores post, reel and story URLs", () => {
    expect(extractInstagramUsername("https://www.instagram.com/p/ABC123/")).toBeNull();
    expect(extractInstagramUsername("https://www.instagram.com/reel/ABC123/")).toBeNull();
    expect(extractInstagramUsername("https://www.instagram.com/stories/nasa/123/")).toBeNull();
  });

  it("ignores non-Instagram hosts and invalid URLs", () => {
    expect(extractInstagramUsername("https://example.com/nasa")).toBeNull();
    expect(extractInstagramUsername("not a url")).toBeNull();
  });
});

describe("collectInstagramUsernames", () => {
  it("dedupes and caps the number of handles", () => {
    const results = [
      { originalUrl: "https://www.instagram.com/a/", canonicalUrl: "https://www.instagram.com/a/" },
      { originalUrl: "https://www.instagram.com/b/", canonicalUrl: "https://www.instagram.com/b/" },
      { originalUrl: "https://www.instagram.com/a/", canonicalUrl: "https://www.instagram.com/a/" },
      { originalUrl: "https://www.instagram.com/c/", canonicalUrl: "https://www.instagram.com/c/" },
    ];
    expect(collectInstagramUsernames(results, 2)).toEqual(["a", "b"]);
  });

  it("returns nothing when the limit is zero", () => {
    expect(
      collectInstagramUsernames([{ originalUrl: "https://www.instagram.com/a/", canonicalUrl: "" }], 0),
    ).toEqual([]);
  });
});

describe("buildSocialDiscoveryQueries", () => {
  it("builds a single site-scoped query for the subject with date range (from-1 to to+1 for text operators)", () => {
    const queries = buildSocialDiscoveryQueries({
      subject: "Acme Corp",
      keywords: [],
      dateRange: { from: "2026-10-17T00:00:00.000Z", to: "2026-10-20T00:00:00.000Z" },
      limit: 3,
    });
    expect(queries).toHaveLength(1);
    // Google's before: excludes that day, so we use from-1 and to+1
    expect(queries[0]).toBe('site:instagram.com "Acme Corp" after:2026-10-16 before:2026-10-21');
  });

  it("builds a single query with date range on all queries", () => {
    const queries = buildSocialDiscoveryQueries({
      subject: "Ramayana",
      entities: ["Ramayana", "Ranbir Kapoor"],
      dateRange: { from: "2026-10-17T00:00:00.000Z", to: "2026-10-20T00:00:00.000Z" },
      limit: 9,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toBe('site:instagram.com "Ramayana" after:2026-10-16 before:2026-10-21');
  });

  it("never uses intent words as the subject", () => {
    expect(
      buildSocialDiscoveryQueries({ subject: "numbers", keywords: [], limit: 3 }),
    ).toEqual([]);
    expect(
      buildSocialDiscoveryQueries({ subject: "buzz", keywords: [], limit: 3 }),
    ).toEqual([]);
    const cleaned = buildSocialDiscoveryQueries({
      subject: "Ramayana numbers",
      keywords: [],
      dateRange: { from: "2026-10-17T00:00:00.000Z", to: "2026-10-20T00:00:00.000Z" },
      limit: 3,
    });
    expect(cleaned[0]).toBe('site:instagram.com "Ramayana" after:2026-10-16 before:2026-10-21');
  });

  it("falls back to keywords when no entity is available", () => {
    const queries = buildSocialDiscoveryQueries({
      subject: "acme",
      keywords: ["acme"],
      dateRange: { from: "2026-10-17T00:00:00.000Z", to: "2026-10-20T00:00:00.000Z" },
      limit: 2,
    });
    expect(queries[0]).toBe('site:instagram.com "acme" after:2026-10-16 before:2026-10-21');
  });

  it("targets the account for profile requests with inurl syntax and date range", () => {
    const queries = buildSocialDiscoveryQueries({
      subject: null,
      handles: ["@NASA"],
      intentKind: "profile_metrics",
      dateRange: { from: "2026-10-17T00:00:00.000Z", to: "2026-10-20T00:00:00.000Z" },
      limit: 4,
    });
    expect(queries[0]).toBe("site:instagram.com/nasa after:2026-10-16 before:2026-10-21");
    expect(queries.some((query) => query.includes('inurl:/reel/'))).toBe(true);
    expect(queries.some((query) => query.includes('inurl:/p/'))).toBe(true);
  });

  it("returns nothing for profile requests without a handle", () => {
    expect(
      buildSocialDiscoveryQueries({
        subject: "Ramayana",
        handles: [],
        intentKind: "profile_metrics",
        limit: 3,
      }),
    ).toEqual([]);
  });

  it("returns empty array when no date range provided for non-profile requests", () => {
    const queries = buildSocialDiscoveryQueries({
      subject: "Vinayak Kapoor",
      entities: ["Vinayak Kapoor"],
      keywords: ["ramayan", "vinayak", "kapoor", "posted", "content"],
      limit: 10,
    });
    expect(queries).toEqual([]);
  });

  it("returns empty array when no date range provided for non-profile requests (variant)", () => {
    const queries = buildSocialDiscoveryQueries({
      subject: "Ramayana",
      entities: ["Ramayana"],
      keywords: [],
      limit: 10,
    });
    expect(queries).toEqual([]);
  });

  it("returns nothing for non-Instagram platforms or a zero limit", () => {
    expect(
      buildSocialDiscoveryQueries({
        subject: "Acme",
        platforms: ["tiktok"],
        limit: 3,
      }),
    ).toEqual([]);
    expect(buildSocialDiscoveryQueries({ subject: "Acme", limit: 0 })).toEqual([]);
  });

  it("keeps the legacy alias working with new query format", () => {
    expect(
      buildInstagramDiscoveryQueries({ subject: "Acme Corp", keywords: [], dateRange: { from: "2026-10-17T00:00:00.000Z", to: "2026-10-20T00:00:00.000Z" }, limit: 1 }),
    ).toEqual(['site:instagram.com "Acme Corp" after:2026-10-16 before:2026-10-21']);
  });
});

describe("shortcodeFromUrl", () => {
  it("is stable across post, reel and reels paths (preserves case)", () => {
    expect(shortcodeFromUrl("https://www.instagram.com/p/ABC123/")).toBe("ABC123");
    expect(shortcodeFromUrl("https://www.instagram.com/reel/ABC123/")).toBe("ABC123");
    expect(shortcodeFromUrl("https://www.instagram.com/reels/CXY987rr2/")).toBe("CXY987rr2");
  });

  it("returns null for profiles and non-Instagram URLs", () => {
    expect(shortcodeFromUrl("https://www.instagram.com/nasa/")).toBeNull();
    expect(shortcodeFromUrl("https://example.com/p/ABC123/")).toBeNull();
  });
});

describe("instagramContentKind", () => {
  it("identifies posts, reels and profiles", () => {
    expect(instagramContentKind("https://www.instagram.com/p/ABC123/")).toBe("post");
    expect(instagramContentKind("https://www.instagram.com/reel/ABC123/")).toBe("reel");
    expect(instagramContentKind("https://www.instagram.com/nasa/")).toBe("profile");
    expect(instagramContentKind("https://www.instagram.com/explore/tags/x/")).toBe("other");
    expect(instagramContentKind("https://example.com/nasa/")).toBe("none");
  });
});

describe("extractInstagramHandles", () => {
  it("extracts @mentions and pasted profile URLs", () => {
    const handles = extractInstagramHandles(
      "Show me @nasa and https://www.instagram.com/spacex/ profiles please",
    );
    expect(handles).toContain("nasa");
    expect(handles).toContain("spacex");
  });

  it("ignores post URLs and reserved paths", () => {
    expect(extractInstagramHandles("https://www.instagram.com/p/ABC123/")).toEqual([]);
    expect(extractInstagramHandles("see @explore")).toEqual([]);
  });
});

describe("formatCompactCount", () => {
  it("formats thousands and millions compactly", () => {
    expect(formatCompactCount(999)).toBe("999");
    expect(formatCompactCount(1500)).toBe("1.5K");
    expect(formatCompactCount(1_000_000)).toBe("1M");
  });
});

describe("instagramProfileToRawResult", () => {
  const profile: InstagramProfile = {
    username: "acme",
    url: "https://www.instagram.com/acme/",
    fullName: "Acme",
    biography: "Official",
    followers: 12_500,
    following: null,
    postsCount: 40,
    verified: true,
    isPrivate: false,
    recentPosts: [
      {
        url: "https://www.instagram.com/p/ABC/",
        shortcode: "ABC",
        caption: "Launch day",
        isVideo: true,
        likes: null,
        comments: null,
        publishedAt: null,
      },
    ],
  };

  it("marks the result as Instagram social context", () => {
    const result = instagramProfileToRawResult(profile);
    expect(result.platform).toBe("instagram");
    expect(result.sourceType).toBe("social");
    expect(result.url).toBe("https://www.instagram.com/acme/");
  });

  it("includes known metrics and never fabricates unknown ones", () => {
    const result = instagramProfileToRawResult(profile);
    expect(result.snippet).toContain("12.5K followers");
    expect(result.snippet).toContain("verified");
    expect(result.snippet).toContain("Launch day");
    expect(result.snippet).not.toContain("likes");
    expect(result.publishedAt).toBeNull();
  });
});