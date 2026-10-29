"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { InstagramResultsView } from "@/types";
import { formatCompactCount } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
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

function formatAccount(value: string | null | undefined): string {
  const raw = (value ?? "").trim().replace(/^@/, "");
  if (!raw || raw.toLowerCase() === "unknown") return "Unavailable";
  return /^[A-Za-z0-9._]+$/.test(raw) ? `@${raw}` : raw;
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
  description: string;
}) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="gap-2 pb-2">
        <CardDescription className="font-medium text-foreground">{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function HashtagList({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-sm text-muted-foreground">None found</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag, index) => (
        <Badge key={`${tag}-${index}`} variant="secondary" className="max-w-full break-all font-normal">
          {tag.startsWith("#") ? tag : `#${tag}`}
        </Badge>
      ))}
    </div>
  );
}

function PreviewField({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="line-clamp-3 whitespace-pre-wrap break-words leading-relaxed">{text}</p>
      {text.length > 180 ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-xs font-medium text-primary marker:hidden">
            <span className="group-open:hidden">Read more</span>
            <span className="hidden group-open:inline">Show less</span>
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{text}</p>
        </details>
      ) : null}
    </div>
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
            label="Google estimated search results"
            value={estimate}
            description="Approximate results indexed by Google for this search window."
          />
        ) : null}
        <MetricCard
          label={retrievalSource === "apify" ? "Posts retrieved" : "Posts found"}
          value={data.posts.length.toLocaleString("en-US")}
          description="Unique posts fetched; Show more reveals additional rows without another search."
        />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {retrievalSource === "google"
          ? "Google's estimate is approximate and is not an Instagram-wide post count."
          : "Apify keyword/hashtag results are provider-limited, not an Instagram-wide post count; the selected date window is applied to returned timestamps."}
      </p>

      <Card className="overflow-hidden shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Retrieved posts</CardTitle>
          <CardDescription>Unique results from this search; long previews can be expanded.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.posts.length ? (
            <>
            <Table className="min-w-[1200px]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-[190px]">Post</TableHead>
                  <TableHead className="w-[380px]">Preview</TableHead>
                  <TableHead className="w-[180px]">Likes</TableHead>
                  <TableHead className="w-[190px]">Hashtags</TableHead>
                  <TableHead className="w-[130px]">Posted</TableHead>
                  <TableHead className="w-[130px]">Account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePosts.map((post, index) => {
                  const postUrl = safeInstagramUrl(post.url);
                  const title = readablePostTitle(post.title);
                  const account = formatAccount(post.account);
                  const caption = post.caption?.trim() ?? "";
                  const snippet = post.snippet?.trim() ?? "";
                  const hashtags = [...new Map(
                    [...post.hashtags, ...post.snippetHashtags].map((tag) => [tag.toLowerCase(), tag] as const),
                  ).values()];

                  return (
                    <TableRow key={post.url || index} className="align-top">
                      <TableCell className="whitespace-normal break-words">
                        {postUrl ? (
                          <a
                            href={postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={title}
                            aria-label={`Open Instagram post: ${title}`}
                            className="inline-flex max-w-full items-start gap-1 font-medium text-primary underline-offset-4 hover:underline"
                          >
                            <span className="line-clamp-2 break-words">{title}</span>
                            <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="font-medium">{title}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal break-words">
                        <div className="max-w-[380px] space-y-3">
                          {caption ? (
                            <PreviewField label="Caption" text={caption} />
                          ) : snippet ? (
                            <PreviewField label="Search preview" text={snippet} />
                          ) : (
                            <span className="text-sm text-muted-foreground">Preview unavailable</span>
                          )}
                          {caption && snippet ? (
                            <details className="group">
                              <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground marker:hidden">
                                Search preview
                              </summary>
                              <div className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed">
                                {snippet}
                              </div>
                            </details>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium tabular-nums">
                        {formatLikeCount(post.likes)}
                      </TableCell>
                      <TableCell className="whitespace-normal break-words">
                        <HashtagList tags={hashtags} />
                      </TableCell>
                      <TableCell className="whitespace-normal break-words">{available(post.postedDate)}</TableCell>
                      <TableCell className="whitespace-normal break-words">{account}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {remainingPosts > 0 ? (
              <div className="flex flex-col items-center gap-2 border-t px-4 py-4 sm:flex-row sm:justify-between">
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
            <div className="px-5 pb-5 text-sm text-muted-foreground">
              No posts were returned for this search window.
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
