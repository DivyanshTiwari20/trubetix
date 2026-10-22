import { describe, expect, it } from "vitest";
import { dedupeResults } from "./dedupe";
import { makeResult } from "@/tests/fixtures";

describe("dedupeResults", () => {
  it("collapses results that share a canonical URL", () => {
    const first = makeResult({
      originalUrl: "https://news.test/story?utm_source=x",
      canonicalUrl: "https://news.test/story",
    });
    const second = makeResult({
      originalUrl: "https://news.test/story",
      canonicalUrl: "https://news.test/story",
      matchedEntities: ["Acme"],
    });

    const outcome = dedupeResults([first, second]);
    expect(outcome.unique).toHaveLength(1);
    expect(outcome.duplicateCount).toBe(1);
    expect(outcome.unique[0].relatedUrls).toContain(second.originalUrl);
    expect(outcome.unique[0].matchedEntities).toContain("Acme");
  });

  it("collapses the same Instagram post found through different path variants", () => {
    const post = makeResult({
      title: "Ramayana trailer reaction",
      originalUrl: "https://www.instagram.com/p/ABC123/",
      canonicalUrl: "https://www.instagram.com/p/ABC123/",
    });
    const reel = makeResult({
      title: "Ramayana trailer reaction reels",
      originalUrl: "https://www.instagram.com/reel/ABC123/",
      canonicalUrl: "https://www.instagram.com/reel/ABC123/",
    });

    const outcome = dedupeResults([post, reel]);
    expect(outcome.unique).toHaveLength(1);
    expect(outcome.duplicateCount).toBe(1);
    expect(outcome.unique[0].relatedUrls).toContain("https://www.instagram.com/reel/ABC123/");
  });

  it("keeps the same story on different hosts but links them as related", () => {
    const title = "Acme Faces Backlash Over New Pricing";
    const a = makeResult({ title, originalUrl: "https://a.test/x", canonicalUrl: "https://a.test/x" });
    const b = makeResult({ title, originalUrl: "https://b.test/y", canonicalUrl: "https://b.test/y" });

    const outcome = dedupeResults([a, b]);
    expect(outcome.unique).toHaveLength(2);
    expect(outcome.unique[0].relatedUrls).toContain("https://b.test/y");
    expect(outcome.unique[1].relatedUrls).toContain("https://a.test/x");
  });

  it("sorts by publication date, most recent first", () => {
    const older = makeResult({ publishedAt: "2026-05-01T00:00:00.000Z" });
    const newer = makeResult({ publishedAt: "2026-05-09T00:00:00.000Z" });
    const undated = makeResult({ publishedAt: null });

    const outcome = dedupeResults([older, newer, undated]);
    expect(outcome.unique.map((result) => result.publishedAt)).toEqual([
      "2026-05-09T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z",
      null,
    ]);
  });
});
