import { connection } from "next/server";
import { getIntegrationStatus, getResearchConfig } from "@/lib/env";

export async function GET(): Promise<Response> {
  await connection();
  const integrations = getIntegrationStatus();
  const config = getResearchConfig();
  const live = integrations.gemini.configured && (integrations.serpapi.configured || integrations.newsapi.configured);
  return Response.json({
    status: live ? "ok" : "degraded",
    integrations,
    limits: {
      maxQueries: config.maxQueries,
      maxResultsPerQuery: config.maxResultsPerQuery,
      maxEvidence: config.maxEvidence,
      timeoutMs: config.timeoutMs,
    },
  });
}
