"use client";

import { AlertTriangle, RotateCcw, ChevronDown } from "lucide-react";
import { ResearchMetaDetails } from "@/components/research/research-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChatMessage, ResearchResult } from "@/types";
import { AnalysisSection, ClaimList, ConfidenceBadge } from "./analysis-parts";
import { MessageActions } from "./message-actions";
import { SourceList, SourceCard } from "./source-card";
import { MarkdownContent } from "./markdown-content";
import { InstagramResults } from "./instagram-results";
import { useState } from "react";

function PostCountResults({ sources }: { sources: ResearchResult[] }) {
  const [showAll, setShowAll] = useState(false);

  // Block A: Popular posts - top 5 by likes
  const popularPosts = [...sources]
    .filter((s) => s.likes !== undefined)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, 5);

  // Block B: All results
  const allPosts = sources;
  const displayPosts = showAll ? allPosts : allPosts.slice(0, 10);

  const hasLikes = popularPosts.length >= 3;

  return (
    <div className="space-y-4">
      {/* Block A: Popular posts */}
      {popularPosts.length > 0 && (
        <AnalysisSection title="Popular posts" kind="reported">
          <div className="grid gap-2 sm:grid-cols-2">
            {popularPosts.map((source, index) => (
              <SourceCard key={source.canonicalUrl} index={index + 1} source={source} />
            ))}
          </div>
          {!hasLikes && popularPosts.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Likes are shown only when the source provides them. Sorted by newest as fallback.
            </p>
          )}
        </AnalysisSection>
      )}

      {/* Block B: All results found */}
      {allPosts.length > 0 && (
        <AnalysisSection title={`All results found (${allPosts.length})`} kind="reported">
          <div className="grid gap-2 sm:grid-cols-2">
            {displayPosts.map((source, index) => (
              <SourceCard key={source.canonicalUrl} index={index + 1} source={source} />
            ))}
          </div>
          {!showAll && allPosts.length > 10 && (
            <Button
              variant="link"
              size="sm"
              className="mt-2 justify-self-start"
              onClick={() => setShowAll(true)}
            >
              <ChevronDown className="size-3.5 mr-1" /> Show all {allPosts.length} results
            </Button>
          )}
          {showAll && allPosts.length > 10 && (
            <Button
              variant="link"
              size="sm"
              className="mt-2 justify-self-start"
              onClick={() => setShowAll(false)}
            >
              <ChevronDown className="size-3.5 mr-1 rotate-180" /> Show less
            </Button>
          )}
        </AnalysisSection>
      )}

      {/* Out of range / undated counter */}
      {(allPosts.length > displayPosts.length || (allPosts.length > 10 && !showAll)) && (
        <p className="text-xs text-muted-foreground">
          {allPosts.length - displayPosts.length} more results were outside the date range or had no date.
        </p>
      )}
    </div>
  );
}

export interface AssistantMessageProps {
  message: ChatMessage;
  canRegenerate: boolean;
  onRegenerate: () => void;
}

export function AssistantMessage({
  message,
  canRegenerate,
  onRegenerate,
}: AssistantMessageProps) {
  const actions = (
    <MessageActions
      message={message}
      canRegenerate={canRegenerate}
      onRegenerate={onRegenerate}
    />
  );

  if (message.status === "error") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">Research failed</p>
            <p className="text-sm text-muted-foreground">{message.error ?? message.content}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRegenerate} disabled={!canRegenerate}>
            <RotateCcw className="size-3.5" /> Retry
          </Button>
          {actions}
        </div>
      </div>
    );
  }

  const analysis = message.analysis;

  const isPostCount = message.meta?.intentKind === "post_count";
  const instagramResults = message.meta?.instagramResults;

  if (instagramResults) {
    const intro = instagramResults.intro?.trim() ?? "";
    const summary = instagramResults.summary?.trim() ?? "";
    const followUp = instagramResults.followUp?.trim() ?? "";
    const hasConversation = Boolean(intro || summary || followUp);

    return (
      <div className="space-y-4">
        {hasConversation ? (
          <>
            {intro ? <MarkdownContent content={intro} className="mt-2 text-sm" /> : null}
            <InstagramResults
              key={`${message.id}-${message.meta?.generatedAt ?? ""}`}
              data={instagramResults}
            />
            {summary ? <MarkdownContent content={summary} className="text-sm" /> : null}
            {followUp ? (
              <p className="text-sm leading-relaxed text-muted-foreground">{followUp}</p>
            ) : null}
          </>
        ) : (
          <>
            {message.content.trim() ? (
              <MarkdownContent content={message.content} className="mt-2 text-sm" />
            ) : analysis ? (
              <p className="text-sm leading-relaxed">{analysis.executiveSummary}</p>
            ) : null}
            <InstagramResults
              key={`${message.id}-${message.meta?.generatedAt ?? ""}`}
              data={instagramResults}
            />
          </>
        )}
        {actions}
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="space-y-4">
        <MarkdownContent content={message.content} className="mt-2 text-sm" />
        {isPostCount && message.sources.length > 0 ? (
          <PostCountResults sources={message.sources} />
        ) : message.sources.length > 0 ? (
          <AnalysisSection title={`Sources (${message.sources.length})`}>
            <SourceList sources={message.sources} />
          </AnalysisSection>
        ) : null}
        {actions}
        {message.meta ? <ResearchMetaDetails meta={message.meta} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={analysis.confidence} />
        {message.status === "degraded" ? <Badge variant="warning">Partial evidence</Badge> : null}
      </div>

      <p className="text-[15px] leading-relaxed">{analysis.executiveSummary}</p>

      {analysis.narratives.length > 0 ? (
        <AnalysisSection title="Major narratives" kind="reported">
          <ClaimList claims={analysis.narratives} />
        </AnalysisSection>
      ) : null}

      {analysis.changes.length > 0 ? (
        <AnalysisSection title="What changed" kind="reported">
          <ClaimList claims={analysis.changes} />
        </AnalysisSection>
      ) : null}

      {analysis.whyItMatters ? (
        <AnalysisSection title="Why it matters" kind="interpretation">
          <p className="text-sm leading-relaxed text-muted-foreground">{analysis.whyItMatters}</p>
        </AnalysisSection>
      ) : null}

      {analysis.risks.length > 0 ? (
        <AnalysisSection title="Risks" kind="reported">
          <ClaimList claims={analysis.risks} />
        </AnalysisSection>
      ) : null}

      {analysis.opportunities.length > 0 ? (
        <AnalysisSection title="Opportunities" kind="interpretation">
          <ClaimList claims={analysis.opportunities} />
        </AnalysisSection>
      ) : null}

      {analysis.recommendedActions.length > 0 ? (
        <AnalysisSection title="Recommended next actions" kind="recommendation">
          <ol className="list-decimal space-y-2 pl-5">
            {analysis.recommendedActions.map((action, index) => (
              <li key={`${action.action}-${index}`}>
                <p className="text-sm font-medium">{action.action}</p>
                <p className="text-sm text-muted-foreground">{action.rationale}</p>
              </li>
            ))}
          </ol>
        </AnalysisSection>
      ) : null}

      {message.sources.length > 0 ? (
        <AnalysisSection title={`Sources (${message.sources.length})`}>
          <SourceList sources={message.sources} />
        </AnalysisSection>
      ) : null}

      {actions}
      {message.meta ? <ResearchMetaDetails meta={message.meta} /> : null}
    </div>
  );
}
