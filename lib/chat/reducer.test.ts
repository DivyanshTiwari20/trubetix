import { describe, expect, it } from "vitest";
import { makeConversation, makeMessage } from "@/tests/fixtures";
import {
  chatReducer,
  groupConversations,
  initialChatState,
  matchesQuery,
  selectActiveConversation,
  sortConversations,
  type ChatState,
} from "./reducer";

function stateWith(conversations = [makeConversation({ id: "c1" })]): ChatState {
  return {
    ...initialChatState,
    hydrated: true,
    conversations,
    activeId: conversations[0]?.id ?? null,
  };
}

describe("chatReducer", () => {
  it("appends a message and bumps updatedAt", () => {
    const next = chatReducer(stateWith(), {
      type: "appendMessage",
      conversationId: "c1",
      message: makeMessage({ createdAt: "2026-05-11T00:00:00.000Z" }),
    });
    expect(next.conversations[0].messages).toHaveLength(1);
    expect(next.conversations[0].updatedAt).toBe("2026-05-11T00:00:00.000Z");
  });

  it("replaces a message in place", () => {
    const original = makeMessage({ id: "m1", content: "old" });
    const state = stateWith([makeConversation({ id: "c1", messages: [original] })]);
    const next = chatReducer(state, {
      type: "replaceMessage",
      conversationId: "c1",
      message: { ...original, content: "new", status: "degraded" },
    });
    expect(next.conversations[0].messages[0].content).toBe("new");
    expect(next.conversations[0].messages[0].status).toBe("degraded");
  });

  it("clears the active conversation when it is deleted", () => {
    const next = chatReducer(stateWith(), { type: "deleteConversation", id: "c1" });
    expect(next.conversations).toHaveLength(0);
    expect(next.activeId).toBeNull();
  });

  it("resets everything on clearAll but stays hydrated", () => {
    const next = chatReducer(stateWith(), { type: "clearAll" });
    expect(next.conversations).toHaveLength(0);
    expect(next.activeId).toBeNull();
    expect(next.hydrated).toBe(true);
  });

  it("sets message feedback", () => {
    const state = stateWith([
      makeConversation({ id: "c1", messages: [makeMessage({ id: "m1" })] }),
    ]);
    const next = chatReducer(state, {
      type: "setMessageFeedback",
      conversationId: "c1",
      messageId: "m1",
      feedback: "up",
    });
    expect(next.conversations[0].messages[0].feedback).toBe("up");
  });
});

describe("sortConversations", () => {
  it("puts pinned conversations first, then orders by recency", () => {
    const pinnedOld = makeConversation({
      id: "pinned",
      pinned: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const recent = makeConversation({ id: "recent", updatedAt: "2026-05-09T00:00:00.000Z" });
    const older = makeConversation({ id: "older", updatedAt: "2026-05-01T00:00:00.000Z" });

    const sorted = sortConversations([recent, older, pinnedOld]);
    expect(sorted.map((conversation) => conversation.id)).toEqual(["pinned", "recent", "older"]);
  });
});

describe("selectActiveConversation", () => {
  it("returns the active conversation or null", () => {
    const conversation = makeConversation({ id: "c1" });
    expect(selectActiveConversation(stateWith([conversation]))).toBe(conversation);
    expect(selectActiveConversation({ ...initialChatState, activeId: null })).toBeNull();
  });
});

describe("matchesQuery", () => {
  const conversation = makeConversation({
    title: "Acme crisis",
    messages: [makeMessage({ role: "assistant", content: "Acme responded quickly" })],
  });

  it("matches on title and message content, case-insensitively", () => {
    expect(matchesQuery(conversation, "acme")).toBe(true);
    expect(matchesQuery(conversation, "RESPONDED")).toBe(true);
  });

  it("does not match unrelated terms", () => {
    expect(matchesQuery(conversation, "zzz")).toBe(false);
  });

  it("treats a blank query as a match", () => {
    expect(matchesQuery(conversation, "   ")).toBe(true);
  });
});

describe("groupConversations", () => {
  const now = new Date(2026, 4, 10, 12, 0, 0).getTime();
  const recent = makeConversation({
    id: "recent",
    updatedAt: new Date(now - 60 * 60 * 1000).toISOString(),
  });
  const old = makeConversation({
    id: "old",
    updatedAt: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const archived = makeConversation({ id: "archived", archived: true, updatedAt: new Date(now).toISOString() });

  it("buckets by age in canonical order", () => {
    const groups = groupConversations([recent, old, archived], {
      query: "",
      showArchived: false,
      now,
    });
    expect(groups.map((group) => group.group)).toEqual(["Today", "Older"]);
    expect(groups[0].conversations.map((conversation) => conversation.id)).toEqual(["recent"]);
    expect(groups[1].conversations.map((conversation) => conversation.id)).toEqual(["old"]);
  });

  it("shows only archived conversations when requested", () => {
    const groups = groupConversations([recent, old, archived], {
      query: "",
      showArchived: true,
      now,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].conversations[0].id).toBe("archived");
  });
});
