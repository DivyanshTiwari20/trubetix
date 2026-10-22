import type { PRAnalysis } from "@/types";

function bulletList(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

/**
 * Builds a plain-text digest of the structured analysis. It is stored on the
 * assistant message for copy/export and used as follow-up context in later turns.
 */
export function buildAssistantText(analysis: PRAnalysis): string {
  const lines: string[] = [analysis.executiveSummary, ""];

  if (analysis.narratives.length > 0) {
    lines.push("Major narratives", ...bulletList(analysis.narratives.map((n) => `${n.title} — ${n.detail}`)), "");
  }
  if (analysis.changes.length > 0) {
    lines.push("What changed", ...bulletList(analysis.changes.map((c) => `${c.title} — ${c.detail}`)), "");
  }
  if (analysis.whyItMatters) {
    lines.push("Why it matters", analysis.whyItMatters, "");
  }
  if (analysis.risks.length > 0) {
    lines.push(
      "Risks",
      ...bulletList(analysis.risks.map((r) => `[${r.severity}] ${r.title} — ${r.detail}`)),
      "",
    );
  }
  if (analysis.opportunities.length > 0) {
    lines.push("Opportunities", ...bulletList(analysis.opportunities.map((o) => `${o.title} — ${o.detail}`)), "");
  }
  if (analysis.recommendedActions.length > 0) {
    lines.push(
      "Recommended next actions",
      ...bulletList(analysis.recommendedActions.map((a) => `${a.action} (${a.rationale})`)),
      "",
    );
  }
  lines.push(`Confidence: ${analysis.confidence}`);
  if (analysis.limitations.length > 0) {
    lines.push("Limitations", ...bulletList(analysis.limitations));
  }
  return lines.join("\n").trim();
}
