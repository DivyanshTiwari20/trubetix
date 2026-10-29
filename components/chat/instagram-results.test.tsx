import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InstagramResultsView } from "@/types";
import { InstagramResults } from "./instagram-results";

describe("Instagram estimate card", () => {
  it("renders the provider estimate separately from posts shown", () => {
    const data: InstagramResultsView = {
      entity: "Salman Khan",
      dateRangeLabel: "Oct 20, 2026 – Oct 27, 2026",
      googleEstimatedResults: "34",
      estimateQuery: "site:instagram.com Salman Khan",
      estimateProvenance: {
        query: "site:instagram.com Salman Khan",
        queryDisplayed: "site:instagram.com Salman Khan",
        parameters: {
          engine: "google",
          q: "site:instagram.com Salman Khan",
          num: "10",
          hl: "en",
          gl: "us",
          google_domain: "google.com",
          tbs: "cdr:1,cd_min:10/20/2026,cd_max:10/27/2026",
          start: "0",
        },
        totalResults: 34,
      },
      isCountRequest: true,
      posts: [],
    };

    render(<InstagramResults data={data} />);

    expect(screen.getByText("Estimated matching results")).toBeInTheDocument();
    expect(screen.getByText("34", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Showing")).toBeInTheDocument();
    expect(screen.getByText("0 posts")).toBeInTheDocument();
    expect(screen.getByText("Oct 20, 2026 – Oct 27, 2026")).toBeInTheDocument();
  });
});
