import type { ResearchResult } from "@/types";
import { extractHostname } from "./canonicalize";
import { shortcodeFromUrl } from "./igDate";
import { unique } from "@/lib/utils";

export interface DedupeOutcome {
  unique: ResearchResult[];
  duplicateCount: number;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'"]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sortResults(results: ResearchResult[]): ResearchResult[] {
  return [...results].sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return new Date(b.retrievedAt).getTime() - new Date(a.retrievedAt).getTime();
  });
}

/**
 * Collapses results that resolve to the same canonical URL, or to the same
 * Instagram post shortcode reached via a different path, and flags
 * near-duplicate coverage (same story title on different hosts) as related
 * rather than independent corroboration.
 */
export function dedupeResults(results: ResearchResult[]): DedupeOutcome {
  const byUrl = new Map<string, ResearchResult>();
  let duplicateCount = 0;

  for (const result of results) {
    const shortcode = shortcodeFromUrl(result.originalUrl);
    const key = shortcode ? `instagram:${shortcode}` : result.canonicalUrl;
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...result });
      continue;
    }
    duplicateCount += 1;
    existing.relatedUrls = unique([...existing.relatedUrls, result.originalUrl]);
    existing.matchedEntities = unique([...existing.matchedEntities, ...result.matchedEntities]);
  }

  const uniqueResults = Array.from(byUrl.values());

  const byTitle = new Map<string, ResearchResult[]>();
  for (const result of uniqueResults) {
    const key = normalizeTitle(result.title);
    if (key.length < 12) continue;
    const group = byTitle.get(key) ?? [];
    group.push(result);
    byTitle.set(key, group);
  }

  for (const group of byTitle.values()) {
    const hosts = new Set(group.map((result) => extractHostname(result.originalUrl)));
    if (hosts.size < 2) continue;
    const urls = group.map((result) => result.originalUrl);
    for (const result of group) {
      result.relatedUrls = unique([
        ...result.relatedUrls,
        ...urls.filter((url) => url !== result.originalUrl),
      ]);
    }
  }

  return { unique: sortResults(uniqueResults), duplicateCount };
}
