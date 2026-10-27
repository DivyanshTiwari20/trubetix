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

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

function calendarDateParts(date: Date, tz: string): CalendarDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function localMidnightInTz(dateParts: CalendarDateParts, tz: string): Date {
  const desiredWallTime = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let candidate = desiredWallTime;

  // Convert the requested wall-clock midnight to its actual UTC instant.
  // Iteration accounts for the timezone offset without assuming a fixed offset.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const representedWallTime = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    );
    const adjustment = desiredWallTime - representedWallTime;
    if (adjustment === 0) return new Date(candidate);
    candidate += adjustment;
  }

  return new Date(candidate);
}

function endOfDayInTz(date: Date, tz: string): Date {
  const localDate = calendarDateParts(date, tz);
  const nextDay = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + 1));
  const nextLocalMidnight = localMidnightInTz(calendarDateParts(nextDay, "UTC"), tz);
  return new Date(nextLocalMidnight.getTime() - 1);
}

function startOfDayInTz(date: Date, tz: string): Date {
  return localMidnightInTz(calendarDateParts(date, tz), tz);
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
    const { year, month, day } = calendarDateParts(new Date(iso), range.timezone);
    return `${month}/${day}/${year}`;
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