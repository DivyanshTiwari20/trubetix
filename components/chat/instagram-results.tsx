"use client";

import { ExternalLink } from "lucide-react";
import type { InstagramResultsView } from "@/types";
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

function available(value: string | null | undefined): string {
  return value?.trim() ? value : "Unavailable";
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
  const estimate = available(data.googleEstimatedResults);

  return (
    <section className="space-y-4" aria-label={`Instagram results for ${data.entity}`}>
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Instagram results
        </p>
        <h2 className="text-lg font-semibold tracking-tight">{data.entity}</h2>
        <p className="text-sm text-muted-foreground">{data.dateRangeLabel}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard
          label="Google estimated search results"
          value={estimate}
          description="Approximate results indexed by Google for this search window."
        />
        <MetricCard
          label="Posts shown"
          value={data.posts.length.toLocaleString("en-US")}
          description="Unique Instagram posts retrieved and displayed below."
        />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Google's estimate is approximate and is not an Instagram-wide post count.
      </p>

      <Card className="overflow-hidden shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Retrieved posts</CardTitle>
          <CardDescription>Unique results from this search; long previews can be expanded.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.posts.length ? (
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-[190px]">Post</TableHead>
                  <TableHead className="w-[380px]">Preview</TableHead>
                  <TableHead className="w-[190px]">Hashtags</TableHead>
                  <TableHead className="w-[130px]">Account</TableHead>
                  <TableHead className="w-[140px]">Engagement</TableHead>
                  <TableHead className="w-[130px]">Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.posts.map((post, index) => {
                  const postUrl = safeInstagramUrl(post.url);
                  const title = readablePostTitle(post.title);
                  const account = post.account && post.account !== "unknown"
                    ? `@${post.account.replace(/^@/, "")}`
                    : "Unavailable";
                  const caption = post.caption?.trim() ?? "";
                  const snippet = post.snippet?.trim() ?? "";
                  const hashtags = [...new Set([...post.hashtags, ...post.snippetHashtags])];

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
                      <TableCell className="whitespace-normal break-words">
                        <HashtagList tags={hashtags} />
                      </TableCell>
                      <TableCell className="whitespace-normal break-words">{account}</TableCell>
                      <TableCell className="whitespace-normal break-words">
                        <dl className="space-y-1.5 text-sm">
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">Likes</dt>
                            <dd className="font-medium tabular-nums">{available(post.likes)}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">Comments</dt>
                            <dd className="font-medium tabular-nums">{available(post.comments)}</dd>
                          </div>
                        </dl>
                      </TableCell>
                      <TableCell className="whitespace-normal break-words">{available(post.postedDate)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
