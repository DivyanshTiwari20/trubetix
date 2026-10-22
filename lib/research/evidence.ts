import type { PRAnalysis, ResearchResult, SourcedClaim } from "@/types";
import { unique } from "@/lib/utils";

export function buildEvidence(results: ResearchResult[], maxEvidence: number): ResearchResult[] {
  return results.slice(0, Math.max(1, maxEvidence));
}

function sanitizeIndices(indices: number[], sourceCount: number): number[] {
  return unique(indices.filter((index) => Number.isInteger(index) && index >= 1 && index <= sourceCount)).sort(
    (a, b) => a - b,
  );
}

function sanitizeClaims(claims: SourcedClaim[], sourceCount: number): SourcedClaim[] {
  return claims.map((claim) => ({
    ...claim,
    sourceIndices: sanitizeIndices(claim.sourceIndices, sourceCount),
  }));
}

export interface SourceValidationResult {
  analysis: PRAnalysis;
  warnings: string[];
}

/**
 * Drops source references that do not map to a retrieved result and reports the
 * claims that end up without any supporting source.
 */
export function validateAnalysisSources(
  analysis: PRAnalysis,
  sourceCount: number,
): SourceValidationResult {
  const narratives = sanitizeClaims(analysis.narratives, sourceCount);
  const changes = sanitizeClaims(analysis.changes, sourceCount);
  const opportunities = sanitizeClaims(analysis.opportunities, sourceCount);
  const risks = analysis.risks.map((risk) => ({
    ...risk,
    sourceIndices: sanitizeIndices(risk.sourceIndices, sourceCount),
  }));

  const verified: PRAnalysis = {
    ...analysis,
    narratives,
    changes,
    opportunities,
    risks,
  };

  const allClaims = [...narratives, ...changes, ...risks, ...opportunities];
  const unsourced = allClaims.filter((claim) => claim.sourceIndices.length === 0);

  const warnings: string[] = [];
  if (unsourced.length > 0) {
    const noun = unsourced.length === 1 ? "claim" : "claims";
    warnings.push(
      `${unsourced.length} ${noun} could not be linked to a retrieved source and are presented as interpretation.`,
    );
  }
  if (sourceCount === 0) {
    warnings.push("No usable sources were retrieved, so the briefing relies on the model's interpretation only.");
  }

  return { analysis: verified, warnings };
}
