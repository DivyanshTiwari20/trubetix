import { LIMITS } from "@/lib/config";
import { createId } from "@/lib/id";
import { titleFromQuestion, truncate } from "@/lib/utils";
import type { ChatMessage, Conversation, HistoryTurn } from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

export function createConversation(question: string, at: string = nowIso()): Conversation {
  return {
    id: createId("conv"),
    title: titleFromQuestion(question),
    createdAt: at,
    updatedAt: at,
    pinned: false,
    archived: false,
    messages: [],
  };
}

export function createUserMessage(content: string, at: string = nowIso()): ChatMessage {
  return {
    id: createId("msg"),
    role: "user",
    content,
    createdAt: at,
    status: "complete",
    analysis: null,
    sources: [],
    meta: null,
    error: null,
    feedback: null,
  };
}

export function createErrorMessage(
  content: string,
  error: string,
  at: string = nowIso(),
): ChatMessage {
  return {
    id: createId("msg"),
    role: "assistant",
    content,
    createdAt: at,
    status: "error",
    analysis: null,
    sources: [],
    meta: null,
    error,
    feedback: null,
  };
}

/**
 * Builds a bounded conversation history for follow-up context. Only completed
 * assistant messages and user messages are included.
 */
export function buildHistory(messages: ChatMessage[], upToIndex?: number): HistoryTurn[] {
  const slice = upToIndex === undefined ? messages : messages.slice(0, upToIndex);
  return slice
    .filter((message) => {
      if (message.role === "user") return true;
      return message.status === "complete" && message.content.trim().length > 0;
    })
    .map((message) => ({
      role: message.role,
      content: truncate(message.content, LIMITS.maxHistoryMessageLength),
    }))
    .slice(-LIMITS.maxHistoryMessages);
}
