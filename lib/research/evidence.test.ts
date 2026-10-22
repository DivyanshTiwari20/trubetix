import { describe, expect, it } from "vitest";
import { buildEvidence, validateAnalysisSources } from "./evidence";
import { makeAnalysis, makeResult } from "@/tests/fixtures";

describe("buildEvidence", () => {
  it("caps the evidence list at the configured maximum", () => {
    const results = [makeResult(), makeResult(), makeResult(), makeResult()];
    expect(buildEvidence(results, 2)).toHaveLength(2);
  });

  it("always keeps at least one result", () => {
    const results = [makeResult(), makeResult()];
    expect(buildEvidence(results, 0)).toHaveLength(1);
  });
});

describe("validateAnalysisSources", () => {
  it("drops source indices that do not map to a retrieved result", () => {
    const analysis = makeAnalysis({
      narratives: [{ title: "A", detail: "d", sourceIndices: [1, 9] }],
      risks: [{ title: "R", detail: "d", severity: "high", sourceIndices: [99] }],
    });

    const { analysis: verified, warnings } = validateAnalysisSources(analysis, 1);
    expect(verified.narratives[0].sourceIndices).toEqual([1]);
    expect(verified.risks[0].sourceIndices).toEqual([]);
    expect(warnings.some((warning) => warning.includes("could not be linked"))).toBe(true);
  });

  it("deduplicates and orders valid indices", () => {
    const analysis = makeAnalysis({
      narratives: [{ title: "A", detail: "d", sourceIndices: [2, 2, 1] }],
    });
    const { analysis: verified } = validateAnalysisSources(analysis, 2);
    expect(verified.narratives[0].sourceIndices).toEqual([1, 2]);
  });

  it("warns when there are no sources at all", () => {
    const { warnings } = validateAnalysisSources(makeAnalysis(), 0);
    expect(warnings.some((warning) => warning.includes("No usable sources"))).toBe(true);
  });
});
