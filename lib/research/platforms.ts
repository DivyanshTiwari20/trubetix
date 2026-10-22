import type { SocialPlatform } from "./entities";

export const SOCIAL_PLATFORM_DOMAINS: Record<SocialPlatform, readonly string[]> = {
  instagram: ["instagram.com"],
  twitter: ["twitter.com", "x.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.com"],
  youtube: ["youtube.com", "youtu.be"],
  linkedin: ["linkedin.com"],
  reddit: ["reddit.com", "redd.it"],
  threads: ["threads.net", "threads.com"],
};

export const SOCIAL_DOMAINS: readonly string[] = Array.from(
  new Set(Object.values(SOCIAL_PLATFORM_DOMAINS).flat()),
);

export function hostMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isSocialHost(hostname: string | null): boolean {
  if (!hostname) return false;
  return SOCIAL_DOMAINS.some((domain) => hostMatchesDomain(hostname, domain));
}

export function platformForHost(hostname: string | null): SocialPlatform | null {
  if (!hostname) return null;
  for (const [platform, domains] of Object.entries(SOCIAL_PLATFORM_DOMAINS) as Array<
    [SocialPlatform, readonly string[]]
  >) {
    if (domains.some((domain) => hostMatchesDomain(hostname, domain))) return platform;
  }
  return null;
}

/**
 * A result matches the requested platform when the user asked for a specific
 * platform and the host belongs to it. When no platform was named, any known
 * social host is acceptable.
 */
export function matchesRequestedPlatform(
  hostname: string | null,
  platform: SocialPlatform | null | undefined,
): boolean {
  if (!hostname) return false;
  if (!platform) return isSocialHost(hostname);
  const domains = SOCIAL_PLATFORM_DOMAINS[platform] ?? [];
  return domains.some((domain) => hostMatchesDomain(hostname, domain));
}
