import { z } from "zod";

type JsonSchema = Record<string, unknown>;

const GEMINI_TYPES: Record<string, string> = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

const DROPPED_KEYS = new Set([
  "$schema",
  "additionalProperties",
  "$ref",
  "definitions",
  "$defs",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
]);

function isNullSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const type = (schema as JsonSchema).type;
  return type === "null";
}

function normalizeType(type: unknown): string | undefined {
  if (typeof type === "string") return GEMINI_TYPES[type] ?? type.toUpperCase();
  if (Array.isArray(type)) {
    const nonNull = type.filter((entry): entry is string => entry !== "null");
    if (nonNull.length === 1) return GEMINI_TYPES[nonNull[0]] ?? nonNull[0].toUpperCase();
  }
  return undefined;
}

/**
 * Converts a JSON Schema (as emitted by `z.toJSONSchema`) into the subset of
 * OpenAPI schema that Gemini's `responseSchema` accepts: uppercased types and
 * `nullable` instead of `anyOf: [{...}, {type: "null"}]`.
 */
export function jsonSchemaToGemini(input: unknown): JsonSchema {
  if (!input || typeof input !== "object") return { type: "STRING" };
  const schema = input as JsonSchema;
  const output: JsonSchema = {};

  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf as unknown[];
    const nullVariant = variants.some(isNullSchema);
    const nonNull = variants.filter((variant) => !isNullSchema(variant));
    if (nullVariant && nonNull.length === 1) {
      const converted = jsonSchemaToGemini(nonNull[0]);
      if (nonNull.length === 1) {
        return { ...converted, ...(nullVariant ? { nullable: true } : {}) };
      }
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED_KEYS.has(key)) continue;
    if (key === "type") {
      if (Array.isArray(value) && value.includes("null")) output.nullable = true;
      const type = normalizeType(value);
      if (type) output.type = type;
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      const properties: JsonSchema = {};
      for (const [propKey, propValue] of Object.entries(value as JsonSchema)) {
        properties[propKey] = jsonSchemaToGemini(propValue);
      }
      output.properties = properties;
      continue;
    }
    if (key === "items") {
      output.items = jsonSchemaToGemini(value);
      continue;
    }
    if (key === "required" && Array.isArray(value)) {
      output.required = value;
      continue;
    }
    if (key === "description" && typeof value === "string" && value.length > 0) {
      output.description = value;
      continue;
    }
    if (key === "enum" && Array.isArray(value)) {
      output.enum = value;
      continue;
    }
    if (key === "nullable" && value === true) {
      output.nullable = true;
      continue;
    }
    if (key === "propertyOrdering") {
      output.propertyOrdering = value;
    }
  }

  return output;
}

export function toGeminiSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { io: "output" }) as JsonSchema;
  return jsonSchemaToGemini(json);
}
