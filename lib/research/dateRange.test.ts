import { describe, expect, it } from "vitest";
import { resolveDateRangeApp, toSerpApiTbsApp } from "./dateRange";

const NOW = new Date("2026-10-27T12:00:00.000Z");

describe("resolveDateRangeApp timezone boundaries", () => {
  it("keeps the last-seven-days range on local calendar dates", () => {
    const range = resolveDateRangeApp({ preset: "7d" }, NOW);

    expect(range.from).toBe("2026-10-19T18:30:00.000Z");
    expect(range.to).toBe("2026-10-27T18:29:59.999Z");
    expect(range.label).toBe("Last 7 days");
    expect(toSerpApiTbsApp(range)).toBe("cdr:1,cd_min:10/20/2026,cd_max:10/27/2026");
  });

  it("keeps custom dates and provider filters on the requested local days", () => {
    const range = resolveDateRangeApp(
      {
        preset: "custom",
        from: "2026-10-20T00:00:00.000Z",
        to: "2026-10-27T00:00:00.000Z",
      },
      NOW,
    );

    expect(range.label).toBe("Oct 20, 2026 – Oct 27, 2026");
    expect(toSerpApiTbsApp(range)).toBe("cdr:1,cd_min:10/20/2026,cd_max:10/27/2026");
  });
});
