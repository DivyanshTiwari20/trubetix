import type { Platform, SourceType } from "@/types";

const PLATFORM_HOSTS: Array<[Platform, string[]]> = [
  ["twitter", ["twitter.com", "x.com", "t.co"]],
  ["facebook", ["facebook.com", "fb.com"]],
  ["instagram", ["instagram.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["linkedin", ["linkedin.com"]],
  ["reddit", ["reddit.com", "redd.it"]],
];

const FORUM_HOSTS = ["reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com", "discourse.org"];
const BLOG_HOSTS = ["medium.com", "substack.com", "blogspot.com", "wordpress.com", "dev.to", "ghost.io"];
const SOCIAL_HOSTS = [
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "tiktok.com",
  "threads.net",
  "threads.com",
  "facebook.com",
  "fb.com",
  "youtube.com",
  "youtu.be",
  "pinterest.com",
  "tumblr.com",
  "snapchat.com",
  "vk.com",
  "weibo.com",
];
const NEWS_HOSTS = [
  "bbc.co.uk",
  "bbc.com",
  "cnn.com",
  "reuters.com",
  "apnews.com",
  "nytimes.com",
  "theguardian.com",
  "washingtonpost.com",
  "bloomberg.com",
  "forbes.com",
  "cnbc.com",
  "theverge.com",
  "techcrunch.com",
  "wired.com",
  "ft.com",
  "wsj.com",
  "economist.com",
  "hindustantimes.com",
  "timesofindia.indiatimes.com",
  "thehindu.com",
  "indianexpress.com",
  "ndtv.com",
  "livemint.com",
  "business-standard.com",
  "news18.com",
  "firstpost.com",
];

function matchesHost(hostname: string, hosts: string[]): boolean {
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

export function inferPlatform(hostname: string | null): Platform {
  if (!hostname) return "web";
  for (const [platform, hosts] of PLATFORM_HOSTS) {
    if (matchesHost(hostname, hosts)) return platform;
  }
  return "web";
}

export function inferSourceType(hostname: string | null, pathname = ""): SourceType {
  if (!hostname) return "other";
  if (hostname.endsWith(".gov") || hostname.includes(".gov.") || hostname.endsWith(".gov.uk")) {
    return "government";
  }
  if (matchesHost(hostname, FORUM_HOSTS)) return "forum";
  if (matchesHost(hostname, BLOG_HOSTS)) return "blog";
  if (hostname.includes("blog.") || pathname.includes("/blog/")) return "blog";
  if (matchesHost(hostname, NEWS_HOSTS)) return "news";
  if (/\/(news|article|story|press-release)\//.test(pathname)) return "news";
  if (matchesHost(hostname, SOCIAL_HOSTS)) return "social";
  return "other";
}
