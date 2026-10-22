import { APP_TZ } from "@/lib/config";
import type { DateRangeRequestInput } from "./dates";
import type { ResearchResult } from "@/types";

export interface ResolvedDateRangeApp {
  from: string;
  to: string;
  label: string;
  timezone: string;
  preset: string | null;
}

function endOfDayInTz(date: Date, tz: string): Date {
  const copy = new Date(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(copy);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
  const day = Number(parts.find((p) => p.type === "day")?.value);
  copy.setUTCFullYear(year, month, day);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function startOfDayInTz(date: Date, tz: string): Date {
  const copy = new Date(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(copy);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
  const day = Number(parts.find((p) => p.type === "day")?.value);
  copy.setUTCFullYear(year, month, day);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function parseBoundary(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const PRESET_DURATIONS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

const PRESET_LABELS: Record<string, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const DEFAULT_PRESET = "7d";

function formatRangeLabel(from: Date, to: Date, tz: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  });
  const fromLabel = formatter.format(from);
  const toLabel = formatter.format(to);
  return fromLabel === toLabel ? fromLabel : `${fromLabel} \u2013 ${toLabel}`;
}

export function resolveDateRangeApp(
  input: DateRangeRequestInput,
  now: Date = new Date(),
): ResolvedDateRangeApp {
  const preset = input.preset ?? "custom";

  if (preset === "custom" || input.from || input.to) {
    const fromRaw = parseBoundary(input.from);
    const toRaw = parseBoundary(input.to);
    const from = fromRaw ? startOfDayInTz(fromRaw, APP_TZ) : startOfDayInTz(new Date(now.getTime() - PRESET_DURATIONS[DEFAULT_PRESET]), APP_TZ);
    const to = toRaw ? endOfDayInTz(toRaw, APP_TZ) : endOfDayInTz(now, APP_TZ);
    const resolvedPreset = preset === "custom" ? null : preset;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label: formatRangeLabel(from, to, APP_TZ),
      timezone: APP_TZ,
      preset: resolvedPreset,
    };
  }

  const duration = PRESET_DURATIONS[preset];
  const to = endOfDayInTz(now, APP_TZ);
  const from = startOfDayInTz(new Date(now.getTime() - duration), APP_TZ);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: PRESET_LABELS[preset],
    timezone: APP_TZ,
    preset,
  };
}

export function toSerpApiTbsApp(range: ResolvedDateRangeApp): string {
  const format = (iso: string) => {
    const date = new Date(iso);
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
  };
  const min = format(range.from);
  const max = format(range.to);
  return `cdr:1,cd_min:${min},cd_max:${max}`;
}

export function toDateOnlyApp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function isWithinRangeApp(iso: string | null, range: ResolvedDateRangeApp): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  return time >= from && time <= to;
}

export interface DateFilterResultApp {
  included: ResearchResult[];
  excluded: ResearchResult[];
  undated: ResearchResult[];
}

export function filterByDateApp(
  results: ResearchResult[],
  range: ResolvedDateRangeApp,
): DateFilterResultApp {
  const included: ResearchResult[] = [];
  const excluded: ResearchResult[] = [];
  const undated: ResearchResult[] = [];

  for (const result of results) {
    if (!result.publishedAt) {
      undated.push(result);
      continue;
    }
    if (isWithinRangeApp(result.publishedAt, range)) {
      included.push(result);
    } else {
      excluded.push(result);
    }
  }

  return { included, excluded, undated };
}