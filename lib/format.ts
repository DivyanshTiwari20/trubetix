export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = now - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "Just now";
  if (diff < hour) {
    const minutes = Math.floor(diff / minute);
    return `${minutes}m ago`;
  }
  if (diff < day) {
    const hours = Math.floor(diff / hour);
    return `${hours}h ago`;
  }
  if (diff < 7 * day) {
    const days = Math.floor(diff / day);
    return `${days}d ago`;
  }
  return formatAbsoluteDate(iso);
}

export function formatAbsoluteDate(iso: string, locale = "en-US"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(iso: string, locale = "en-US"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDayLabel(iso: string, locale = "en-US"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
}

export type ConversationGroup =
  | "Today"
  | "Yesterday"
  | "Previous 7 Days"
  | "Previous 30 Days"
  | "Older";

export function groupForTimestamp(iso: string, now: number = Date.now()): ConversationGroup {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Older";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const startToday = startOfToday.getTime();

  if (then >= startToday) return "Today";
  if (then >= startToday - dayMs) return "Yesterday";
  if (then >= startToday - 7 * dayMs) return "Previous 7 Days";
  if (then >= startToday - 30 * dayMs) return "Previous 30 Days";
  return "Older";
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function formatCompactCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value.trim() : "";
  if (typeof value === "string" && !text) return "";
  const numeric = typeof value === "number" ? value : Number(text.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return text;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(numeric);
}
