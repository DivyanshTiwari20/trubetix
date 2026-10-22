import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatAbsoluteDate } from "@/lib/format";
import { SOURCE_TYPE_LABELS } from "@/lib/config";
import type { ResearchResult } from "@/types";

export function SourceCard({ index, source }: { index: number; source: ResearchResult }) {
  return (
    <a
      id={`source-${index}`}
      href={source.originalUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex scroll-mt-24 gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-secondary text-xs font-semibold text-secondary-foreground">
        {index}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-1">
          <span className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
            {source.title}
          </span>
          <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {source.sourceName ? <span className="truncate">{source.sourceName}</span> : null}
          {source.publishedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={source.publishedAt}>{formatAbsoluteDate(source.publishedAt)}</time>
            </>
          ) : (
            <>
              <span aria-hidden="true">·</span>
              <span>undated</span>
            </>
          )}
          <Badge variant="outline">{SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType}</Badge>
        </span>
        {source.relatedUrls.length > 0 ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {source.relatedUrls.length} related syndicated copy(ies) grouped — not independent
            corroboration.
          </span>
        ) : null}
      </span>
    </a>
  );
}

export function SourceList({ sources }: { sources: ResearchResult[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {sources.map((source, index) => (
        <SourceCard key={source.canonicalUrl} index={index + 1} source={source} />
      ))}
    </div>
  );
}
