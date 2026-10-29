"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { requestResearch, ChatRequestError } from "@/lib/chat/client";
import {
  buildHistory,
  createConversation,
  createErrorMessage,
  createUserMessage,
} from "@/lib/chat/factory";
import {
  chatReducer,
  initialChatState,
  selectActiveConversation,
  type ChatState,
} from "@/lib/chat/reducer";
import { STORAGE_KEYS } from "@/lib/config";
import { useStoredString } from "@/lib/hooks/use-stored-state";
import { conversationStore } from "@/lib/storage/conversation-store";
import { readString, removeKey, writeString } from "@/lib/storage/preferences";
import type { Conversation, DatePreset, Feedback, HistoryTurn, SearchMode } from "@/types";

const VALID_PRESETS: DatePreset[] = ["24h", "7d", "30d", "90d", "custom"];
const VALID_SEARCH_MODES: SearchMode[] = ["google", "deep"];

function isDatePreset(value: string | null): value is DatePreset {
  return value !== null && (VALID_PRESETS as string[]).includes(value);
}

function isSearchMode(value: string | null): value is SearchMode {
  return value !== null && (VALID_SEARCH_MODES as string[]).includes(value);
}

interface ChatContextValue {
  hydrated: boolean;
  state: ChatState;
  activeConversation: Conversation | null;
  isGenerating: boolean;
  datePreset: DatePreset;
  setDatePreset: (preset: DatePreset) => void;
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  toggleArchive: (id: string) => void;
  deleteConversation: (id: string) => void;
  clearAll: () => void;
  sendMessage: (text: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  stopGeneration: () => void;
  setFeedback: (messageId: string, feedback: Feedback | null) => void;
  clearError: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function nowIso(): string {
  return new Date().toISOString();
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [storedPreset, setStoredPreset] = useStoredString(STORAGE_KEYS.datePreset, "7d");
  const datePreset: DatePreset = isDatePreset(storedPreset) ? storedPreset : "7d";
  const [storedSearchMode, setStoredSearchMode] = useStoredString(STORAGE_KEYS.searchMode, "google");
  const searchMode: SearchMode = isSearchMode(storedSearchMode) ? storedSearchMode : "google";

  const stateRef = useRef(state);
  const datePresetRef = useRef(datePreset);
  const searchModeRef = useRef(searchMode);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    datePresetRef.current = datePreset;
  }, [datePreset]);

  useEffect(() => {
    searchModeRef.current = searchMode;
  }, [searchMode]);

  useEffect(() => {
    const conversations = conversationStore.load();
    const storedActive = readString(STORAGE_KEYS.activeConversation);
    const activeId =
      storedActive && conversations.some((conversation) => conversation.id === storedActive)
        ? storedActive
        : (conversations[0]?.id ?? null);
    dispatch({ type: "hydrate", conversations, activeId });
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    conversationStore.save(state.conversations);
  }, [state.hydrated, state.conversations]);

