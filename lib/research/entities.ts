import type { ResearchIntent } from "@/types";
import type { DateRangePreset } from "./dates";

const STOPWORDS = new Set([
  "what","what's","whats","how","why","when","where","which","who","whom","whose","is","are","was","were","do","does","did","can","could","should","would","will","shall","may","might","must","the","a","an","and","or","but","if","then","than","that","this","these","those","there","their","them","they","it","its","of","to","in","on","at","for","with","from","by","about","into","over","under","again","further","once","here","all","any","some","no","not","only","own","same","so","too","very","just","please","tell","give","show","find","analyze","analyse","identify","summarize","summarise","explain","describe","report","around","regarding","concerning","our","my","we","i","us","you","your","client","clients","latest","recent","new","major","most","last","past","next","week","weeks","month","months","day","days","year","years","today","yesterday","media","conversation","narratives","narrative","risks","risk","changes","change","developments","happening","buzzing","buzz","happened","cover","coverage","story","stories","outlet","outlets","press","publication","publications","competitor","competitors","reputational","reputation","potential","team","should","investigate","recommend","actions","action","things","thing","much","many","more","less","anyone","someone","anything","everything","something","instagram","insta","ig","tiktok","twitter","facebook","youtube","linkedin","reddit","threads","social","reel","reels","viral","trending","trend","sentiment","reaction","reactions","reacting","respond","responding","response","comments","comment","engagement","followers","follower","following","profile","profiles","account","accounts","bio","people","saying","opinions","opinion","numbers","number","metric","metrics","statistics","statistic","stats","stat","figures","figure","count","counts","data","insights","insight","performance","reach","impressions","views","likes","shares","growth","overall","film","movie","series","show","person","handle","username","user","portrayal","role","character","acting","starring","star","actor","actress","fans","fan","public","online","discussion","conversations","activity","update","updates","specific","specifically","actually","currently","right","now","old","good","bad","positive","negative","mixed","think","thinking","thought","thoughts","feel","feeling","feelings","really","honestly","kindly","quickly","exactly","one","two","three","four","five","six","seven","eight","nine","ten","first","second","third","fourth","fifth","couple","few","several"]);
const SENTENCE_START_EXCEPTIONS = new Set(["the","a","an","this","that","these","those","what","how","why","when","where","which","who","our","my"]);

function isAllStopwords(phrase: string): boolean {
  const tokens = phrase.toLowerCase().split(/\s+/);
  return tokens.every((token) => STOPWORDS.has(token.replace(/[^a-z0-9']/g, "")));
}

function stripPossessive(value: string): string {
  return value.replace(/['\u2019]s\b/g, "").trim();
}

function extractCapitalizedPhrases(question: string): string[] {
  const results: string[] = [];
  const regex = /\b([A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*){0,2})\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(question)) !== null) {
    const phrase = stripPossessive(match[1].trim());
    if (phrase.length < 2) continue;
    if (isAllStopwords(phrase)) continue;
    results.push(phrase);
  }
  return results;
}

function extractQuotedPhrases(question: string): string[] {
  const results: string[] = [];
  const regex = /"([^"]{2,60})"|'([^']{2,60})'|\u201c([^\u201d]{2,60})\u201d/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(question)) !== null) {
    const phrase = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (phrase) results.push(phrase);
  }
  return results;
}

function extractAfterPrepositions(question: string): string[] {
  const results: string[] = [];
  const regex =
    /\b(?:around|about|regarding|concerning|for|on|re:?)\s+([A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*){0,2})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(question)) !== null) {
    const phrase = stripPossessive(match[1].trim());
    if (phrase.length >= 2 && !isAllStopwords(phrase)) results.push(phrase);
  }
  return results;
}

