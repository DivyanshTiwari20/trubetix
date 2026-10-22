import type { ResearchIntent } from "@/types";
import {
  extractEntities,
  type ResearchIntentKind,
  type ResearchMode,
  type SocialPlatform,
} from "./entities";
import type { DateRangePreset } from "./dates";

export interface ResearchPlanInput {
  question: string;
  datePreset?: DateRangePreset;
  maxQueries: number;
  /** Prior conversation turns, oldest first, used to resolve references. */
  history?: string[];
  /** Pre-extracted primary entity from Gemini (overrides heuristic extraction). */
  geminiEntity?: string | null;
  /** Other entities mentioned in the question (context only). */
  geminiMentionedEntities?: string[];
  /** Pre-extracted platform from Gemini. */
  geminiPlatform?: SocialPlatform | null;
  /** Pre-extracted days from Gemini. */
  geminiDays?: number | null;
  /** Pre-extracted intent from Gemini. */
  geminiIntent?: "volume" | "reaction" | "overview" | "show_more" | "other";
}

export interface ResearchPlan {
  intent: ResearchIntent;
  intentKind: ResearchIntentKind;
  entities: string[];
  keywords: string[];
  primaryEntity: string | null;
  subject: string | null;
  datePreset: DateRangePreset;
  queries: string[];
  mode: ResearchMode;
  platform: SocialPlatform | null;
  platforms: SocialPlatform[];
  handles: string[];
  needsClarification: boolean;
  clarification: string | null;
  usedHistory: boolean;
}

const DATE_WORDS =
  /\b(last|past|this|today|yesterday|week|weeks|month|months|day|days|24|7|30|90|hours?)\b/gi;

const INTENT_QUERY_HINTS: Record<ResearchIntent, string[]> = {
  overview: ["news", "latest updates"],
  narratives: ["latest news", "reaction OR statement"],
  change: ["latest developments", "this week"],
  risk: ["controversy OR backlash OR criticism", "reputation"],
  competitor: ["competitor OR rival OR market", "business"],
  coverage: ["media coverage", "press"],
  next_steps: ["latest news", "announcement"],
};

function mapDaysToPreset(days: number): DateRangePreset {
  if (days <= 1) return "24h";
  if (days <= 7) return "7d";
  if (days <= 30) return "30d";
  return "90d";
}

function mapGeminiIntentToKind(geminiIntent: "volume" | "reaction" | "overview" | "show_more" | "other"): ResearchIntentKind {
  switch (geminiIntent) {
    case "volume":
      return "post_count";
    case "reaction":
      return "sentiment";
    case "overview":
      return "social_listening";
    case "show_more":
      return "social_listening";
    case "other":
    default:
      return "general";
  }
}

function deriveBase(entities: string[], keywords: string[], question: string): string {
  if (entities.length > 0) return entities.join(" ");
  if (keywords.length > 0) return keywords.slice(0, 5).join(" ");
  return question.replace(DATE_WORDS, "").replace(/\s+/g, " ").trim();
}

/**
 * Builds the research plan. Social and profile requests deliberately produce no
 * generic news queries: for those modes the Instagram dorks are the retrieval
 * strategy and unrelated news must not be used to fill gap.
 */
export function buildResearchPlan(input: ResearchPlanInput): ResearchPlan {
  const extraction = extractEntities(input.question, { history: input.history });

  const geminiEntity = input.geminiEntity ?? null;
  const geminiPlatform = input.geminiPlatform ?? null;
  const geminiDays = input.geminiDays ?? null;
  const geminiIntent = input.geminiIntent ?? null;

  const hasGeminiEntity = Boolean(geminiEntity && geminiEntity.length >= 3);

  const mentionedEntities = input.geminiMentionedEntities ?? [];

  const entities = hasGeminiEntity ? [geminiEntity!, ...mentionedEntities] : extraction.entities;
  const primaryEntity = hasGeminiEntity ? geminiEntity : extraction.primaryEntity;
  const subject = hasGeminiEntity ? geminiEntity : extraction.subject;
  const platform = geminiPlatform ?? extraction.platform;
  const platforms = geminiPlatform ? [geminiPlatform] : extraction.platforms;
  const mode = hasGeminiEntity && geminiIntent !== "overview" && geminiIntent !== "show_more"
    ? geminiIntent === "volume" || geminiIntent === "reaction"
      ? "social"
      : "general"
    : extraction.mode;
  const intentKind = hasGeminiEntity && geminiIntent
    ? mapGeminiIntentToKind(geminiIntent)
    : extraction.intentKind;
  const needsClarification = hasGeminiEntity ? false : extraction.needsClarification;
  const clarification = hasGeminiEntity ? null : extraction.clarification;

  const datePreset = input.datePreset ?? extraction.datePreset ?? (geminiDays ? mapDaysToPreset(geminiDays) : "7d");
  const base = hasGeminiEntity ? geminiEntity! : deriveBase(extraction.entities, extraction.keywords, input.question);

  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (query: string) => {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(normalized);
  };

  const socialOnly = mode !== "general";

  if (!needsClarification && base.length > 0) {
    if (!socialOnly) {
      push(base);
      for (const hint of INTENT_QUERY_HINTS[extraction.intent]) {
        push(`${base} ${hint}`);
      }
      for (const hint of INTENT_QUERY_HINTS.overview) {
        push(`${base} ${hint}`);
      }
      if (primaryEntity && extraction.keywords.length > 0) {
        push(`${primaryEntity} ${extraction.keywords.slice(0, 3).join(" ")}`);
      }
    }
  }

  const limited = queries.slice(0, Math.max(0, input.maxQueries));

  return {
    intent: extraction.intent,
    intentKind,
    entities,
    keywords: extraction.keywords,
    primaryEntity,
    subject,
    datePreset,
    queries: limited,
    mode,
    platform,
    platforms,
    handles: extraction.handles,
    needsClarification,
    clarification,
    usedHistory: extraction.usedHistory,
  };
}
