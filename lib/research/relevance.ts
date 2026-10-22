import type { ResearchResult } from "@/types";

export interface RelevanceCriteria {
  entities: string[];
  keywords: string[];
}

export interface RelevanceOutcome {
  relevant: ResearchResult[];
  dropped: ResearchResult[];
}

function score(result: ResearchResult, criteria: RelevanceCriteria): number {
  const haystack = `${result.title} ${result.contentSnippet}`.toLowerCase();
  let value = 0;
  for (const entity of criteria.entities) {
    if (haystack.includes(entity.toLowerCase())) value += 2;
  }
  for (const keyword of criteria.keywords) {
    if (haystack.includes(keyword.toLowerCase())) value += 1;
  }
  return value;
}

/**
 * Keeps results that mention the queried entity/topic. If strict filtering would
 * remove everything, the original list is returned so the model still receives
 * the retrieved evidence it can reason over.
 */
export function filterByRelevance(
  results: ResearchResult[],
  criteria: RelevanceCriteria,
): RelevanceOutcome {
  if (criteria.entities.length === 0 && criteria.keywords.length === 0) {
    return { relevant: results, dropped: [] };
  }
  const relevant: ResearchResult[] = [];
  const dropped: ResearchResult[] = [];
  for (const result of results) {
    if (score(result, criteria) > 0) relevant.push(result);
    else dropped.push(result);
  }
  if (relevant.length === 0) {
    return { relevant: results, dropped: [] };
  }
  return { relevant, dropped };
}