export function extractKeywords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, "").replace(/'s$/, ""))
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return Array.from(new Set(words));
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

const INTENT_PATTERNS: Array<[ResearchIntent, RegExp]> = [
  [
    "change",
    /\b(chang(?:e|ed|ing)|shift(?:ed|ing)?|difference|compare|compared|versus|vs\.?|since|trend(?:ing)?|momentum|evolv(?:e|ed|ing))\b/i,
  ],
  [
    "risk",
    /\b(risk|reputation|reputational|crisis|controversy|controversial|backlash|criticism|negative|threat|scandal|boycott|defam\w*)\b/i,
  ],
  ["competitor", /\b(competitor|competition|rival|market share|competitor'?s?)\b/i],
  [
    "coverage",
    /\b(outlets?|media|coverage|press|publications?|journalists?|covered by|who is covering)\b/i,
  ],
  [
    "next_steps",
    /\b(next steps?|what should|should we|recommend\w*|actions?|investigate|prepare|monitor|plan)\b/i,
  ],
  ["narratives", /\b(narratives?|themes?|messag\w*|story|stories|framing|angle)\b/i],
];

export function detectIntent(question: string): ResearchIntent {
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(question)) return intent;
  }
  return "overview";
}

const DATE_PRESET_PATTERNS: Array<[DateRangePreset, RegExp]> = [
  ["24h", /\b(last|past)\s*24\s*hours?\b|\blast day\b|\btoday\b|\bpast day\b/i],
  ["90d", /\b(last|past)\s*90\s*days?\b|\b(last|past)\s*(3|three)\s*months?\b|\bthis quarter\b|\blast quarter\b/i],
  ["30d", /\b(last|past)\s*30\s*days?\b|\b(this|last|past)\s*month\b/i],
  ["7d", /\b(last|past)\s*7\s*days?\b|\b(this|last|past)\s*week\b/i],
];

export function detectDatePreset(question: string): DateRangePreset | null {
  for (const [preset, pattern] of DATE_PRESET_PATTERNS) {
    if (pattern.test(question)) return preset;
  }
  return null;
}

/**
 * The kind of research a question calls for. `social` means the user wants
 * conversation, reactions and sentiment; `profile` means an explicit request for
 * a specific account's profile data; `general` is the news/web default.
 */
export type ResearchMode = "general" | "social" | "profile";

export type SocialPlatform =
  | "instagram"
  | "twitter"
  | "tiktok"
  | "facebook"
  | "youtube"
  | "linkedin"
  | "reddit"
  | "threads";

/**
 * What the user actually wants. This is deliberately more specific than
 * `ResearchIntent` (which drives news query hints) so a request for account
 * metrics is never treated as a social listening question.
 */
export type ResearchIntentKind =
  | "social_listening"
  | "sentiment"
  | "post_discovery"
  | "post_count"
  | "profile_lookup"
  | "profile_metrics"
  | "general";

const PLATFORM_PATTERNS: Array<[SocialPlatform, RegExp]> = [
  ["instagram", /\b(instagram|insta|ig|reels?)\b/i],
  ["tiktok", /\btiktok\b/i],
  ["twitter", /\b(twitter|x\.com|tweets?|retweets?)\b/i],
  ["facebook", /\bfacebook\b/i],
  ["youtube", /\byoutube\b/i],
  ["linkedin", /\blinkedin\b/i],
  ["reddit", /\breddit\b/i],
  ["threads", /\bthreads\b/i],
];

export function detectPlatform(question: string): SocialPlatform | null {
  for (const [platform, pattern] of PLATFORM_PATTERNS) {
    if (pattern.test(question)) return platform;
  }
  return null;
}

export function detectPlatforms(question: string): SocialPlatform[] {
  const platforms: SocialPlatform[] = [];
  for (const [platform, pattern] of PLATFORM_PATTERNS) {
    if (pattern.test(question)) platforms.push(platform);
  }
  return platforms;
}

// Profile metrics = asking for AN ACCOUNT'S numbers (followers, posts count).
// Must reference an account explicitly (@handle, "this account", "their profile").
// "how many posts about Salman Khan" = social listening, NOT profile metrics.
const PROFILE_METRICS_PATTERN =
  /\b(how many (followers|following|posts|likes|views|comments)\s+(?:does|has|do)\s+(?:this|that|their|his|her|the|@[\w.]+)\s*(?:account|profile|handle|page)?|follower (count|numbers?|stats?)\s+(?:for|of|on)\s+(?:this|that|their|his|her|the|@[\w.]+)\s*(?:account|profile)?|audience size|engagement rate|account size|how many (followers|following|posts|likes|views|comments)\s+@[\w.]+)\b/i;

const BARE_METRICS_PATTERN =
  /\b(numbers?|metrics?|statistics?|stats|figures?|counts?)\b/i;

// Mentions of a platform name ("on Instagram") do not mean the question is
// about a specific account's numbers; a genuine account reference must name
// an account, profile, handle or username (or a @mention).
const ACCOUNT_CONTEXT_PATTERN =
  /\b(accounts?|profiles?|handles?|usernames?|@[\w.]+)\b/i;

const POST_DISCOVERY_PATTERN =
  /\b(last|latest|recent)\s+(?:\w+\s+){0,3}(posts?|reels?)\b|\bposts? on (?:their|his|her|the|this|that)\b|\b(show|list|see)\b[^?]{0,40}\b(posts?|reels?)\b/i;

const POST_COUNT_PATTERN =
  /\b(how many|number of|count of|total|numbr of|num of)\s+(?:[a-z]+\s+){0,3}(posts?|reels?|content)\b|\b(posts?|reels?|content)\s+(count|total|number)\b/i;

const PROFILE_LOOKUP_PATTERN =
  /\b(profiles?|biography|bio|account details|account info)\b|\b(their|his|her|this) (profile|account)\b/i;

const SENTIMENT_PATTERN =
  /\b(sentiment|what (?:are|is) people saying|people (?:are )?(?:saying|reacting|responding)|reactions?|reacting|responding|opinions?|public opinion|public reaction|how are people)\b/i;

const SOCIAL_LISTENING_PATTERN =
  /\b(social media|social|buzz(?:ing)?|conversation|discussion|trending|viral|what(?:'s| is) happening|what(?:'s| is) going on|online chatter|chatter|mentions?)\b/i;

export function detectIntentKind(question: string): ResearchIntentKind {
  if (PROFILE_METRICS_PATTERN.test(question)) return "profile_metrics";
  if (BARE_METRICS_PATTERN.test(question) && ACCOUNT_CONTEXT_PATTERN.test(question)) {
    return "profile_metrics";
  }
  if (POST_COUNT_PATTERN.test(question)) return "post_count";
  if (POST_DISCOVERY_PATTERN.test(question)) return "post_discovery";
  if (PROFILE_LOOKUP_PATTERN.test(question)) return "profile_lookup";
  if (SENTIMENT_PATTERN.test(question)) return "sentiment";
  if (SOCIAL_LISTENING_PATTERN.test(question)) return "social_listening";
  if (detectPlatforms(question).length > 0) return "social_listening";
  return "general";
}

export function modeForIntentKind(kind: ResearchIntentKind): ResearchMode {
  if (kind === "profile_metrics" || kind === "post_discovery" || kind === "profile_lookup") {
    return "profile";
  }
  if (kind === "post_count") return "social";
  if (kind === "sentiment" || kind === "social_listening") return "social";
  return "general";
}

export function detectResearchMode(question: string): ResearchMode {
  return modeForIntentKind(detectIntentKind(question));
}

const HANDLE_MENTION = /(?:^|[^\w.@])@([A-Za-z0-9._]{1,30})/g;
const INSTAGRAM_PROFILE_URL =
  /https?:\/\/[^\s)"'<>]*instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#][^\s)"'<>]*)?/gi;
const RESERVED_HANDLES = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "about",
  "legal",
  "directory",
  "developer",
  "api",
  "web",
  "privacy",
  "terms",
]);

