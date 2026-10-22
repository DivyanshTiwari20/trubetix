import { RESEARCH_DEFAULTS } from "@/lib/config";

export class HttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, retryable = false, retryAfterMs: number | null = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, retryAfterMs: number | null = null): number {
  if (retryAfterMs !== null && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  }
  const base = BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * (base * 0.5));
  return Math.min(base + jitter, MAX_BACKOFF_MS);
}

function linkSignals(controller: AbortController, external?: AbortSignal) {
  if (!external) return { signal: controller.signal, cleanup: () => {} };
  if (external.aborted) {
    controller.abort(external.reason);
    return { signal: controller.signal, cleanup: () => {} };
  }
  const onAbort = () => controller.abort(external.reason);
  external.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => external.removeEventListener("abort", onAbort),
  };
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("abort"))
  );
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  options: FetchJsonOptions = {},
): Promise<T> {
  const {
    timeoutMs = RESEARCH_DEFAULTS.timeoutMs,
    retries = RESEARCH_DEFAULTS.maxRetries,
    signal,
    fetchImpl = fetch,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
    const linked = linkSignals(controller, signal);

    try {
      const response = await fetchImpl(url, { ...init, signal: linked.signal });
      if (!response.ok) {
        const retryable = RETRYABLE_STATUS.has(response.status);
        let retryAfterMs: number | null = null;
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          if (retryAfter) {
            const seconds = Number.parseInt(retryAfter, 10);
            if (Number.isFinite(seconds) && seconds > 0) {
              retryAfterMs = seconds * 1000;
            }
          }
        }
        throw new HttpError(
          `Upstream request failed with status ${response.status}`,
          response.status,
          retryable,
          retryAfterMs,
        );
      }
      const text = await response.text();
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new HttpError("Upstream returned malformed JSON", 502, false);
      }
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof HttpError ? error.retryable : !isAbortError(error);
      const retryAfterMs = error instanceof HttpError ? error.retryAfterMs : null;
      const canRetry = retryable && attempt < retries && !signal?.aborted;
      if (!canRetry) throw error;
      await delay(backoffDelay(attempt, retryAfterMs));
    } finally {
      clearTimeout(timeout);
      linked.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}
