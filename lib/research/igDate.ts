const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const RESERVED_SEGMENTS = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "about",
  "legal",
  "directory",
  "developer",
  "api",
  "web",
  "privacy",
  "terms",
]);

export const USERNAME_PATTERN = /^[A-Za-z0-9._]{1,30}$/;

export type InstagramContentKind = "post" | "reel" | "tv" | "profile" | "other" | "none";

export function instagramContentKind(rawUrl: string): InstagramContentKind {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "none";
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return "none";

  const first = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  if (!first) return "other";
  if (first === "p") return "post";
  if (first === "reel" || first === "reels") return "reel";
  if (first === "tv") return "tv";
  if (RESERVED_SEGMENTS.has(first)) return "other";
  return "profile";
}

export function shortcodeFromUrl(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[^\/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function dateFromShortcode(sc: string): Date | null {
  try {
    let id = BigInt(0);
    for (const ch of sc) {
      const i = ALPHABET.indexOf(ch);
      if (i < 0) return null;
      id = id * BigInt(64) + BigInt(i);
    }
    const timestamp = Number((id >> BigInt(23)) + BigInt(1314220021721));
    const d = new Date(timestamp);
    return d.getFullYear() >= 2012 && d.getTime() <= Date.now() + 86400000 ? d : null;
  } catch {
    return null;
  }
}