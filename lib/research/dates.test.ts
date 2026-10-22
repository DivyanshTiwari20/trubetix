import { describe, expect, it } from "vitest";
import {
  filterByDate,
  isWithinRange,
  parsePublishedDate,
  previousPeriod,
  resolveDateRange,
  toSerpApiTbs,
} from "./dates";
import { makeResult } from "@/tests/fixtures";

const NOW = new Date("2026-05-10T12:00:00.000Z");

describe("resolveDateRange", () => {
  it("resolves a preset into an inclusive window ending now (UTC)", () => {
    const range = resolveDateRange({ preset: "7d" }, NOW);
    expect(range.from).toBe("2026-05-03T12:00:00.000Z");
    expect(range.to).toBe("2026-05-10T12:00:00.000Z");
    expect(range.label).toBe("Last 7 days");
    expect(range.timezone).toBe("UTC");
    expect(range.preset).toBe("7d");
  });

  it("widens a custom date-only range to whole UTC days", () => {
    const range = resolveDateRange({ preset: "custom", from: "2026-05-01", to: "2026-05-03" }, NOW);
    expect(range.from).toBe("2026-05-01T00:00:00.000Z");
    expect(range.to).toBe("2026-05-03T23:59:59.999Z");
    expect(range.preset).toBeNull();
  });

  it("uses now as the upper bound when only a lower bound is given", () => {
    const range = resolveDateRange({ from: "2026-05-01" }, NOW);
    expect(range.from).toBe("2026-05-01T00:00:00.000Z");
    expect(range.to).toBe(NOW.toISOString());
  });
});

describe("previousPeriod", () => {
  it("returns the contiguous window immediately before the current one", () => {
    const range = resolveDateRange({ preset: "7d" }, NOW);
    const previous = previousPeriod(range);
    expect(previous.to).toBe("2026-05-03T11:59:59.999Z");
    expect(previous.from).toBe("2026-04-26T11:59:59.999Z");
    expect(previous.label).toBe("Previous period (Last 7 days)");
    expect(previous.preset).toBe("7d");
  });
});

describe("isWithinRange", () => {
  const range = resolveDateRange({ preset: "7d" }, NOW);

  it("treats both boundaries as inclusive", () => {
    expect(isWithinRange(range.from, range)).toBe(true);
    expect(isWithinRange(range.to, range)).toBe(true);
  });

  it("rejects null, invalid and out-of-window dates", () => {
    expect(isWithinRange(null, range)).toBe(false);
    expect(isWithinRange("not-a-date", range)).toBe(false);
    expect(isWithinRange("2026-04-01T00:00:00.000Z", range)).toBe(false);
  });
});

describe("filterByDate", () => {
  it("classifies included, excluded and undated results", () => {
    const range = resolveDateRange({ preset: "7d" }, NOW);
    const included = makeResult({ publishedAt: "2026-05-05T00:00:00.000Z" });
    const excluded = makeResult({ publishedAt: "2026-01-01T00:00:00.000Z" });
    const undated = makeResult({ publishedAt: null });

    const result = filterByDate([included, excluded, undated], range);
    expect(result.included).toEqual([included]);
    expect(result.excluded).toEqual([excluded]);
    expect(result.undated).toEqual([undated]);
  });
});

describe("toSerpApiTbs", () => {
  it("formats the window as a SerpAPI custom date range", () => {
    const range = resolveDateRange({ preset: "7d" }, NOW);
    expect(toSerpApiTbs(range)).toBe("cdr:1,cd_min:5/3/2026,cd_max:5/10/2026");
  });
});

describe("parsePublishedDate", () => {
  it("resolves relative strings against now", () => {
    expect(parsePublishedDate("2 days ago", NOW)).toBe("2026-05-08T12:00:00.000Z");
    expect(parsePublishedDate("3 hours ago", NOW)).toBe("2026-05-10T09:00:00.000Z");
    expect(parsePublishedDate("yesterday", NOW)).toBe("2026-05-09T12:00:00.000Z");
    expect(parsePublishedDate("today", NOW)).toBe(NOW.toISOString());
  });

  it("passes through valid absolute dates", () => {
    expect(parsePublishedDate("2026-01-02T00:00:00.000Z", NOW)).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("never invents a date", () => {
    expect(parsePublishedDate(null, NOW)).toBeNull();
    expect(parsePublishedDate("", NOW)).toBeNull();
    expect(parsePublishedDate("sometime last year", NOW)).toBeNull();
  });
});
