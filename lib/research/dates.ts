import type { ResearchResult, ResolvedDateRange } from "@/types";

export type DateRangePreset = "24h" | "7d" | "30d" | "90d" | "custom";

export interface DateRangeRequestInput {
  preset?: DateRangePreset;
  from?: string;
  to?: string;
}

const PRESET_DURATIONS: Record<Exclude<DateRangePreset, "custom">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

const PRESET_LABELS: Record<Exclude<DateRangePreset, "custom">, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const DEFAULT_PRESET: Exclude<DateRangePreset, "custom"> = "7d";

function endOfUtcDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function startOfUtcDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function parseBoundary(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolves a requested date range into concrete UTC boundaries.
 * Policy: all boundaries are UTC. The lower and upper bounds are inclusive.
 * When only a lower bound is supplied for a custom range, the upper bound is
 * "now". Date-only custom bounds are widened to the start/end of the UTC day.
 */
export function resolveDateRange(
  input: DateRangeRequestInput,
  now: Date = new Date(),
): ResolvedDateRange {
  const preset = input.preset ?? "custom";

  if (preset === "custom" || input.from || input.to) {
    const fromRaw = parseBoundary(input.from);
    const toRaw = parseBoundary(input.to);
    const from = fromRaw ? startOfUtcDay(fromRaw) : new Date(now.getTime() - PRESET_DURATIONS[DEFAULT_PRESET]);
    const to = toRaw ? endOfUtcDay(toRaw) : new Date(now);
    const resolvedPreset = preset === "custom" ? null : preset;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label: formatRangeLabel(from, to),
      timezone: "UTC",
      preset: resolvedPreset,
    };
  }

  const duration = PRESET_DURATIONS[preset];
  const to = new Date(now);
  const from = new Date(now.getTime() - duration);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: PRESET_LABELS[preset],
    timezone: "UTC",
    preset,
  };
}

export function previousPeriod(range: ResolvedDateRange): ResolvedDateRange {
  const fromMs = new Date(range.from).getTime();
  const toMs = new Date(range.to).getTime();
  const duration = toMs - fromMs;
  const prevTo = fromMs - 1;
  const prevFrom = prevTo - duration;
  return {
    from: new Date(prevFrom).toISOString(),
    to: new Date(prevTo).toISOString(),
    label: `Previous period (${range.label})`,
    timezone: "UTC",
    preset: range.preset,
  };
}

function formatRangeLabel(from: Date, to: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const fromLabel = formatter.format(from);
  const toLabel = formatter.format(to);
  return fromLabel === toLabel ? fromLabel : `${fromLabel} \u2013 ${toLabel}`;
}

export function isWithinRange(iso: string | null, range: ResolvedDateRange): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  return time >= from && time <= to;
}

export interface DateFilterResult {
  included: ResearchResult[];
  excluded: ResearchResult[];
  undated: ResearchResult[];
}

export function filterByDate(
  results: ResearchResult[],
  range: ResolvedDateRange,
): DateFilterResult {
  const included: ResearchResult[] = [];
  const excluded: ResearchResult[] = [];
  const undated: ResearchResult[] = [];

  for (const result of results) {
    if (!result.publishedAt) {
      undated.push(result);
      continue;
    }
    if (isWithinRange(result.publishedAt, range)) {
      included.push(result);
    } else {
      excluded.push(result);
    }
  }

  return { included, excluded, undated };
}

export function toSerpApiTbs(range: ResolvedDateRange): string {
  const format = (iso: string) => {
    const date = new Date(iso);
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
  };
  const min = format(range.from);
  const max = format(range.to);
  return `cdr:1,cd_min:${min},cd_max:${max}`;
}

export function toDateOnly(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

const RELATIVE_PATTERNS: Array<[RegExp, (match: RegExpMatchArray) => number]> = [
  [/^(\d+)\s*min(ute)?s?\s*ago$/i, (m) => Number(m[1]) * 60 * 1000],
  [/^(\d+)\s*hour?s?\s*ago$/i, (m) => Number(m[1]) * 60 * 60 * 1000],
  [/^(\d+)\s*day?s?\s*ago$/i, (m) => Number(m[1]) * 24 * 60 * 60 * 1000],
  [/^(\d+)\s*week?s?\s*ago$/i, (m) => Number(m[1]) * 7 * 24 * 60 * 60 * 1000],
];

/**
 * Parses a provider-supplied publication date. Only returns a value when it can
 * be interpreted; never invents a date. Relative strings are resolved against
 * `now`.
 */
export function parsePublishedDate(
  raw: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const relative = value.match(/^(\d+)\s*(minute|hour|day|week)s?\s*ago$/i);
  if (relative) {
    for (const [pattern, compute] of RELATIVE_PATTERNS) {
      const match = value.match(pattern);
      if (match) {
        return new Date(now.getTime() - compute(match)).toISOString();
      }
    }
  }
  if (/^yesterday$/i.test(value)) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }
  if (/^(today|just now)$/i.test(value)) {
    return now.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
