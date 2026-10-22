import { NextResponse } from "next/server";
import { createGeminiClient } from "@/lib/ai/gemini";
import { createId } from "@/lib/id";
import {
  getGeminiConfig,
  getIntegrationStatus,
  getNewsApiKey,
  getResearchConfig,
  getSerpApiKey,
} from "@/lib/env";
import { isAbortError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { createInstagramProfileProvider, createSearchProviders } from "@/lib/providers";
import { checkRateLimit } from "@/lib/rate-limit";
import { runResearch } from "@/lib/research/pipeline";
import { runSimpleInstagramResearch } from "@/lib/instagram-simple";
import { chatRequestSchema, chatResponseSchema } from "@/lib/validation";
import type { ChatMessage } from "@/types";

function errorResponse(code: string, message: string, status: number, details?: string[]) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "local";
}

function isSimpleGreeting(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "hi" ||
    normalized === "hello" ||
    normalized === "hey" ||
    normalized === "hi there" ||
    normalized === "hello there" ||
    normalized.startsWith("hi ") && normalized.length < 20 ||
    normalized.startsWith("hello ") && normalized.length < 25
  );
}

function isInstagramSocialQuestion(message: string): boolean {
  const normalized = message.toLowerCase();
  const instagramKeywords = [
    "instagram", "insta", "ig", "reel", "reels", "post", "posts", 
    "@", "hashtag", "#", "follower", "following", "profile", "account"
  ];
  return instagramKeywords.some(keyword => normalized.includes(keyword));
}

async function lightweightResponse(message: string, conversationId: string): Promise<Response> {
  const start = Date.now();
  logger.info("Lightweight response for simple greeting", { conversationId, messageLength: message.length });
  
  const greetingMessage: ChatMessage = {
    id: createId("msg"),
    role: "assistant",
    content: "Hello! How can I help you today?",
    createdAt: new Date().toISOString(),
    status: "complete",
    analysis: null,
    sources: [],
    meta: null,
    error: null,
    feedback: null,
  };

  const payload = chatResponseSchema.parse({
    conversationId,
    message: greetingMessage,
  });
  
  logger.info("Lightweight response completed", { conversationId, elapsedMs: Date.now() - start });
  return NextResponse.json(payload);
}

export async function POST(request: Request): Promise<Response> {
  const requestId = createId("req");
  const requestStart = Date.now();
  
  logger.info("Chat request received", { requestId });
  
  const limit = checkRateLimit(clientKey(request));
  if (!limit.allowed) {
    logger.warn("Rate limit exceeded", { requestId });
    return errorResponse(
      "rate_limited",
      "Too many research requests. Please wait a moment and try again.",
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "The request body must be valid JSON.", 400);
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("Request validation failed", { requestId, issues: parsed.error.issues });
    return errorResponse(
      "invalid_request",
      "The request did not pass validation.",
      400,
      parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
    );
  }

  const message = parsed.data.message;
  const conversationId = parsed.data.conversationId ?? createId("conv");
  
  // Fast path for simple greetings - no research needed
  if (isSimpleGreeting(message)) {
    return lightweightResponse(message, conversationId);
  }

  logger.info("Building research config", { requestId, conversationId });
  const config = getResearchConfig();
  const integrations = getIntegrationStatus();
  const geminiConfig = getGeminiConfig();

  // Route Instagram/social questions to new simple handler when flag is enabled
  if (config.instagramSimple && isInstagramSocialQuestion(message)) {
    logger.info("Routing to simple Instagram handler", { requestId, conversationId });
    const gemini = geminiConfig
      ? createGeminiClient(geminiConfig, {
          timeoutMs: config.timeoutMs,
          maxRetries: config.maxRetries,
          temperature: geminiConfig.temperature,
        })
      : null;

    const history = parsed.data.history.map((turn) => turn.content);
    const outcome = await runSimpleInstagramResearch(
      message,
      history,
      parsed.data.dateRange?.from ?? null,
      parsed.data.dateRange?.to ?? null,
      parsed.data.dateRange?.preset ?? null,
      gemini,
      request.signal
    );

    const messageObj: ChatMessage = {
      id: createId("msg"),
      role: "assistant",
      content: outcome.message,
      createdAt: new Date().toISOString(),
      status: "complete",
      analysis: null,
      sources: [],
      meta: outcome.meta,
      error: null,
      feedback: null,
    };

    const payload = chatResponseSchema.parse({
      conversationId,
      message: messageObj,
    });

    logger.info("Chat request completed (simple Instagram)", { requestId, conversationId, totalElapsedMs: Date.now() - requestStart });
    return NextResponse.json(payload);
  }

  logger.info("Creating providers", { requestId, conversationId, geminiConfigured: !!geminiConfig });
  const providers = createSearchProviders({
    serpApiKey: getSerpApiKey(),
    newsApiKey: getNewsApiKey(),
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  const instagram = createInstagramProfileProvider({
    apiKey: getSerpApiKey(),
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  const gemini = geminiConfig
    ? createGeminiClient(geminiConfig, {
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        temperature: geminiConfig.temperature,
      })
    : null;

  try {
    logger.info("Running research", { requestId, conversationId, messageLength: message.length });
    const researchStart = Date.now();
    
    const history = parsed.data.history.map((turn) => turn.content);
    const outcome = await runResearch(
      {
        question: parsed.data.message,
        datePreset: parsed.data.dateRange?.preset,
        dateFrom: parsed.data.dateRange?.from,
        dateTo: parsed.data.dateRange?.to,
        history,
      },
      {
        providers,
        gemini,
        config,
        integrations,
        instagram,
        signal: request.signal,
      },
    );

    logger.info("Research completed", { requestId, conversationId, status: outcome.status, elapsedMs: Date.now() - researchStart });

    const messageObj: ChatMessage = {
      id: createId("msg"),
      role: "assistant",
      content: outcome.message,
      createdAt: new Date().toISOString(),
      status: outcome.status === "ok" ? "complete" : "degraded",
      analysis: outcome.analysis,
      sources: outcome.sources,
      meta: outcome.meta,
      error: null,
      feedback: null,
    };

    const payload = chatResponseSchema.parse({
      conversationId,
      message: messageObj,
    });

    logger.info("Chat request completed", { requestId, conversationId, totalElapsedMs: Date.now() - requestStart });
    return NextResponse.json(payload);
  } catch (error) {
    if (isAbortError(error)) {
      logger.warn("Request aborted", { requestId, conversationId, elapsedMs: Date.now() - requestStart });
      return errorResponse("aborted", "The request was cancelled.", 499);
    }
    logger.error("Chat request failed", {
      requestId,
      conversationId,
      message: error instanceof Error ? error.message : "unknown",
      elapsedMs: Date.now() - requestStart,
    });
    return errorResponse(
      "internal_error",
      "Research failed due to an unexpected server error. Please try again.",
      500,
    );
  }
}
