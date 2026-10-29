<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Tubitex — repository guide

Tubitex is a PR intelligence chatbot: a ChatGPT-style UI that answers questions
about a client, topic, or competitor by researching live web/news coverage and
synthesising an evidence-backed briefing with Google Gemini.

## Commands

- `npm run dev` — start the dev server (Turbopack).
- `npm run build` — production build; also type-checks and enforces the Cache Components constraints below.
- `npm run lint` — ESLint (flat config, `eslint.config.mjs`).
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — Vitest (single run). `npm run test:watch` for watch mode.

Do not run tests, builds, lint, type-checks, or similar validation commands unless
the user explicitly authorizes them. Preserve any already-running development
server; inspect source changes manually when permission to validate is absent.

## Architecture

- `app/` — App Router. `app/layout.tsx` mounts `ThemeProvider` + `TooltipProvider`;
  `app/page.tsx` renders `AppShell`. API routes live in `app/api/chat` and
  `app/api/health`.
- `components/` — client UI. `layout/app-shell.tsx` composes the sidebar, header,
  chat view, research panel, and dialogs. shadcn-style primitives in
  `components/ui`.
- `lib/validation/` — Zod schemas are the single source of truth. `types/index.ts`
  re-derives all shared types from them. `gemini-schema.ts` converts a Zod schema
  into the OpenAPI subset Gemini's `responseSchema` accepts.
- `lib/research/` — provider-agnostic pipeline: plan (intent, entities, keywords,
  research mode) → retrieve → normalize → dedupe → relevance/date filter →
  evidence → analyse → summarise. `runResearch(input, deps)` is
  dependency-injected so it can be tested with stub providers and a stub Gemini
  client. `mode` is `general` | `social` | `profile`. For social/profile
  questions, `lib/research/instagram.ts` builds several Instagram-scoped Google
  dorks and the returned posts become evidence; `lib/research/social-filter.ts`
  strictly rejects an Instagram URL that does not mention the subject, has no
  usable snippet, or looks like spam/tutorial content. In social mode social
  results lead and news is capped as context. The Instagram Profile API is only
  called in `profile` mode.
- `lib/providers/` — `SearchProvider` implementations (SerpAPI Google, optional
  NewsAPI) plus an `InstagramProfileProvider` (SerpAPI `instagram_profile`) that
  returns `null` rather than guessing missing metrics. Providers declare
  `capabilities` (`"web"`/`"news"`). All are `server-only`.
- `lib/ai/` — Gemini REST client (no SDK), prompt building, structured analysis.
- `lib/chat/` — pure reducer, client factory, and the fetch wrapper.
- `lib/storage/` — per-browser `localStorage` persistence (no database).
- `lib/hooks/use-stored-state.ts` — `useSyncExternalStore`-based persistence hook
  for UI preferences.
- `lib/instagram-simple.ts` handles the direct Instagram-chat path: it searches
  Google dorks through SerpAPI pagination and deduplicates post shortcodes.
  Account attribution uses returned metadata/text and an Instagram oEmbed
  fallback; hashtags come from returned metadata, titles, captions, and snippets.
  Gemini answers the current question using conversation history. Dork queries
  interleave Instagram post types and distribute the per-search page-request
  budget across query variations; empty or duplicate-only result pages stop
  pagination. Bounds are `TUBITEX_MAX_GOOGLE_PAGES` (default 10 pages per dork)
  and `TUBITEX_MAX_SERPAPI_SEARCHES` (default 15 discovery page requests).
  Google/SerpAPI results are not an Instagram-wide count. The results UI initially
  renders 10 retrieved rows and reveals more with Show more; the Likes column
  displays only the like count, with no comments metric. The Account column is
  last in the results table.
