import { groupForTimestamp, type ConversationGroup } from "@/lib/format";
import type { ChatMessage, Conversation, Feedback } from "@/types";

export interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  status: "idle" | "submitting";
  error: string | null;
  hydrated: boolean;
}

export const initialChatState: ChatState = {
  conversations: [],
  activeId: null,
  status: "idle",
  error: null,
  hydrated: false,
};

export type ChatAction =
  | { type: "hydrate"; conversations: Conversation[]; activeId: string | null }
  | { type: "setActive"; id: string | null }
  | { type: "createConversation"; conversation: Conversation }
  | { type: "renameConversation"; id: string; title: string; at: string }
  | { type: "togglePin"; id: string; at: string }
  | { type: "toggleArchive"; id: string; at: string }
  | { type: "deleteConversation"; id: string }
  | { type: "appendMessage"; conversationId: string; message: ChatMessage }
  | { type: "replaceMessage"; conversationId: string; message: ChatMessage }
  | {
      type: "setMessageFeedback";
      conversationId: string;
      messageId: string;
      feedback: Feedback | null;
    }
  | { type: "setStatus"; status: "idle" | "submitting" }
  | { type: "setError"; error: string | null }
  | { type: "clearAll" };

export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function mapConversation(
  state: ChatState,
  id: string,
  updater: (conversation: Conversation) => Conversation,
): ChatState {
  const conversations = state.conversations.map((conversation) =>
    conversation.id === id ? updater(conversation) : conversation,
  );
  return { ...state, conversations: sortConversations(conversations) };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        conversations: sortConversations(action.conversations),
        activeId: action.activeId,
        hydrated: true,
      };
    case "setActive":
      return { ...state, activeId: action.id, error: null };
    case "createConversation":
      return {
        ...state,
        conversations: sortConversations([action.conversation, ...state.conversations]),
        activeId: action.conversation.id,
        error: null,
      };
    case "renameConversation":
      return mapConversation(state, action.id, (conversation) => ({
        ...conversation,
        title: action.title,
        updatedAt: action.at,
      }));
    case "togglePin":
      return mapConversation(state, action.id, (conversation) => ({
        ...conversation,
        pinned: !conversation.pinned,
        updatedAt: action.at,
      }));
    case "toggleArchive":
      return mapConversation(state, action.id, (conversation) => ({
        ...conversation,
        archived: !conversation.archived,
        updatedAt: action.at,
      }));
    case "deleteConversation": {
      const conversations = state.conversations.filter(
        (conversation) => conversation.id !== action.id,
      );
      return {
        ...state,
        conversations,
        activeId: state.activeId === action.id ? null : state.activeId,
      };
    }
    case "appendMessage":
      return mapConversation(state, action.conversationId, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, action.message],
        updatedAt: action.message.createdAt,
      }));
    case "replaceMessage":
      return mapConversation(state, action.conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === action.message.id ? action.message : message,
        ),
        updatedAt: action.message.createdAt,
      }));
    case "setMessageFeedback":
      return mapConversation(state, action.conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === action.messageId ? { ...message, feedback: action.feedback } : message,
        ),
      }));
    case "setStatus":
      return { ...state, status: action.status };
    case "setError":
      return { ...state, error: action.error };
    case "clearAll":
      return { ...initialChatState, hydrated: true };
    default:
      return state;
  }
}

export function selectActiveConversation(state: ChatState): Conversation | null {
  if (!state.activeId) return null;
  return state.conversations.find((conversation) => conversation.id === state.activeId) ?? null;
}

export function matchesQuery(conversation: Conversation, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  if (conversation.title.toLowerCase().includes(needle)) return true;
  return conversation.messages.some((message) => message.content.toLowerCase().includes(needle));
}

export const CONVERSATION_GROUP_ORDER: ConversationGroup[] = [
  "Today",
  "Yesterday",
  "Previous 7 Days",
  "Previous 30 Days",
  "Older",
];

export interface ConversationGrouping {
  group: ConversationGroup;
  conversations: Conversation[];
}

export interface VisibleConversationsOptions {
  query: string;
  showArchived: boolean;
  now?: number;
}

export function groupConversations(
  conversations: Conversation[],
  options: VisibleConversationsOptions,
): ConversationGrouping[] {
  const { query, showArchived, now = Date.now() } = options;
  const filtered = conversations.filter((conversation) => {
    if (!showArchived && conversation.archived) return false;
    if (showArchived && !conversation.archived) return false;
    return matchesQuery(conversation, query);
  });

  const buckets = new Map<ConversationGroup, Conversation[]>();
  for (const conversation of filtered) {
    const group = groupForTimestamp(conversation.updatedAt, now);
    const bucket = buckets.get(group) ?? [];
    bucket.push(conversation);
    buckets.set(group, bucket);
  }

  return CONVERSATION_GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
    group,
    conversations: buckets.get(group)!,
  }));
}
