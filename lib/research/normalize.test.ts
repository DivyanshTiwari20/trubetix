import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/config";
import { normalizeProviderResult } from "./normalize";

const NOW = new Date("2026-05-10T00:00:00.000Z");
const CONTEXT = {
  queryUsed: "acme",
  entities: ["Acme"],
  retrievedAt: "2026-05-10T00:00:00.000Z",
  now: NOW,
};

describe("normalizeProviderResult", () => {
  it("canonicalizes the URL, infers source type and matches entities", () => {
    const result = normalizeProviderResult(
      {
        title: "Acme under scrutiny",
        url: "https://www.bbc.com/news/story-1?utm_source=twitter",
        snippet: "Coverage of Acme.",
        publishedAt: "2026-05-08T00:00:00.000Z",
      },
      CONTEXT,
    );

    expect(result).not.toBeNull();
    expect(result?.canonicalUrl).toBe("https://bbc.com/news/story-1");
    expect(result?.sourceType).toBe("news");
    expect(result?.platform).toBe("web");
    expect(result?.matchedEntities).toEqual(["Acme"]);
    expect(result?.publishedAt).toBe("2026-05-08T00:00:00.000Z");
  });

  it("truncates long snippets to the configured maximum", () => {
    const result = normalizeProviderResult(
      { title: "T", url: "https://example.com/a", snippet: "x".repeat(700) },
      CONTEXT,
    );
    expect(result?.contentSnippet.length).toBe(LIMITS.resultSnippetMaxLength);
  });

  it("infers social platforms from the host", () => {
    const result = normalizeProviderResult(
      { title: "T", url: "https://x.com/acme/status/1" },
      CONTEXT,
    );
    expect(result?.platform).toBe("twitter");
  });

  it("drops results with an invalid URL", () => {
    expect(normalizeProviderResult({ title: "T", url: "not a url" }, CONTEXT)).toBeNull();
    expect(normalizeProviderResult({ title: "T", url: "" }, CONTEXT)).toBeNull();
  });

  it("decodes Instagram post date from shortcode", () => {
    const result = normalizeProviderResult(
      {
        title: "Pranavi Urs wins gold",
        url: "https://www.instagram.com/p/DeP9HztE61J/",
        snippet: "Pranavi Urs wins Asian Games gold",
      },
      CONTEXT,
    );
    expect(result).not.toBeNull();
    expect(result?.platform).toBe("instagram");
    expect(result?.publishedAt?.startsWith("2026-10-08T21:59:13")).toBe(true);
    expect(result?.dateSource).toBe("shortcode");
  });

  it("parses engagement from snippet (likes, comments, username, date)", () => {
    const result = normalizeProviderResult(
      {
        title: "Pranavi Urs wins gold",
        url: "https://www.instagram.com/p/invalidshortcode/",
        snippet: "12K likes, 345 comments - golfkarnataka on October 7, 2026: Pranavi...",
      },
      CONTEXT,
    );
    expect(result).not.toBeNull();
    expect(result?.likes).toBe(12000);
    expect(result?.comments).toBe(345);
    expect(result?.username).toBe("golfkarnataka");
    expect(result?.cleanedCaption).toBe("Pranavi...");
    expect(result?.dateSource).toBe("snippet");
  });

  it("parses engagement with singular like/comment and commas", () => {
    const result = normalizeProviderResult(
      {
        title: "Test post",
        url: "https://www.instagram.com/p/DeP9HztE61J/",
        snippet: "1,234 likes, 56 comments - user123 on October 8, 2026: Great post!",
      },
      CONTEXT,
    );
    expect(result).not.toBeNull();
    expect(result?.likes).toBe(1234);
    expect(result?.comments).toBe(56);
    expect(result?.username).toBe("user123");
    expect(result?.cleanedCaption).toBe("Great post!");
  });

  it("handles missing engagement gracefully", () => {
    const result = normalizeProviderResult(
      {
        title: "Test post",
        url: "https://www.instagram.com/p/DeP9HztE61J/",
        snippet: "Just a caption without engagement info",
      },
      CONTEXT,
    );
    expect(result).not.toBeNull();
    expect(result?.likes).toBeUndefined();
    expect(result?.comments).toBeUndefined();
    expect(result?.username).toBeUndefined();
    expect(result?.cleanedCaption).toBeUndefined();
  });

  it("profile URLs are not treated as posts (no shortcode date)", () => {
    const result = normalizeProviderResult(
      {
        title: "Pranavi Urs profile",
        url: "https://www.instagram.com/pranaviurs/",
        snippet: "Official profile",
      },
      CONTEXT,
    );
    expect(result).not.toBeNull();
    expect(result?.dateSource).toBeUndefined();
  });
});
