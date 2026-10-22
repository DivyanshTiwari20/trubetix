import type { ChatMessage, Conversation, PRAnalysis, ResearchResult } from "@/types";

let counter = 0;

export function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  counter += 1;
  return {
    id: `message-${counter}`,
    role: "user",
    content: "Hello",
    createdAt: "2026-05-09T10:00:00.000Z",
    status: "complete",
    analysis: null,
    sources: [],
    meta: null,
    error: null,
    feedback: null,
    ...overrides,
  };
}

export function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  counter += 1;
  return {
    id: `conversation-${counter}`,
    title: "Conversation",
    createdAt: "2026-05-09T10:00:00.000Z",
    updatedAt: "2026-05-09T10:00:00.000Z",
    pinned: false,
    archived: false,
    messages: [],
    ...overrides,
  };
}

export function makeResult(overrides: Partial<ResearchResult> = {}): ResearchResult {
  counter += 1;
  const url = overrides.originalUrl ?? `https://example.com/article-${counter}`;
  return {
    title: `Example article ${counter}`,
    canonicalUrl: url,
    originalUrl: url,
    sourceName: "Example",
    sourceType: "news",
    platform: "web",
    publishedAt: "2026-05-09T10:00:00.000Z",
    retrievedAt: "2026-05-10T12:00:00.000Z",
    contentSnippet: "Snippet",
    matchedEntities: [],
    queryUsed: "query",
    relatedUrls: [],
    ...overrides,
  };
}

export function makeAnalysis(overrides: Partial<PRAnalysis> = {}): PRAnalysis {
  return {
    executiveSummary: "Summary",
    narratives: [{ title: "Narrative", detail: "Detail", sourceIndices: [1] }],
    changes: [],
    whyItMatters: "It matters.",
    risks: [{ title: "Risk", detail: "Detail", severity: "medium", sourceIndices: [1] }],
    opportunities: [],
    recommendedActions: [{ action: "Do a thing", rationale: "Because." }],
    confidence: "medium",
    limitations: [],
    ...overrides,
  };
}
