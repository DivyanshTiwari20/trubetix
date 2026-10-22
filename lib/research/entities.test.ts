import { describe, expect, it } from "vitest";
import { detectIntentKind, detectPlatform, detectResearchMode, extractEntities } from "./entities";

describe("detectResearchMode", () => {
  it("detects explicit profile requests", () => {
    expect(detectResearchMode("Show me this person's Instagram profile")).toBe("profile");
    expect(detectResearchMode("How many followers does @nasa have?")).toBe("profile");
    expect(detectResearchMode("What are the last two posts on their profile?")).toBe("profile");
  });

  it("detects social listening questions", () => {
    expect(detectResearchMode("What are people saying about Ramayana on Instagram?")).toBe("social");
    expect(detectResearchMode("What's buzzing around Salman Khan this week?")).toBe("social");
    expect(
      detectResearchMode("Tell me what you find on Instagram about the film Ramayana"),
    ).toBe("social");
  });

  it("defaults to general research", () => {
    expect(detectResearchMode("What are the latest developments about Acme Corp?")).toBe("general");
    expect(detectResearchMode("Analyze the latest narratives around my client.")).toBe("general");
  });
});

describe("detectPlatform", () => {
  it("detects explicitly named platforms", () => {
    expect(detectPlatform("posts on Instagram")).toBe("instagram");
    expect(detectPlatform("discussion on reddit")).toBe("reddit");
    expect(detectPlatform("the latest news")).toBeNull();
  });
});

describe("extractEntities", () => {
  it("excludes platform names from the subject entities", () => {
    const result = extractEntities(
      "Tell me what you find on Instagram about the film Ramayana",
    );
    expect(result.entities).not.toContain("Instagram");
    expect(result.entities).toContain("Ramayana");
    expect(result.mode).toBe("social");
    expect(result.platform).toBe("instagram");
  });

  it("parses the full social listening request from Test A", () => {
    const result = extractEntities(
      "What is the overall buzz on Instagram about the Ramayana film starring Ranbir Kapoor in the last 24 hours?",
    );
    expect(result.subject).toBe("Ramayana");
    expect(result.intentKind).toBe("social_listening");
    expect(result.mode).toBe("social");
    expect(result.platform).toBe("instagram");
    expect(result.entities).toContain("Ranbir Kapoor");
    expect(result.datePreset).toBe("24h");
    expect(result.needsClarification).toBe(false);
  });

  it("classifies sentiment phrasing as social listening, not profile research", () => {
    const result = extractEntities(
      "What are people saying about Ranbir Kapoor's portrayal of Rama?",
    );
    expect(result.intentKind).toBe("sentiment");
    expect(result.mode).toBe("social");
    expect(result.entities).toContain("Ranbir Kapoor");
  });

  it("treats recent-post lookups as profile requests needing a handle", () => {
    const result = extractEntities("Show me the last two posts on this person's Instagram profile.");
    expect(result.intentKind).toBe("post_discovery");
    expect(result.mode).toBe("profile");
    expect(result.handles).toHaveLength(0);
    expect(result.needsClarification).toBe(true);
    expect(result.clarification).toContain("account");
  });

  it("treats follower counts as profile metrics, not social listening", () => {
    const result = extractEntities("How many followers does this account have?");
    expect(result.intentKind).toBe("profile_metrics");
    expect(result.mode).toBe("profile");
    expect(result.needsClarification).toBe(true);
  });

  it("extracts a handle from a @mention for profile requests", () => {
    const result = extractEntities("Show me the last two posts on @nasa's Instagram profile.");
    expect(result.intentKind).toBe("post_discovery");
    expect(result.handles).toEqual(["nasa"]);
    expect(result.needsClarification).toBe(false);
  });

  it("asks for a subject when the question contains only intent words", () => {
    const result = extractEntities("What's the buzz on Instagram?");
    expect(result.intentKind).toBe("social_listening");
    expect(result.subject).toBeNull();
    expect(result.entities).toHaveLength(0);
    expect(result.needsClarification).toBe(true);
  });

  it("resolves 'the film' from an earlier turn", () => {
    const result = extractEntities("What's the reaction to the film?", {
      history: ["What's the buzz about Ramayana?"],
    });
    expect(result.usedHistory).toBe(true);
    expect(result.entities).toContain("Ramayana");
    expect(result.subject).toBe("Ramayana");
    expect(result.needsClarification).toBe(false);
  });

  it("classifies an Instagram conversation-volume question as social listening, not profile metrics", () => {
    const result = extractEntities(
      "what is the overall news about the Ramayan film of Vinayak Kapoor in the last 7 days, let's say, on Instagram what are people saying? What is the overall number of posts, let's say, or the overall content posted about it, negative and positive both?",
    );
    expect(result.intentKind).not.toBe("profile_metrics");
    expect(result.intentKind).toBe("post_count");
    expect(result.mode).toBe("social");
    expect(result.datePreset).toBe("7d");
    expect(result.subject).not.toBeNull();
    expect(result.needsClarification).toBe(false);
  });

  it("never falls back to an intent word as the subject", () => {
    const result = extractEntities("What is the overall number of posts on Instagram about Ramayan?");
    expect(result.subject).toBe("Ramayan");
    expect(result.needsClarification).toBe(false);
  });

  it("still asks for an account when the numbers clearly belong to one", () => {
    const result = extractEntities("What are the overall numbers for this account?");
    expect(result.intentKind).toBe("profile_metrics");
    expect(result.needsClarification).toBe(true);
  });

  it("resolves a subject that only the assistant named", () => {
    const result = extractEntities("How are fans reacting to the film?", {
      history: [
        "What's the buzz about Ramayana?",
        "Findings: early reactions to the Ramayana teaser are positive.",
      ],
    });
    expect(result.usedHistory).toBe(true);
    expect(result.entities).toContain("Ramayana");
  });
});

describe("detectIntentKind", () => {
  it("classifies social listening versus profile lookups", () => {
    expect(detectIntentKind("What's the overall Instagram buzz about Ramayana?")).toBe("social_listening");
    expect(detectIntentKind("What are people reacting to about Ramayana?")).toBe("sentiment");
    expect(detectIntentKind("How many followers does @nasa have?")).toBe("profile_metrics");
    expect(detectIntentKind("Show me their latest posts")).toBe("post_discovery");
    expect(detectIntentKind("Show me this person's Instagram profile")).toBe("profile_lookup");
    expect(detectIntentKind("What are the latest developments about Acme Corp?")).toBe("general");
  });
});