  useEffect(() => {
    if (!state.hydrated) return;
    if (state.activeId) writeString(STORAGE_KEYS.activeConversation, state.activeId);
    else removeKey(STORAGE_KEYS.activeConversation);
  }, [state.hydrated, state.activeId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const setDatePreset = useCallback(
    (preset: DatePreset) => {
      setStoredPreset(preset);
    },
    [setStoredPreset],
  );

  const setSearchMode = useCallback(
    (mode: SearchMode) => {
      searchModeRef.current = mode;
      setStoredSearchMode(mode);
    },
    [setStoredSearchMode],
  );

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "setActive", id: null });
  }, []);

  const selectConversation = useCallback((id: string) => {
    abortRef.current?.abort();
    dispatch({ type: "setActive", id });
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    dispatch({ type: "renameConversation", id, title: trimmed, at: nowIso() });
  }, []);

  const togglePin = useCallback((id: string) => {
    dispatch({ type: "togglePin", id, at: nowIso() });
  }, []);

  const toggleArchive = useCallback((id: string) => {
    dispatch({ type: "toggleArchive", id, at: nowIso() });
  }, []);

  const deleteConversation = useCallback((id: string) => {
    dispatch({ type: "deleteConversation", id });
  }, []);

  const clearAll = useCallback(() => {
    abortRef.current?.abort();
    conversationStore.clear();
    dispatch({ type: "clearAll" });
  }, []);

  const setFeedback = useCallback((messageId: string, feedback: Feedback | null) => {
    const conversationId = stateRef.current.activeId;
    if (!conversationId) return;
    dispatch({ type: "setMessageFeedback", conversationId, messageId, feedback });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "setError", error: null });
  }, []);

  const runResearch = useCallback(
    async (
      conversationId: string,
      question: string,
      options: { history: HistoryTurn[]; replaceMessageId?: string },
    ) => {
      dispatch({ type: "setStatus", status: "submitting" });
      dispatch({ type: "setError", error: null });

      const controller = new AbortController();
      abortRef.current = controller;
      const { replaceMessageId } = options;

      try {
        const response = await requestResearch(
          {
            message: question,
            conversationId,
            history: options.history,
            dateRange: { preset: datePresetRef.current },
            searchMode: searchModeRef.current,
          },
          { signal: controller.signal },
        );

        const message = replaceMessageId
          ? { ...response.message, id: replaceMessageId }
          : response.message;

        dispatch(
          replaceMessageId
            ? { type: "replaceMessage", conversationId, message }
            : { type: "appendMessage", conversationId, message },
        );
      } catch (error) {
        if (controller.signal.aborted) {
          const stopped = createErrorMessage(
            "Generation stopped.",
            "Generation stopped by the user.",
          );
          const message = replaceMessageId ? { ...stopped, id: replaceMessageId } : stopped;
          dispatch(
            replaceMessageId
              ? { type: "replaceMessage", conversationId, message }
              : { type: "appendMessage", conversationId, message },
          );
        } else {
          const detail =
            error instanceof ChatRequestError
              ? error.message
              : "Something went wrong while researching. Please try again.";
          const message = createErrorMessage(detail, error instanceof Error ? error.message : detail);
          const finalMessage = replaceMessageId ? { ...message, id: replaceMessageId } : message;
          dispatch(
            replaceMessageId
              ? { type: "replaceMessage", conversationId, message: finalMessage }
              : { type: "appendMessage", conversationId, message: finalMessage },
          );
          dispatch({ type: "setError", error: detail });
        }
      } finally {
        abortRef.current = null;
        dispatch({ type: "setStatus", status: "idle" });
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const current = stateRef.current;
      if (!trimmed || current.status === "submitting") return;

      let conversationId = current.activeId;
      const existing = conversationId
        ? current.conversations.find((conversation) => conversation.id === conversationId)
        : undefined;

      const history = existing ? buildHistory(existing.messages) : [];

      if (!conversationId || !existing) {
        const conversation = createConversation(trimmed);
        conversationId = conversation.id;
        dispatch({ type: "createConversation", conversation });
      }

      dispatch({
        type: "appendMessage",
        conversationId,
        message: createUserMessage(trimmed),
      });

      await runResearch(conversationId, trimmed, { history });
    },
    [runResearch],
  );

  const regenerate = useCallback(
    async (messageId: string) => {
      const current = stateRef.current;
      const conversation = current.conversations.find(
        (entry) => entry.id === current.activeId,
      );
      if (!conversation) return;
      const index = conversation.messages.findIndex((message) => message.id === messageId);
      if (index < 0) return;
      const priorUser = [...conversation.messages.slice(0, index)]
        .reverse()
        .find((message) => message.role === "user");
      if (!priorUser) return;

      await runResearch(conversation.id, priorUser.content, {
        history: buildHistory(conversation.messages, index),
        replaceMessageId: messageId,
      });
    },
    [runResearch],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const activeConversation = selectActiveConversation(state);

  const value = useMemo<ChatContextValue>(
    () => ({
      hydrated: state.hydrated,
      state,
      activeConversation,
      isGenerating: state.status === "submitting",
      datePreset,
      setDatePreset,
      searchMode,
      setSearchMode,
      newConversation,
      selectConversation,
      renameConversation,
      togglePin,
      toggleArchive,
      deleteConversation,
      clearAll,
      sendMessage,
      regenerate,
      stopGeneration,
      setFeedback,
      clearError,
    }),
    [
      state,
      activeConversation,
      datePreset,
      setDatePreset,
      searchMode,
      setSearchMode,
      newConversation,
      selectConversation,
      renameConversation,
      togglePin,
      toggleArchive,
      deleteConversation,
      clearAll,
      sendMessage,
      regenerate,
      stopGeneration,
      setFeedback,
      clearError,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