export function extractExplicitHandles(question: string): string[] {
  const handles: string[] = [];
  for (const match of question.matchAll(INSTAGRAM_PROFILE_URL)) {
    const candidate = match[1]?.toLowerCase();
    if (candidate && !RESERVED_HANDLES.has(candidate)) handles.push(candidate);
  }
  for (const match of question.matchAll(HANDLE_MENTION)) {
    const candidate = match[1]?.toLowerCase();
    if (candidate && !RESERVED_HANDLES.has(candidate)) handles.push(candidate);
  }
  return Array.from(new Set(handles));
}

const REFERENTIAL_PATTERN =
  /\b(the|this|that|same) (film|movie|show|series|person|account|profile|brand|client|topic|subject|event|project|campaign|company|actor|actress|star)\b|\b(their|his|her|its) (profile|account|posts?|reels?)\b/i;

export interface HistoryResolution {
  entities: string[];
  handles: string[];
  subject: string | null;
  usedHistory: boolean;
}

/**
 * Resolves a follow-up such as "the film" or "their account" against the most
 * recent turn that named a subject. Only used when the current question has no
 * subject of its own.
 */
export function resolveFromHistory(
  question: string,
  history: string[],
): HistoryResolution {
  if (!REFERENTIAL_PATTERN.test(question)) {
    return { entities: [], handles: [], subject: null, usedHistory: false };
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (!turn) continue;
    const handles = extractExplicitHandles(turn);
    const entities = dedupePreserveOrder([
      ...extractQuotedPhrases(turn),
      ...extractCapitalizedPhrases(turn).filter((phrase) => !isAllStopwords(phrase)),
    ]);
    if (entities.length > 0 || handles.length > 0) {
      return {
        entities: entities.slice(0, 4),
        handles,
        subject: entities[0] ?? handles[0] ?? null,
        usedHistory: true,
      };
    }
    const keywords = extractKeywords(turn);
    if (keywords.length > 0) {
      return {
        entities: [],
        handles: [],
        subject: keywords[0] ?? null,
        usedHistory: true,
      };
    }
  }
  return { entities: [], handles: [], subject: null, usedHistory: false };
}

