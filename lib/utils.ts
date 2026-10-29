import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026`;
}

const LEADING_FILLER =
  /^(?:hey|hi|hello|please|kindly|can you|could you|would you|will you|i want to know|i want|i need|help me|tell me about|tell me|show me|give me|find me|find|search for|search|what's|what is|what are|who is|who are|how is|how are|how do|how does|how can|why is|why are|why do|why does|when is|when did|where is|where did|which|is there|are there)\s+/i;

const LEADING_ACTION =
  /^(?:analy[sz]e|explain|summari[sz]e|review|assess)\s+(?:the|my|our|this|these)\s+/i;

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "nor",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "with",
]);

function titleCase(value: string): string {
  const words = value.split(" ");
  return words
    .map((word, index) => {
      if (!word) return word;
      const lower = word.toLowerCase();
      const isEdge = index === 0 || index === words.length - 1;
      if (!isEdge && SMALL_WORDS.has(lower)) return lower;
      if (word.length > 1 && word === word.toUpperCase()) return word;
      return word[0]!.toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function trimToWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const sliced = value.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  const base = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
  return base.replace(/[\s,;:.!?\-–—]+$/u, "");
}

export function titleFromQuestion(question: string, max = 42): string {
  const cleaned = question
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’?!.,;:]+$/gu, "");
  if (!cleaned) return "New conversation";

  let withoutFiller = cleaned;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = withoutFiller.replace(LEADING_FILLER, "").replace(LEADING_ACTION, "");
    if (next === withoutFiller) break;
    withoutFiller = next;
  }
  const core = (withoutFiller.trim() || cleaned).replace(/[?!.,;:]+$/u, "");
  const title = trimToWord(core, max);
  return titleCase(title) || "New conversation";
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
