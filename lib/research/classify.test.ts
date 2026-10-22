import { describe, expect, it } from "vitest";
import { inferPlatform, inferSourceType } from "./classify";

describe("inferPlatform", () => {
  it("maps known social hosts", () => {
    expect(inferPlatform("www.instagram.com")).toBe("instagram");
    expect(inferPlatform("x.com")).toBe("twitter");
    expect(inferPlatform("youtube.com")).toBe("youtube");
  });
});

describe("inferSourceType", () => {
  it("classifies Instagram content as social", () => {
    expect(inferSourceType("www.instagram.com", "/acme/")).toBe("social");
    expect(inferSourceType("instagram.com", "/p/ABC123/")).toBe("social");
  });

  it("keeps forums and news taking precedence", () => {
    expect(inferSourceType("reddit.com", "/r/acme/")).toBe("forum");
    expect(inferSourceType("reuters.com", "/world/story/")).toBe("news");
  });

  it("falls back to other for unknown hosts", () => {
    expect(inferSourceType("example.com", "/")).toBe("other");
  });
});
