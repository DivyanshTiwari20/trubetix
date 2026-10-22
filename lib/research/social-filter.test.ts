import { describe, expect, it } from "vitest";
import { makeResult } from "@/tests/fixtures";
import { filterSocialResults, isRelevantSocialResult } from "./social-filter";

const criteria = { entities: ["Ramayana", "Ranbir Kapoor"], keywords: ["ramayana"] };

function igPost(overrides: Parameters<typeof makeResult>[0] = {}) {
  return makeResult({
    title: "Ramayana new poster - Instagram",
    originalUrl: "https://www.instagram.com/p/ABC123/",
    canonicalUrl: "https://www.instagram.com/p/ABC123/",
    sourceType: "social",
    platform: "instagram",
    contentSnippet: "A new Ramayana poster featuring Ranbir Kapoor.",
    ...overrides,
  });
}

describe("isRelevantSocialResult", () => {
  it("keeps an Instagram post that mentions the subject", () => {
    expect(isRelevantSocialResult(igPost(), criteria)).toBe(true);
  });

  it("rejects an unrelated Instagram profile", () => {
    const unrelated = igPost({
      title: "Yoga Studio - Instagram",
      originalUrl: "https://www.instagram.com/yogastudio/",
      canonicalUrl: "https://www.instagram.com/yogastudio/",
      contentSnippet: "",
    });
    expect(isRelevantSocialResult(unrelated, criteria)).toBe(false);
  });

  it("keeps a relevant profile only when it has a usable snippet", () => {
    const relevant = igPost({
      title: "Ramayana (@ramayana) - Instagram",
      originalUrl: "https://www.instagram.com/ramayana/",
      canonicalUrl: "https://www.instagram.com/ramayana/",
      contentSnippet: "120K followers, 300 posts - official Ramayana film account.",
    });
    expect(isRelevantSocialResult(relevant, criteria)).toBe(true);

    const thin = igPost({
      title: "Ramayana (@ramayana) - Instagram",
      originalUrl: "https://www.instagram.com/ramayana/",
      canonicalUrl: "https://www.instagram.com/ramayana/",
      contentSnippet: "",
    });
    expect(isRelevantSocialResult(thin, criteria)).toBe(false);
  });

  it("rejects follower-boosting and tutorial pages", () => {
    const spam = igPost({
      title: "Ramayana growth",
      contentSnippet: "Buy cheap Instagram followers and likes now.",
    });
    expect(isRelevantSocialResult(spam, criteria)).toBe(false);

    const tutorial = igPost({
      title: "Ramayana",
      contentSnippet: "How to get more followers on Instagram fast.",
    });
    expect(isRelevantSocialResult(tutorial, criteria)).toBe(false);
  });

  it("rejects non-social hosts and reserved Instagram paths", () => {
    expect(
      isRelevantSocialResult(
        igPost({ originalUrl: "https://example.com/ramayana", canonicalUrl: "https://example.com/ramayana" }),
        criteria,
      ),
    ).toBe(false);

    expect(
      isRelevantSocialResult(
        igPost({
          originalUrl: "https://www.instagram.com/explore/tags/ramayana/",
          canonicalUrl: "https://www.instagram.com/explore/tags/ramayana/",
        }),
        criteria,
      ),
    ).toBe(false);
  });

  it("rejects Facebook pages as Instagram evidence when Instagram is the only platform", () => {
    const facebook = igPost({
      title: "Ramayana Fans - Public Facebook page",
      originalUrl: "https://www.facebook.com/ramayanafans/",
      canonicalUrl: "https://www.facebook.com/ramayanafans/",
      contentSnippet: "Fan page talking about Ramayana and Ranbir Kapoor.",
    });
    expect(isRelevantSocialResult(facebook, { ...criteria, instagramOnly: true })).toBe(false);
  });

  it("rejects syndicated galleries that only repeat a matching keyword", () => {
    const syndicated = igPost({
      title: "See all posts tagged Ramayana",
      originalUrl: "https://www.instagram.com/explore/tags/ramayana/",
      canonicalUrl: "https://www.instagram.com/explore/tags/ramayana/",
      contentSnippet: "Browse every Ramayana upload by date.",
    });
    expect(isRelevantSocialResult(syndicated, criteria)).toBe(false);
  });

  it("rejects a post that does not mention the subject", () => {
    expect(
      isRelevantSocialResult(igPost({ title: "Sunset vibes", contentSnippet: "Golden hour." }), criteria),
    ).toBe(false);
  });
});

describe("filterSocialResults", () => {
  it("partitions kept and dropped results", () => {
    const outcome = filterSocialResults(
      [
        igPost(),
        igPost({
          title: "Ramayana tutorial",
          contentSnippet: "Instagram tips and tricks for followers.",
        }),
      ],
      criteria,
    );
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.dropped).toHaveLength(1);
  });
});
