import { describe, expect, it } from "vitest";
import { z } from "zod";
import { prAnalysisSchema } from "./analysis";
import { jsonSchemaToGemini, toGeminiSchema } from "./gemini-schema";

interface GeminiSchema {
  type?: string;
  nullable?: boolean;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
}

describe("toGeminiSchema", () => {
  const schema = toGeminiSchema(prAnalysisSchema) as GeminiSchema;

  it("produces an uppercase OBJECT schema", () => {
    expect(schema.type).toBe("OBJECT");
    expect(schema.properties?.executiveSummary.type).toBe("STRING");
    expect(schema.properties?.narratives.type).toBe("ARRAY");
    expect(schema.properties?.narratives.items?.type).toBe("OBJECT");
  });

  it("preserves enum constraints and required fields", () => {
    expect(schema.properties?.confidence.enum).toEqual(["low", "medium", "high"]);
    expect(schema.required).toContain("executiveSummary");
  });

  it("maps integer fields and drops unsupported keywords", () => {
    const items = schema.properties?.narratives.items;
    expect(items?.properties?.sourceIndices.items?.type).toBe("INTEGER");
    expect(items?.properties?.sourceIndices.items).not.toHaveProperty("minimum");
    expect(schema).not.toHaveProperty("additionalProperties");
    expect(schema).not.toHaveProperty("$schema");
  });

  it("converts nullable unions to nullable uppercase types", () => {
    const json = z.toJSONSchema(z.object({ note: z.string().nullable() }), { io: "output" });
    const converted = jsonSchemaToGemini(json) as GeminiSchema;
    expect(converted.properties?.note).toEqual({ type: "STRING", nullable: true });
  });
});
