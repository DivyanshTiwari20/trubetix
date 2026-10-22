import "server-only";
import type { GeminiConfig } from "@/lib/env";
import { fetchJson, HttpError } from "@/lib/http";

export type GeminiSchema = Record<string, unknown>;

export interface GeminiGenerateArgs {
  systemInstruction: string;
  userContent: string;
  responseSchema: GeminiSchema;
  temperature?: number;
  signal?: AbortSignal;
}

export interface GeminiClient {
  readonly model: string;
  readonly fallbackModel: string | null;
  generateStructured(args: GeminiGenerateArgs): Promise<unknown>;
}

export type GeminiErrorCode =
  | "upstream_error"
  | "quota_exhausted"
  | "rate_limited"
  | "invalid_model"
  | "invalid_project"
  | "billing_not_enabled"
  | "blocked"
  | "empty_response"
  | "malformed_response";

export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    code: GeminiErrorCode,
    status: number | null = null,
    retryable = false,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

export interface GeminiClientOptions {
  timeoutMs: number;
  maxRetries: number;
  temperature?: number;
  fetchImpl?: typeof fetch;
}

function buildGoogleAIUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function buildVertexAIUrl(model: string, project: string, region: string): string {
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

function classifyHttpError(error: HttpError): GeminiError {
  const { status, retryable, retryAfterMs } = error;

  if (status === 429) {
    const message = error.message.toLowerCase();
    if (message.includes("quota") || message.includes("resource_exhausted")) {
      return new GeminiError(
        "Gemini quota exhausted. Check your project's quota limits.",
        "quota_exhausted",
        status,
        retryable,
        retryAfterMs,
      );
    }
    return new GeminiError(
      `Gemini rate limited. ${retryAfterMs ? `Retry after ${Math.ceil(retryAfterMs / 1000)}s.` : ""}`,
      "rate_limited",
      status,
      retryable,
      retryAfterMs,
    );
  }

  if (status === 400) {
    const message = error.message.toLowerCase();
    if (message.includes("model") && (message.includes("not found") || message.includes("invalid"))) {
      return new GeminiError(
        `Gemini model not found or not supported: ${error.message}`,
        "invalid_model",
        status,
        false,
      );
    }
    if (message.includes("project") && message.includes("not found")) {
      return new GeminiError(
        `Gemini project not found: ${error.message}`,
        "invalid_project",
        status,
        false,
      );
    }
    if (message.includes("billing") || message.includes("permission")) {
      return new GeminiError(
        `Gemini billing not enabled or insufficient permissions: ${error.message}`,
        "billing_not_enabled",
        status,
        false,
      );
    }
  }

  if (status === 403) {
    const message = error.message.toLowerCase();
    if (message.includes("billing") || message.includes("permission") || message.includes("not enabled")) {
      return new GeminiError(
        `Gemini API not enabled or billing not configured: ${error.message}`,
        "billing_not_enabled",
        status,
        false,
      );
    }
  }

  return new GeminiError(
    `Gemini request failed (status ${status}).`,
    "upstream_error",
    status,
    retryable,
    retryAfterMs,
  );
}

function tryGenerate(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  options: GeminiClientOptions,
  signal?: AbortSignal,
): Promise<GeminiResponse> {
  return fetchJson<GeminiResponse>(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    },
    {
      timeoutMs: options.timeoutMs,
      retries: options.maxRetries,
      signal,
      fetchImpl: options.fetchImpl,
    },
  );
}

export function createGeminiClient(
  config: GeminiConfig,
  options: GeminiClientOptions,
): GeminiClient {
  const primaryModel = config.model;
  const fallbackModel = config.fallbackModel;
  const useVertex = config.useVertex;
  const vertexProject = config.vertexProject;
  const vertexRegion = config.vertexRegion;

  async function generateWithModel(
    model: string,
    args: GeminiGenerateArgs,
  ): Promise<unknown> {
    const url = useVertex
      ? buildVertexAIUrl(model, vertexProject!, vertexRegion!)
      : buildGoogleAIUrl(model);

    const body = {
      systemInstruction: { parts: [{ text: args.systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: args.userContent }] }],
      generationConfig: {
        temperature: args.temperature ?? options.temperature ?? 0.3,
        responseMimeType: "application/json",
        responseSchema: args.responseSchema,
      },
    };

    let data: GeminiResponse;
    try {
      data = await tryGenerate(url, body, config.apiKey, options, args.signal);
    } catch (error) {
      if (error instanceof HttpError) {
        throw classifyHttpError(error);
      }
      throw error;
    }

    if (data.error) {
      const errorMessage = data.error.message ?? data.error.status ?? "unknown";
      let status: number | null = null;
      if (data.error.status && typeof data.error.status === "string") {
        const parsed = Number.parseInt(data.error.status, 10);
        if (Number.isFinite(parsed)) status = parsed;
      } else if (typeof data.error.status === "number" && Number.isFinite(data.error.status)) {
        status = data.error.status;
      } else {
        const statusMatch = errorMessage.match(/status\s+(\d+)/i);
        if (statusMatch) status = Number.parseInt(statusMatch[1], 10);
      }

      const syntheticHttpError = new HttpError(
        `Gemini reported an error: ${errorMessage}`,
        status ?? 500,
        status === 429 || status === 500 || status === 503,
      );
      throw classifyHttpError(syntheticHttpError);
    }
    if (data.promptFeedback?.blockReason) {
      throw new GeminiError(
        `Gemini blocked the request (${data.promptFeedback.blockReason}).`,
        "blocked",
      );
    }

    const text =
      data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text.trim()) {
      throw new GeminiError("Gemini returned an empty response.", "empty_response");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new GeminiError("Gemini returned malformed JSON.", "malformed_response");
    }
  }

  return {
    model: primaryModel,
    fallbackModel,
    async generateStructured(args) {
      try {
        return await generateWithModel(primaryModel, args);
      } catch (error) {
        if (error instanceof GeminiError) {
          const isRetryableConfigError =
            error.code === "rate_limited" ||
            error.code === "quota_exhausted" ||
            (error.code === "upstream_error" && error.retryable);

          if (isRetryableConfigError && fallbackModel && fallbackModel !== primaryModel) {
            try {
              return await generateWithModel(fallbackModel, args);
            } catch (fallbackError) {
              if (fallbackError instanceof GeminiError) {
                throw new GeminiError(
                  `Both primary (${primaryModel}) and fallback (${fallbackModel}) models failed. Primary: ${error.message}. Fallback: ${fallbackError.message}`,
                  fallbackError.code,
                  fallbackError.status,
                  fallbackError.retryable,
                  fallbackError.retryAfterMs,
                );
              }
              throw fallbackError;
            }
          }
        }
        throw error;
      }
    },
  };
}