- `lib/instagram-apify.ts` is the explicit Deep thinking retrieval path, separate
  from the Google path and selected in the chat composer. Exact `#tag` and
  "hashtag TAG" requests must bypass model classification and use
  `apify/instagram-hashtag-scraper` with `hashtags: [tag]` and
  `keywordSearch: false`; never substitute an account/profile search. Keyword
  mode remains for people/brands and does not imply posts authored by that name.
  `lib/providers/apify-instagram.ts` starts one bounded Actor run, checks its
  terminal status, then pages the run's dataset by offset/limit under separate
  actor-result, dataset-item, and timeout bounds. Surface actor caps, dataset
  caps, timeouts, and later-page failures as incomplete coverage. Count only
  deduplicated post/reel URLs with timestamps in the selected window; exclude
  profile, hashtag, comment, undated, and out-of-window rows from the post count.
  The Hashtag Scraper does not document exact from/to inputs, so retain the
  requested window and disclose possible under-coverage. Never infer a hashtag
  total from scraped rows; a displayed post count is provider-returned unique
  posts in the window. Credentials stay server-only, and Deep thinking failures
  must never fall through to Google/SerpAPI. The table initially displays 10
  fetched rows; Show more reveals the already-fetched dataset without a new run.

## Conventions and gotchas

- **Server-only modules** (`lib/env.ts`, `lib/providers/*`, `lib/ai/gemini.ts`)
  import `server-only`. Never import them from a client component.
- **Cache Components** (`next.config.ts`) is enabled. Do **not** add
  `export const runtime` to route files — with Cache Components it is a build
  error and Node.js is the only supported runtime. Use `await connection()` to opt
  a route into dynamic rendering.
- **Prerendering is strict.** Anything evaluated while prerendering must be
  deterministic. Do not call `Date.now()` / `new Date()` during a client
  component's render — guard time-dependent rendering behind the hydrated flag or
  a `useEffect`/event handler (see `components/sidebar/app-sidebar.tsx`).
- **React 19 hook lint rules** are on. Reading `localStorage` and calling
  `setState` synchronously in an effect is an error; use
  `lib/hooks/use-stored-state.ts` instead of a mount effect.
- **Honesty over polish.** Never fabricate sources or findings. When an
  integration is missing, return a labelled degraded response that names the
  limitation. New user-visible strings should follow this rule.
- **Dates** are UTC end to end; window bounds are inclusive; undated results are
  excluded from the window and reported.
- Keep Zod schemas as the source of truth; derive types with `z.infer` rather than
  hand-writing interfaces.
- Instagram result answers should stay grounded in fetched posts, respond to the
  user's actual question, and offer a relevant conversational follow-up. Never
  guess an account or hashtag when search metadata does not provide one.

## Environment

Copy `.env.example` to `.env.local`. `GEMINI_API_KEY` (AI analysis) and
`SERPAPI_API_KEY` (retrieval, also Instagram profiles) enable Google mode;
without them the app runs in a clearly-labelled degraded mode. `NEWSAPI_API_KEY`
is optional. Deep thinking additionally requires server-side `APIFY_API_TOKEN`;
`APIFY_INSTAGRAM_HASHTAG_SCRAPER_ACTOR_ID` defaults to
`apify/instagram-hashtag-scraper` (`APIFY_INSTAGRAM_ACTOR_ID` remains a legacy
alias). `TUBITEX_APIFY_MAX_RESULTS_PER_ACTOR`,
`TUBITEX_APIFY_MAX_DATASET_ITEMS_PER_RUN`,
`TUBITEX_APIFY_DATASET_PAGE_SIZE`, and `TUBITEX_APIFY_TIMEOUT_MS` are separate
bounds; optional `TUBITEX_APIFY_MAX_TOTAL_CHARGE_USD` adds an Actor-run charge
ceiling. The Apify token must never enter client code or logs. Missing setup or
retrieval errors must be explicit, with no Google fallback.
Tuning variables (`TUBITEX_*`, including `TUBITEX_MAX_INSTAGRAM_QUERIES` and
`TUBITEX_MAX_INSTAGRAM_PROFILES`) are documented in `.env.example`.

## Testing

Tests live next to the code as `*.test.ts(x)` and shared fixtures are in
`tests/fixtures.ts`. Prefer unit tests for the pure research/validation/reducer
logic and dependency-injected tests for `runResearch`. Import `describe`/`it`/
`expect` from `vitest` explicitly (globals are enabled but not typed for `tsc`).