export interface EntityExtraction {
  entities: string[];
  keywords: string[];
  intent: ResearchIntent;
  intentKind: ResearchIntentKind;
  datePreset: DateRangePreset | null;
  primaryEntity: string | null;
  mode: ResearchMode;
  platform: SocialPlatform | null;
  platforms: SocialPlatform[];
  handles: string[];
  subject: string | null;
  needsClarification: boolean;
  clarification: string | null;
  usedHistory: boolean;
}

export interface EntityExtractionOptions {
  /** Prior user/assistant turns, oldest first, used to resolve references. */
  history?: string[];
}

const CLARIFY_SUBJECT =
  "Which person, film, brand or event should I research? Include a name, or paste an Instagram profile URL / @handle.";
const CLARIFY_HANDLE =
  "Which Instagram account should I look up? Include the @handle or paste the profile URL (for example @account).";

// Words that describe residual question vocabulary, not the researched
// subject. A keyword fallback must never become "posts" or "content".
const SUBJECT_FALLBACK_NOISE = new Set([
  "news","posts","posted","posting","content","both","say","read","see","look","going","going",
]);

export function extractEntities(
  question: string,
  options: EntityExtractionOptions = {},
): EntityExtraction {
  const quoted = extractQuotedPhrases(question);
  const afterPrepositions = extractAfterPrepositions(question);
  const capitalized = extractCapitalizedPhrases(question).filter((phrase) => {
    const lower = phrase.toLowerCase();
    if (lower === phrase) return false;
    if (SENTENCE_START_EXCEPTIONS.has(lower.split(/\s+/)[0])) return false;
    return true;
  });

  const handles = extractExplicitHandles(question);
  const intentKind = detectIntentKind(question);
  const platforms = detectPlatforms(question);

  let entities = dedupePreserveOrder([...quoted, ...afterPrepositions, ...capitalized]).slice(0, 6);
  let keywords = extractKeywords(question);
  let resolvedHandles = handles;
  let usedHistory = false;

  // Compute keyword-based subject first so we don't override a valid current subject
  // with stale history (e.g., "the film" resolving to last week's topic).
  const keywordSubject =
    keywords.find((keyword) => !SUBJECT_FALLBACK_NOISE.has(keyword)) ?? null;

  const hasCurrentSubject = entities.length > 0 || resolvedHandles.length > 0 || keywordSubject !== null;

  if (!hasCurrentSubject && options.history?.length) {
    const resolved = resolveFromHistory(question, options.history);
    if (resolved.usedHistory) {
      entities = resolved.entities;
      resolvedHandles = resolved.handles;
      keywords = resolved.entities.length > 0 ? [] : keywords;
      usedHistory = true;
    }
  }

  const subject = entities[0] ?? resolvedHandles[0] ?? keywordSubject;

  // Profile-kind requests always name a specific account. Even when a keyword
  // fell back into `subject`, an account that was never identified must trigger
  // a clarification instead of a generic search (Test C).
  const isProfileKind =
    intentKind === "profile_metrics" ||
    intentKind === "profile_lookup" ||
    intentKind === "post_discovery";
  const needsSubject = intentKind !== "general";
  const needsHandle = isProfileKind && resolvedHandles.length === 0;
  const needsClarification = (needsSubject && subject === null) || needsHandle;

  return {
    entities,
    keywords,
    intent: detectIntent(question),
    intentKind,
    datePreset: detectDatePreset(question),
    primaryEntity: entities[0] ?? null,
    mode: modeForIntentKind(intentKind),
    platform: platforms[0] ?? null,
    platforms,
    handles: resolvedHandles,
    subject,
    needsClarification,
    clarification: needsClarification
      ? needsHandle
        ? CLARIFY_HANDLE
        : CLARIFY_SUBJECT
      : null,
    usedHistory,
  };
}
