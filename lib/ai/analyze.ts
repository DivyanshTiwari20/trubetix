import type { PRAnalysis, ResearchIntent, ResearchResult, ResolvedDateRange } from "@/types";
import type { ResearchIntentKind, ResearchMode } from "@/lib/research/entities";
import { prAnalysisSchema, toGeminiSchema } from "@/lib/validation";
import type { GeminiClient } from "./gemini";
import { buildSystemInstruction, buildUserPrompt } from "./prompt";

export class AnalysisError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "AnalysisError";
    this.details = details;
  }
}

export interface AnalyzeInput {
  question: string;
  intent: ResearchIntent;
  intentKind: ResearchIntentKind;
  mode: ResearchMode;
  subject: string | null;
  dateRange: ResolvedDateRange;
  previousDateRange: ResolvedDateRange | null;
  sources: ResearchResult[];
}

export interface AnalyzeDeps {
  gemini: GeminiClient;
  signal?: AbortSignal;
  temperature?: number;
}

export async function analyzeWithGemini(
  input: AnalyzeInput,
  deps: AnalyzeDeps,
): Promise<PRAnalysis> {
  const raw = await deps.gemini.generateStructured({
    systemInstruction: buildSystemInstruction(input.mode, input.intentKind),
    userContent: buildUserPrompt(input),
    responseSchema: toGeminiSchema(prAnalysisSchema),
    temperature: deps.temperature,
    signal: deps.signal,
  });

  const parsed = prAnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`);
    throw new AnalysisError("The model response did not match the expected structure.", details);
  }

  return parsed.data;
}
