import { describe, expect, it } from "vitest";
import { makeMessage } from "@/tests/fixtures";
import { chatRequestSchema, chatResponseSchema } from "./chat";

describe("chatRequestSchema", () => {
  it("rejects an empty or whitespace-only message", () => {
    expect(chatRequestSchema.safeParse({ message: "" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "   " }).success).toBe(false);
  });

  it("trims the message and defaults history to an empty array", () => {
    const parsed = chatRequestSchema.parse({ message: "  hi  " });
    expect(parsed.message).toBe("hi");
    expect(parsed.history).toEqual([]);
  });

  it("rejects a message beyond the configured limit", () => {
    expect(chatRequestSchema.safeParse({ message: "x".repeat(3000) }).success).toBe(false);
  });
});

describe("chatResponseSchema", () => {
  it("accepts a valid assistant message", () => {
    const response = { conversationId: "c1", message: makeMessage({ role: "assistant" }) };
    expect(chatResponseSchema.safeParse(response).success).toBe(true);
  });
});
