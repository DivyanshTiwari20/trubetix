import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SOURCE_TYPE_LABELS } from "@/lib/config";
import { formatCompactCount, formatDateTime } from "@/lib/format";
import type { ResearchMeta } from "@/types";

const STATUS_VARIANT: Record<ResearchMeta["status"], "success" | "warning" | "destructive"> = {
  ok: "success",
  degraded: "warning",
  failed: "destructive",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function integrationLabel(configured: boolean, fallback: string): string {
  return configured ? "Configured" : fallback;
}

const CAPABILITY_LABELS: Record<string, string> = {
  serpapi: "Live search",
  apify: "Deep search",
  newsapi: "News search",
  instagram: "Instagram profile",
};

function capabilityLabel(id: string): string {
  return CAPABILITY_LABELS[id] ?? "Search";
}

export function ResearchMetaDetails({ meta }: { meta: ResearchMeta }) {
  return (
    <details className="group rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
      <summary className="cursor-pointer list-none font-medium text-muted-foreground marker:hidden">
        {meta.instagramResults
          ? `Instagram results for ${meta.instagramResults.entity}`
          : `Research details (${meta.resultsIncluded} sources, ${meta.queries.length} queries)`}
      </summary>
      <ResearchMetaBody meta={meta} />
    </details>
  );
}

export function ResearchMetaBody({ meta }: { meta: ResearchMeta }) {
  if (meta.instagramResults) {
    const results = meta.instagramResults;
    return (
      <div className="mt-2 space-y-2">
        <p className="font-medium">Instagram search</p>
        <dl>
          <Row label="Entity" value={results.entity} />
          <Row label="Date range" value={results.dateRangeLabel} />
          <Row label="Search coverage" value={results.retrievalSource === "apify" ? "Deep search" : "Live search"} />
          {results.retrievalSource === "apify" ? null : (
            <Row
              label="Estimated matching results"
              value={formatCompactCount(results.googleEstimatedResults) || "Unavailable"}
            />
          )}
          <Row label="Posts shown" value={results.posts.length.toLocaleString("en-US")} />
        </dl>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <dl>
        <Row label="Status" value={meta.status} />
        <Row label="Intent" value={meta.intent.replace("_", " ")} />
        <Row label="Window" value={meta.dateRange.label} />
        {meta.previousDateRange ? (
          <Row label="Comparison" value={meta.previousDateRange.label} />
        ) : null}
        <Row label="Results retrieved" value={String(meta.resultsRetrieved)} />
        <Row label="After deduplication" value={String(meta.resultsAfterDedupe)} />
        <Row label="Included in analysis" value={String(meta.resultsIncluded)} />
        <Row label="Excluded (undated)" value={String(meta.undatedExcluded)} />
        <Row
          label="Search coverage"
          value={
            meta.providersSearched.length > 0
              ? [...new Set(meta.providersSearched.map(capabilityLabel))].join(", ")
              : "none"
          }
        />
        <Row
          label="Source types"
          value={
            meta.sourceTypesSearched.length > 0
              ? meta.sourceTypesSearched.map((type) => SOURCE_TYPE_LABELS[type] ?? type).join(", ")
              : "none"
          }
        />
        <Row label="Comparison available" value={meta.comparisonAvailable ? "yes" : "no"} />
      </dl>

      <Separator />

      <div className="space-y-1">
        <p className="font-medium text-muted-foreground">Integrations</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant={meta.integrations.gemini.configured ? "success" : "warning"}>
            AI analysis: {integrationLabel(meta.integrations.gemini.configured, "off")}
          </Badge>
          <Badge variant={meta.integrations.serpapi.configured ? "success" : "warning"}>
            Live search: {integrationLabel(meta.integrations.serpapi.configured, "off")}
          </Badge>
          <Badge variant={meta.integrations.newsapi.configured ? "success" : "outline"}>
            News search: {integrationLabel(meta.integrations.newsapi.configured, "off")}
          </Badge>
          {meta.integrations.apify ? (
            <Badge variant={meta.integrations.apify.configured ? "success" : "warning"}>
              Deep search: {integrationLabel(meta.integrations.apify.configured, "off")}
            </Badge>
          ) : null}
        </div>
      </div>

      {meta.warnings.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-warning">Warnings</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {meta.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {meta.limitations.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">Limitations</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {meta.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="pt-1 text-[10px] text-muted-foreground">
        Generated {formatDateTime(meta.generatedAt)} · times in {meta.dateRange.timezone}
      </p>
    </div>
  );
}

export function ResearchPanel({ meta }: { meta: ResearchMeta | null }) {
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Research context</h2>
        {meta && !meta.instagramResults ? (
          <Badge variant={STATUS_VARIANT[meta.status]}>{meta.status}</Badge>
        ) : null}
      </div>
      {!meta ? (
        <p className="text-muted-foreground">
          Research metadata will appear here after the first response.
        </p>
      ) : (
        <ResearchMetaBody meta={meta} />
      )}
    </div>
  );
}
