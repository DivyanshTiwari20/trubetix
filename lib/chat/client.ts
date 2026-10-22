import { apiErrorSchema, chatResponseSchema } from "@/lib/validation";
import type { ChatRequest, ChatResponse } from "@/types";

export class ChatRequestError extends Error {
  readonly code: string;
  readonly details: string[];

  constructor(message: string, code: string, details: string[] = []) {
    super(message);
    this.name = "ChatRequestError";
    this.code = code;
    this.details = details;
  }
}

export async function requestResearch(
  payload: ChatRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ChatResponse> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ChatRequestError(
      "Could not reach the Tubitex research service. Check your connection and try again.",
      "network_error",
    );
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(data);
    if (parsed.success) {
      throw new ChatRequestError(parsed.data.error.message, parsed.data.error.code, parsed.data.error.details ?? []);
    }
    throw new ChatRequestError(
      `The research service responded with status ${response.status}.`,
      "server_error",
    );
  }

  const parsed = chatResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new ChatRequestError("The research service returned an unexpected response.", "invalid_response");
  }

  return parsed.data;
}
