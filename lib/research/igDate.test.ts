import { describe, expect, it } from "vitest";
import { shortcodeFromUrl, dateFromShortcode } from "./igDate";

describe("igDate", () => {
  it("extracts shortcode from Instagram URLs (preserving case)", () => {
    expect(shortcodeFromUrl("https://www.instagram.com/p/DeP9HztE61J/")).toBe("DeP9HztE61J");
    expect(shortcodeFromUrl("https://www.instagram.com/reel/DePAjuLmFyV/")).toBe("DePAjuLmFyV");
    expect(shortcodeFromUrl("https://www.instagram.com/reels/DeLvhPzE-Xk/")).toBe("DeLvhPzE-Xk");
    expect(shortcodeFromUrl("https://www.instagram.com/tv/DeJJFgqE6BK/")).toBe("DeJJFgqE6BK");
    expect(shortcodeFromUrl("https://www.instagram.com/username/p/DebYhPjDeOW/")).toBe("DebYhPjDeOW");
    expect(shortcodeFromUrl("https://www.instagram.com/profile/")).toBeNull();
  });

  it("decodes shortcode to correct UTC date (tolerance 180s)", () => {
    const cases: Array<[string, string]> = [
      ["DeP9HztE61J", "2026-10-08T21:59:13.000Z"],
      ["DePAjuLmFyV", "2026-10-08T13:10:00.000Z"],
      ["DeLvhPzE-Xk", "2026-10-07T06:43:24.000Z"],
      ["DeJJFgqE6BK", "2026-10-06T06:29:05.000Z"],
      ["DebYhPjDeOW", "2026-10-13T08:32:20.000Z"],
    ];
    for (const [sc, expected] of cases) {
      const d = dateFromShortcode(sc);
      expect(d).not.toBeNull();
      const diff = Math.abs(d!.getTime() - new Date(expected).getTime());
      expect(diff).toBeLessThanOrEqual(180_000);
    }
  });

  it("returns null for invalid shortcodes", () => {
    expect(dateFromShortcode("invalid!")).toBeNull();
    expect(dateFromShortcode("")).toBeNull();
  });
});