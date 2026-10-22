import { describe, expect, it, vi } from "vitest";
import { createInstagramProfileProvider } from "./instagram";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const options = { timeoutMs: 1_000, maxRetries: 0 };

describe("createInstagramProfileProvider", () => {
  it("returns null when no key is configured", () => {
    expect(createInstagramProfileProvider({ ...options, apiKey: null })).toBeNull();
    expect(createInstagramProfileProvider({ ...options, apiKey: "  " })).toBeNull();
  });

  it("maps a SerpAPI profile response defensively", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        profile_results: {
          username: "nasa",
          full_name: "NASA",
          biography: "Exploring the universe.",
          followers: "96000000",
          following: 100,
          posts_count: 4000,
          is_verified: true,
          is_private: false,
          posts: [
            {
              shortcode: "ABC123",
              media_captions: [{ text: "A rocket launch" }],
              is_video: true,
            },
          ],
        },
      }),
    );

    const provider = createInstagramProfileProvider({ ...options, apiKey: "key", fetchImpl })!;
    const profile = await provider.fetchProfile("NASA");

    expect(profile).not.toBeNull();
    expect(profile!.username).toBe("nasa");
    expect(profile!.followers).toBe(96_000_000);
    expect(profile!.following).toBe(100);
    expect(profile!.verified).toBe(true);
    expect(profile!.url).toBe("https://www.instagram.com/nasa/");
    expect(profile!.recentPosts[0]!.url).toBe("https://www.instagram.com/p/ABC123/");
    expect(profile!.recentPosts[0]!.caption).toBe("A rocket launch");
    expect(profile!.recentPosts[0]!.likes).toBeNull();
    expect(profile!.recentPosts[0]!.comments).toBeNull();
  });

  it("returns null when the account is not resolved", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ profile_results: null }));
    const provider = createInstagramProfileProvider({ ...options, apiKey: "key", fetchImpl })!;
    expect(await provider.fetchProfile("nobody")).toBeNull();
  });

  it("returns null for an invalid handle without calling the API", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const provider = createInstagramProfileProvider({ ...options, apiKey: "key", fetchImpl })!;
    expect(await provider.fetchProfile("not a handle")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when SerpAPI reports an error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "Invalid API key" }));
    const provider = createInstagramProfileProvider({ ...options, apiKey: "key", fetchImpl })!;
    await expect(provider.fetchProfile("nasa")).rejects.toThrow("SerpAPI reported an error");
  });

  it("never invents metrics the API omits", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ profile_results: { username: "private_account", is_private: true } }),
    );
    const provider = createInstagramProfileProvider({ ...options, apiKey: "key", fetchImpl })!;
    const profile = await provider.fetchProfile("private_account");
    expect(profile!.followers).toBeNull();
    expect(profile!.following).toBeNull();
    expect(profile!.postsCount).toBeNull();
    expect(profile!.recentPosts).toEqual([]);
  });
});
