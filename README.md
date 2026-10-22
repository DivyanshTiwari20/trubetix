# Tubitex

Tubitex is a PR intelligence chatbot: a ChatGPT-style interface that answers
questions about a client, topic, or competitor by researching live web and news
coverage and synthesising an evidence-backed briefing.

Every briefing is grounded in retrieved sources, cited by index, and clearly
separates reported facts from interpretation and recommendations. When an
integration is missing, Tubitex says so and labels the response as degraded — it
never invents sources or findings.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure the environment:

   ```bash
   copy .env.example .env.local
   ```

   Set `GEMINI_API_KEY` and `SERPAPI_API_KEY` for live mode. Without them the app
   still runs, in a clearly-labelled degraded mode.

3. Start the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server (Turbopack). |
| `npm run build` | Production build (also type-checks). |
| `npm start` | Serve the production build. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Run `tsc --noEmit`. |
| `npm test` | Run the Vitest suite once. |
| `npm run test:watch` | Run Vitest in watch mode. |

## How it works

1. A question is planned into an intent, entities, keywords, search queries, and
   a research mode — `general`, `social`, or `profile` (`lib/research/plan.ts`).
2. Configured providers (SerpAPI, optionally NewsAPI) are queried in parallel.
3. For social and profile questions, Tubitex runs several Instagram-scoped Google
   dorks (posts, Reels, reaction/review/controversy angles, and `after:`/`before:`
   date operators) and uses the returned posts themselves as evidence — not just
   as handle seeds. Results are strictly filtered so an Instagram URL alone is
   never enough: the post must mention the subject and carry a usable snippet,
   and follower-boosting, tutorial and reserved-path pages are rejected.
4. The Instagram Profile API is called only when the user explicitly asks for
   profile information (followers, bio, recent posts) — never for ordinary
   social listening.
5. Results are normalized, canonicalised, deduplicated, and capped into an
   evidence set. In social mode relevant posts lead and news/web is capped as
   clearly-labelled context, so a flood of news cannot drown a few relevant
   posts. Dated social results outside the window are dropped; undated ones are
   kept and reported as timestamp-uncertain.
6. Gemini analyses the numbered evidence into a structured briefing that is
   validated against a Zod schema before it is shown. Confidence reflects the
   relevance and quantity of social evidence only.
7. The UI renders the briefing, its sources, and the research metadata
   (queries, window, limitations, warnings).

If a social question yields no relevant Instagram evidence, Tubitex says so
plainly and does not substitute unrelated news or profiles. Questions about
change additionally research a contiguous previous window so movement over time
can be reported — or explicitly flagged as unavailable.

## Integrations

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | For analysis | Google Gemini, called over REST. |
| `SERPAPI_API_KEY` | For retrieval | Web and news search, plus Instagram profiles. |
| `NEWSAPI_API_KEY` | Optional | Extra news coverage. |

Model and tuning overrides (`GEMINI_MODEL`, `TUBITEX_*`, including the Instagram
query/profile caps) are documented in `.env.example`. Instagram metrics that the
upstream API does not return stay blank rather than being estimated.

## Data and privacy

Conversations are stored in the browser's `localStorage` only. There is no
database and no server-side history. Clearing browser storage removes them.

## Tech stack

Next.js 16 (App Router, Cache Components), React 19, TypeScript (strict),
Tailwind CSS v4, Radix primitives, Zod v4, Vitest.
