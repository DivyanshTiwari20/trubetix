import "server-only";
import { fetchJson } from "@/lib/http";

export interface ApifyInstagramConfig {
  apiToken: string;
  actorId: string;
  maxResultsPerActor: number;
  maxDatasetItems: number;
  datasetPageSize: number;
  timeoutMs: number;
  maxTotalChargeUsd: number | null;
}

export interface ApifyInstagramSearchInput {
  query: string;
  searchType: "hashtag" | "keyword";
  limit: number;
}

export interface ApifyInstagramRetrieval {
  items: unknown[];
  runId: string;
  runStatus: string;
  datasetId: string;
  pagesFetched: number;
  datasetComplete: boolean;
  actorResultCapReached: boolean;
  datasetCapReached: boolean;
  warnings: string[];
}

interface ActorRunResponse {
  data?: {
    id?: unknown;
    status?: unknown;
    defaultDatasetId?: unknown;
  };
}

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
const FAILED_STATUSES = new Set(["FAILED", "ABORTED", "TIMED-OUT"]);

function runData(response: ActorRunResponse) {
  const data = response?.data;
  const id = typeof data?.id === "string" ? data.id : null;
  const status = typeof data?.status === "string" ? data.status : null;
  const datasetId = typeof data?.defaultDatasetId === "string" ? data.defaultDatasetId : null;
  return { id, status, datasetId };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function abortRun(config: ApifyInstagramConfig, runId: string) {
  try {
    await fetchJson<unknown>(
      `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.apiToken}` },
      },
      { timeoutMs: 5_000, retries: 0 },
    );
  } catch {
    // The timeout warning remains authoritative; don't hide it with abort cleanup errors.
  }
}

/** Runs one configured Actor and reads every dataset page within explicit safety bounds. */
export async function searchApifyInstagram(
  config: ApifyInstagramConfig,
  input: ApifyInstagramSearchInput,
  signal?: AbortSignal,
): Promise<ApifyInstagramRetrieval> {
  const actorPath = config.actorId.replace(/\//g, "~");
  const deadline = Date.now() + config.timeoutMs;
  const actorLimit = Math.max(1, Math.min(input.limit, config.maxResultsPerActor));
  const maxDatasetItems = Math.max(1, config.maxDatasetItems);
  const pageSize = Math.max(1, Math.min(config.datasetPageSize, maxDatasetItems));
  const runParams = new URLSearchParams();
  if (config.maxTotalChargeUsd !== null) {
    runParams.set("maxTotalChargeUsd", String(config.maxTotalChargeUsd));
  }
  const runQuery = runParams.toString();
  const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actorPath)}/runs${runQuery ? `?${runQuery}` : ""}`;

  const started = await fetchJson<ActorRunResponse>(
    runUrl,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hashtags: [input.query.replace(/^#/, "")],
        keywordSearch: input.searchType === "keyword",
        resultsType: "posts",
        resultsLimit: actorLimit,
      }),
    },
    {
      timeoutMs: Math.min(config.timeoutMs, 30_000),
      // A failed POST may have started a paid run; never retry it automatically.
      retries: 0,
      signal,
    },
  );

  let run = runData(started);
  if (!run.id) throw new Error("Apify started a run but returned no run ID.");
  while (run.status && !TERMINAL_STATUSES.has(run.status)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      await abortRun(config, run.id);
      throw new Error("Apify Actor exceeded the configured run timeout; the run was asked to stop.");
    }
    await pause(Math.min(1_000, remainingMs));
    const polled = await fetchJson<ActorRunResponse>(
      `https://api.apify.com/v2/actor-runs/${encodeURIComponent(run.id)}`,
      { headers: { Authorization: `Bearer ${config.apiToken}` } },
      { timeoutMs: Math.min(10_000, remainingMs), retries: 1, signal },
    );
    const next = runData(polled);
    run = { id: next.id ?? run.id, status: next.status, datasetId: next.datasetId ?? run.datasetId };
  }

  if (!run.status) throw new Error("Apify run status was unavailable; dataset retrieval was not assumed complete.");
  if (FAILED_STATUSES.has(run.status)) throw new Error(`Apify Actor ended with status ${run.status}.`);
  if (run.status !== "SUCCEEDED") throw new Error(`Apify Actor ended in unexpected status ${run.status}.`);
  if (!run.datasetId) throw new Error("Apify completed without a default dataset ID.");

  const items: unknown[] = [];
  const warnings: string[] = [];
  let pagesFetched = 0;
  let datasetComplete = false;
  while (items.length < maxDatasetItems) {
    if (Date.now() >= deadline) {
      warnings.push(`Dataset paging stopped at the configured timeout after ${items.length} item(s); coverage is partial.`);
      break;
    }
    const remaining = maxDatasetItems - items.length;
    const limit = Math.min(pageSize, remaining);
    const params = new URLSearchParams({
      format: "json",
      clean: "true",
      offset: String(items.length),
      limit: String(limit),
    });
    let page: unknown;
    try {
      page = await fetchJson<unknown>(
        `https://api.apify.com/v2/datasets/${encodeURIComponent(run.datasetId)}/items?${params.toString()}`,
        { headers: { Authorization: `Bearer ${config.apiToken}` } },
        { timeoutMs: Math.min(15_000, Math.max(1_000, deadline - Date.now())), retries: 1, signal },
      );
    } catch (error) {
      if (items.length === 0) throw error;
      warnings.push(`Dataset paging stopped after ${items.length} item(s); the later page failed, so coverage is partial.`);
      break;
    }
    if (!Array.isArray(page)) {
      if (items.length === 0) throw new Error("Apify dataset returned an unexpected format.");
      warnings.push("Dataset paging stopped because a later page had an unexpected format; coverage is partial.");
      break;
    }
    pagesFetched += 1;
    items.push(...page);
    if (page.length < limit) {
      datasetComplete = true;
      break;
    }
  }

  const datasetCapReached = items.length >= maxDatasetItems && !datasetComplete;
  if (datasetCapReached) {
    warnings.push(`Dataset safety cap reached (${maxDatasetItems} rows); additional Actor output may exist.`);
  }
  const actorResultCapReached = items.length >= actorLimit;
  if (actorResultCapReached) {
    warnings.push(`Actor result limit reached (${actorLimit}); additional matching posts may exist.`);
  }

  return {
    items,
    runId: run.id,
    runStatus: run.status,
    datasetId: run.datasetId,
    pagesFetched,
    datasetComplete,
    actorResultCapReached,
    datasetCapReached,
    warnings,
  };
}
