import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import { createGeminiClient, type GeminiClientOptions } from "./gemini";

const baseOptions: GeminiClientOptions = {
  timeoutMs: 5000,
  maxRetries: 0,
  fetchImpl: vi.fn(),
};

const baseConfig = {
  apiKey: "test-api-key",
  model: "gemini-1.5-flash",
  useVertex: false,
  vertexProject: null,
  vertexRegion: null,
  fallbackModel: "gemini-1.5-flash-8b",
  temperature: 0.3,
};

const SUCCESS_BODY = {
  candidates: [{
    content: {
      parts: [{
        text: '{"result": "ok"}',
      }],
    },
  }],
};
const FALLBACK_BODY = {
  candidates: [{
    content: {
      parts: [{
        text: '{"fallback": true}',
      }],
    },
  }],
};

function makeBlockedBody() {
  const obj: Record<string, unknown> = { promptFeedback: {} };
  obj.promptFeedback = { blockReason: "SAFETY" };
  return obj;
}

function makeEmptyBody() {
  const obj: Record<string, unknown> = { candidates: [] };
  obj.candidates = [{ content: { parts: [{ text: "" }] } }];
  return obj;
}

function makeMalformedBody() {
  const obj: Record<string, unknown> = { candidates: [] };
  obj.candidates = [{ content: { parts: [{ text: "not json" }] } }];
  return obj;
}

function makeErrorBody(message: string, status: string) {
  return { error: { message, status } };
}

function makeResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function makeHttpError(status: number, message: string, retryAfterMs: number | null = null): HttpError {
  const retryable = [408, 425, 429, 500, 502, 503, 504].includes(status);
  return new HttpError(message, status, retryable, retryAfterMs);
}

describe("createGeminiClient", () => {
  it("returns parsed JSON on successful response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(SUCCESS_BODY));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    const result = await client.generateStructured({
      systemInstruction: "test",
      userContent: "test",
      responseSchema: {},
    });

    expect(result).toEqual({ result: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws GeminiError with quota_exhausted code for 429 with quota message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(makeHttpError(429, "Quota exhausted for model", 5000));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "quota_exhausted",
      status: 429,
      retryable: true,
      retryAfterMs: 5000,
    });
  });

  it("throws GeminiError with rate_limited code for 429 without quota message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(makeHttpError(429, "Rate limit exceeded", 3000));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryable: true,
      retryAfterMs: 3000,
    });
  });

  it("throws GeminiError with invalid_model code for 400 model not found", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(makeHttpError(400, "Model not found: gemini-invalid"));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "invalid_model",
      status: 400,
      retryable: false,
    });
  });

  it("throws GeminiError with billing_not_enabled code for 403 billing error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(makeHttpError(403, "Billing not enabled for project"));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "billing_not_enabled",
      status: 403,
      retryable: false,
    });
  });

  it("falls back to fallback model on retryable error", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(makeHttpError(429, "Rate limit exceeded", 1000))
      .mockResolvedValueOnce(makeResponse(FALLBACK_BODY));

    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    const result = await client.generateStructured({
      systemInstruction: "test",
      userContent: "test",
      responseSchema: {},
    });

    expect(result).toEqual({ fallback: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = fetchImpl.mock.calls;
    expect(firstCall[0]).toContain("gemini-1.5-flash");
    expect(secondCall[0]).toContain("gemini-1.5-flash-8b");
  });

  it("does not fallback when fallback model is not configured", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(makeHttpError(429, "Rate limit exceeded", 1000));
    const configWithoutFallback = { ...baseConfig, fallbackModel: null };
    const client = createGeminiClient(configWithoutFallback, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not fallback on non-retryable error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(makeHttpError(400, "Model not found: gemini-invalid"));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "invalid_model",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws GeminiError for blocked prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(makeBlockedBody()));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "blocked",
    });
  });

  it("throws GeminiError for empty response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(makeEmptyBody()));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "empty_response",
    });
  });

  it("throws GeminiError for malformed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(makeMalformedBody()));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "malformed_response",
    });
  });

  it("builds Vertex AI URL when useVertex is true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(SUCCESS_BODY));
    const vertexConfig = {
      ...baseConfig,
      useVertex: true,
      vertexProject: "test-project",
      vertexRegion: "us-central1",
    };
    const client = createGeminiClient(vertexConfig, { ...baseOptions, fetchImpl });

    await client.generateStructured({
      systemInstruction: "test",
      userContent: "test",
      responseSchema: {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const callUrl = fetchImpl.mock.calls[0][0];
    expect(callUrl).toContain("us-central1-aiplatform.googleapis.com");
    expect(callUrl).toContain("projects/test-project");
    expect(callUrl).toContain("locations/us-central1");
    expect(callUrl).toContain("publishers/google/models/gemini-1.5-flash");
  });

  it("throws GeminiError with invalid_project when Vertex project is missing and API returns 400", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(makeHttpError(400, "Project not found"));
    const vertexConfig = {
      ...baseConfig,
      useVertex: true,
      vertexProject: "test-project",
      vertexRegion: "us-central1",
    };
    const client = createGeminiClient(vertexConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "invalid_project",
    });
  });

  it("throws GeminiError with upstream_error for data.error from API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(makeErrorBody("Internal server error", "500"), 200));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "upstream_error",
      status: 500,
      retryable: true,
    });
  });

  it("throws GeminiError with quota_exhausted for data.error with quota message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(makeErrorBody("Quota exhausted", "429"), 200));
    const client = createGeminiClient(baseConfig, { ...baseOptions, fetchImpl });

    await expect(
      client.generateStructured({
        systemInstruction: "test",
        userContent: "test",
        responseSchema: {},
      }),
    ).rejects.toMatchObject({
      code: "quota_exhausted",
      status: 429,
      retryable: true,
    });
  });
});