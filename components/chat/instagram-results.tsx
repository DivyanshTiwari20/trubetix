"use client";

import { useState } from "react";
import type { InstagramResultsView } from "@/types";
import { formatCompactCount } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const INITIAL_VISIBLE_POSTS = 10;
const POSTS_PER_REVEAL = 10;

function available(value: string | null | undefined): string {
  return value?.trim() ? value : "Unavailable";
}

function formatLikeCount(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "Unavailable";
  return trimmed.replace(/\s+likes?$/i, "").trim();
}

function formatEstimate(value: string | null | undefined): string {
  return formatCompactCount(value) || "Unavailable";
}

function safeInstagramUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)instagram\.com$/i.test(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function readablePostTitle(value: string | null | undefined): string {
  const title = value?.trim() ?? "";
  if (
    !title ||
    title === "Not returned" ||
    /^https?:\/\//i.test(title) ||
    /(?:^|\s)(?:www\.)?instagram\.com\//i.test(title)
  ) {
    return "View Instagram post";
  }
  return title;
}

function MetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="gap-2 pb-2">
        <CardDescription className="font-medium text-foreground">{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums tracking-tight">{value}</CardTitle>
      </CardHeader>
      {description ? (
        <CardContent>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function HashtagList({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex flex-col gap-0.5">
      {tags.map((tag, index) => (
        <span key={`${tag}-${index}`} className="break-all">
          {tag.startsWith("#") ? tag : `#${tag}`}
        </span>
      ))}
    </div>
  );
}

function PreviewText({ caption, snippet }: { caption: string; snippet: string }) {
  const text = caption || snippet;
  if (!text) return <span className="text-muted-foreground">Preview unavailable</span>;

  return (
    <p className="line-clamp-2 whitespace-pre-wrap break-words leading-relaxed" title={text}>
      {text}
    </p>
  );
}

export function InstagramResults({ data }: { data: InstagramResultsView }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_POSTS);
  const retrievalSource = data.retrievalSource ?? "google";
  const estimate = formatEstimate(data.googleEstimatedResults);
  const visiblePosts = data.posts.slice(0, visibleCount);
  const remainingPosts = data.posts.length - visiblePosts.length;

  return (
    <section className="space-y-4" aria-label={`Instagram results for ${data.entity}`}>
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Instagram results
        </p>
        <h2 className="text-lg font-semibold tracking-tight">{data.entity}</h2>
        <p className="text-sm text-muted-foreground">{data.dateRangeLabel}</p>
      </header>

      <div className={`grid gap-3 ${retrievalSource === "google" ? "sm:grid-cols-2" : ""}`}>
        {retrievalSource === "google" ? (
          <MetricCard
            label="Estimated matching results"
            value={estimate}
            description="Approximate number of results for this search window."
          />
        ) : null}
        <MetricCard
          label="Showing"
          value={`${data.posts.length.toLocaleString("en-US")} ${data.posts.length === 1 ? "post" : "posts"}`}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-semibold">Retrieved posts</h3>
          <p className="text-xs text-muted-foreground">Unique results from this search.</p>
        </div>
        {data.posts.length ? (
          <>
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="h-auto w-[170px] px-3 py-3 text-sm font-medium text-foreground">
                    Post
                  </TableHead>
                  <TableHead className="h-auto w-[320px] px-3 py-3 text-sm font-medium text-foreground">
                    Preview
                  </TableHead>
                  <TableHead className="h-auto w-[90px] px-3 py-3 text-sm font-medium text-foreground">
                    Likes
                  </TableHead>
                  <TableHead className="h-auto w-[150px] px-3 py-3 text-sm font-medium text-foreground">
                    Hashtags
                  </TableHead>
                  <TableHead className="h-auto w-[120px] px-3 py-3 text-sm font-medium text-foreground">
                    Posted
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePosts.map((post, index) => {
                  const postUrl = safeInstagramUrl(post.url);
                  const title = readablePostTitle(post.title);
                  const caption = post.caption?.trim() ?? "";
                  const snippet = post.snippet?.trim() ?? "";
                  const hashtags = [...new Map(
                    [...post.hashtags, ...post.snippetHashtags].map((tag) => [tag.toLowerCase(), tag] as const),
                  ).values()];

                  return (
                    <TableRow
                      key={post.url || index}
                      className="border-b border-border/70 align-top hover:bg-transparent"
                    >
                      <TableCell className="whitespace-normal break-words px-3 py-4">
                        {postUrl ? (
                          <a
                            href={postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={title}
                            aria-label={`Open Instagram post: ${title}`}
                            className="font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            <span className="line-clamp-2 break-words">{title}</span>
                          </a>
                        ) : (
                          <span className="font-medium">{title}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal break-words px-3 py-4">
                        <PreviewText caption={caption} snippet={snippet} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-4 tabular-nums">
                        {formatLikeCount(post.likes)}
                      </TableCell>
                      <TableCell className="whitespace-normal break-words px-3 py-4">
                        <HashtagList tags={hashtags} />
                      </TableCell>
                      <TableCell className="whitespace-normal break-words px-3 py-4">
                        {available(post.postedDate)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {remainingPosts > 0 ? (
              <div className="flex flex-col items-center gap-2 border-t border-border px-3 py-4 sm:flex-row sm:justify-between">
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  Showing {visiblePosts.length.toLocaleString("en-US")} of {data.posts.length.toLocaleString("en-US")} posts
                </p>
                <button
                  type="button"
                  onClick={() => setVisibleCount((current) => Math.min(current + POSTS_PER_REVEAL, data.posts.length))}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Show ${Math.min(POSTS_PER_REVEAL, remainingPosts)} more Instagram posts`}
                >
                  Show more posts
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="space-y-1 py-4 text-sm text-muted-foreground">
            <p>{data.emptyNote ?? "No posts were returned for this search window."}</p>
            <p className="text-xs">Posts outside the selected window are excluded, not counted.</p>
          </div>
        )}
      </div>
    </section>
  );
}
