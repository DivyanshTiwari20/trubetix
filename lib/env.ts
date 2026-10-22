import "server-only";
import { z } from "zod";
import { RESEARCH_DEFAULTS } from "@/lib/config";
import { integrationStatusSchema } from "@/lib/validation/research";

export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export interface ResearchConfig {
  maxQueries: number;
  maxResultsPerQuery: number;
  maxEvidence: number;
  maxInstagramQueries: number;
  maxInstagramProfiles: number;
  maxGooglePages: number;
  maxSerpApiSearches: number;
  timeoutMs: number;
  maxRetries: number;
  temperature: number;
  strictDateFilter: boolean;
  instagramSimple: boolean;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  useVertex: boolean;
  vertexProject: string | null;
  vertexRegion: string | null;
  fallbackModel: string | null;
  temperature: number;
}

function readString(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = readString(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function readFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = readString(name);
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

let researchConfigCache: ResearchConfig | null = null;

export function getResearchConfig(): ResearchConfig {
  if (researchConfigCache) return researchConfigCache;
  researchConfigCache = {
    maxQueries: readInt("TUBITEX_MAX_QUERIES", RESEARCH_DEFAULTS.maxQueries, 1, 12),
    maxResultsPerQuery: readInt(
      "TUBITEX_MAX_RESULTS_PER_QUERY",
      RESEARCH_DEFAULTS.maxResultsPerQuery,
      1,
      20,
    ),
    maxEvidence: readInt("TUBITEX_MAX_EVIDENCE", RESEARCH_DEFAULTS.maxEvidence, 1, 50),
    maxInstagramQueries: readInt(
      "TUBITEX_MAX_INSTAGRAM_QUERIES",
      RESEARCH_DEFAULTS.maxInstagramQueries,
      0,
      8,
    ),
    maxInstagramProfiles: readInt(
      "TUBITEX_MAX_INSTAGRAM_PROFILES",
      RESEARCH_DEFAULTS.maxInstagramProfiles,
      0,
      5,
    ),
    maxGooglePages: readInt(
      "TUBITEX_MAX_GOOGLE_PAGES",
      RESEARCH_DEFAULTS.maxGooglePages,
      1,
      10,
    ),
    maxSerpApiSearches: readInt(
      "TUBITEX_MAX_SERPAPI_SEARCHES",
      RESEARCH_DEFAULTS.maxSerpApiSearches,
      1,
      30,
    ),
    timeoutMs: readInt("TUBITEX_TIMEOUT_MS", RESEARCH_DEFAULTS.timeoutMs, 1_000, 180_000),
    maxRetries: readInt("TUBITEX_MAX_RETRIES", RESEARCH_DEFAULTS.maxRetries, 0, 5),
    temperature: readFloat("GEMINI_TEMPERATURE", RESEARCH_DEFAULTS.temperature, 0.0, 1.0),
    strictDateFilter: readString("TUBITEX_STRICT_DATE_FILTER") === "true",
    instagramSimple: readString("INSTAGRAM_SIMPLE") !== "false",
  };
  return researchConfigCache!;
}

export function getGeminiConfig(): GeminiConfig | null {
  const apiKey = readString("GEMINI_API_KEY");
  if (!apiKey) return null;
  const useVertex = readString("GEMINI_USE_VERTEX") === "true";
  return {
    apiKey,
    model: readString("GEMINI_MODEL") ?? "gemini-1.5-flash",
    useVertex,
    vertexProject: useVertex ? readString("GEMINI_VERTEX_PROJECT") ?? null : null,
    vertexRegion: useVertex ? readString("GEMINI_VERTEX_REGION") ?? "us-central1" : null,
    fallbackModel: readString("GEMINI_FALLBACK_MODEL") ?? null,
    temperature: readFloat("GEMINI_TEMPERATURE", 0.3, 0.0, 1.0),
  };
}

export function getSerpApiKey(): string | null {
  return readString("SERPAPI_API_KEY") ?? null;
}

export function getNewsApiKey(): string | null {
  return readString("NEWSAPI_API_KEY") ?? null;
}

export function getIntegrationStatus(): IntegrationStatus {
  const gemini = getGeminiConfig();
  return {
    gemini: {
      configured: gemini !== null,
      model: gemini?.model ?? "gemini-1.5-flash",
      useVertex: gemini?.useVertex ?? false,
      vertexProject: gemini?.vertexProject ?? null,
      vertexRegion: gemini?.vertexRegion ?? null,
    },
    serpapi: { configured: getSerpApiKey() !== null },
    newsapi: { configured: getNewsApiKey() !== null },
  };
}