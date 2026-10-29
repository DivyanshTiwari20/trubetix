export const APP_NAME = "Tubitex";
export const APP_DESCRIPTION =
  "Tubitex is a PR and social media intelligence assistant. Ask a question about a client, topic, or competitor and get an evidence-backed briefing drawn from live conversation and coverage.";

export const LIMITS = {
  questionMaxLength: 2000,
  titleMaxLength: 80,
  maxHistoryMessages: 8,
  maxHistoryMessageLength: 1500,
  resultSnippetMaxLength: 600,
} as const;

export const RESEARCH_DEFAULTS = {
  maxQueries: 5,
  maxResultsPerQuery: 10,
  maxEvidence: 24,
  maxInstagramQueries: 6,
  maxInstagramProfiles: 3,
  maxGooglePages: 10,
  maxSerpApiSearches: 15,
  researchTimeoutMs: 60_000,
  timeoutMs: 120_000,
  maxRetries: 2,
  temperature: 0.3,
  instagramSimple: true,
} as const;

export const STORAGE_KEYS = {
  conversations: "tubitex.conversations.v1",
  activeConversation: "tubitex.activeConversation.v1",
  sidebarCollapsed: "tubitex.sidebarCollapsed.v1",
  researchPanel: "tubitex.researchPanel.v1",
  datePreset: "tubitex.datePreset.v1",
  searchMode: "tubitex.searchMode.v1",
} as const;

export const EXAMPLE_PROMPTS = [
  "What's buzzing around Salman Khan this week?",
  "Analyze the latest narratives around my client.",
  "What changed in the media conversation this week?",
  "Identify potential reputational risks.",
] as const;

export const DATE_RANGE_PRESETS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;

export const APP_TZ = "Asia/Kolkata";

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  news: "News",
  blog: "Blog",
  social: "Social",
  forum: "Forum",
  government: "Government",
  company: "Company",
  other: "Other",
};
