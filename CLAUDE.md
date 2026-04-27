# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev              # Run server + client concurrently
npm run dev:server       # Express server only (port 3001, tsx watch)
npm run dev:client       # Vite client only (port 3000, proxies /api and /images to 3001)
npm run worker           # Standalone background worker (tsx watch). Optional —
                         # by default the web process runs workers in-process.
npm run build            # Prisma generate + TypeScript compile + Vite build
npm run typecheck        # tsc --noEmit (CI gate)
npm run db:push          # Push Prisma schema changes to DB and regenerate client
npm run db:seed          # Seed database
npm run db:studio        # Open Prisma Studio
npm start                # Production web server (node dist/...)
npm run start:worker     # Production standalone worker
```

`npm install` / `npm ci` automatically runs `prisma generate` via the
`postinstall` hook, so the generated client is always in sync with
`prisma/schema.prisma`. After editing the schema you still need
`npm run db:push` to apply it to your local DB; the running dev server
must be restarted to pick up the new client.

CI (`.github/workflows/ci.yml`) runs `npm ci` → `npm run typecheck` →
`npm run build` on every PR and push to `main`. The `npm ci` step
catches lockfile drift; `typecheck` catches schema/code drift after
the fresh `prisma generate`.

## Architecture

Full-stack children's storybook generator. React client (Vite, port 3000) talks to Express API (port 3001). Vite proxies `/api` and `/images` to the server. Hosted on Railway.

### AI Pipeline

Two AI services work in sequence:

1. **Claude** (`claude-sonnet-4-6` via Anthropic SDK) — generates text: universe concepts, character ensembles, story plans, and story prose
2. **Gemini** (`gemini-3-pro-image-preview` via Google GenAI SDK) — generates images: character reference sheets and per-page story illustrations

### Story Generation Flow

Story generation runs **asynchronously** in the worker process. `POST /api/stories/generate` validates and returns 202 with `{ storyId, jobId }` in milliseconds; the actual work happens in a `story_text` job processed by `runStoryTextJob` (`storyPipeline.ts`). On success the processor enqueues a follow-up `story_images` job (if illustrations were requested). See "Async Generation Pipeline" below for the queue mechanics.

The text job makes **three sequential Claude API calls**:

```
buildPrompt() → planStory() → writeStory() → refineImagePrompts()
                 ↓ Claude 1     ↓ Claude 2     ↓ Claude 3
                 StoryPlan      Full prose      Polished image prompts
```

1. **Plan** (`storyGenerator.ts: planStory`) — Claude generates a structured outline with title, premise, opening, resolution, and page-by-page beats. Uses `TEMPERATURE_CREATIVE` (0.85) and `MAX_TOKENS_SMALL` (4000). The planner system prompt enforces early clarity (story must be understandable by page 2) and uses archetype-specific premise templates.

2. **Write** (`storyGenerator.ts: writeStory`) — Claude writes full prose following the plan exactly. The writer system prompt focuses purely on **style** (show-don't-tell, read-aloud rhythm, vivid word choice) and does NOT contain story structure rules — those live in the planner to avoid contradicting the plan. Uses `TEMPERATURE_STANDARD` (0.75) and `MAX_TOKENS_SHORT` (8000).

3. **Refine** (`storyGenerator.ts: refineImagePrompts`) — Claude rewrites all image prompts as a set for visual consistency and generates character identity anchors for the illustrator.

All stories are **10 pages** (hardcoded). Structure archetype and mood are randomly selected per story.

### Prompt Architecture

The prompts are split across two files with distinct responsibilities:

- **`promptBuilder.ts`** — Assembles the **user messages** for both the planner and writer. Contains:
  - Universe context (name, setting, themes) — framed as backdrop, not plot
  - Character data (name, species, personality, archetype, role) — no special details
  - 6 story structure archetypes with detailed pacing guides and archetype-specific premise templates
  - Age-specific guidelines (vocabulary bans, sentence structure rules, word counts)
  - Writer system prompt (style-only: show-don't-tell, rhythm, word choice, punctuation rules)

- **`storyGenerator.ts`** — Contains the **system prompts** for the planner and the image prompt refiner, plus the orchestration logic.

**Key design principle**: The writer's system prompt contains NO story content rules (no "protagonist must solve own problems", no "end with a wink"). All story structure rules live in the planner's system prompt and structure guidelines. The writer receives the plan and just makes it sound beautiful.

### Story Structure Archetypes

Six archetypes, each with its own premise template and pacing guide:

| Archetype | Premise Format |
|-----------|---------------|
| Problem-Solution | "[Character] needs to [X] because [Y], but [Z]" |
| Rule of Three | "[Character] tries to [goal] — first by A, then B, then C" |
| Cumulative | "Starting with [one thing], a chain grows as [pattern]" |
| Circular | "[Character] leaves [place] because [trigger], returns changed" |
| Journey & Return | "[Character] ventures from [home] seeking [what], returns changed" |
| Unlikely Friendship | "[A] and [B] are different, but when [circumstance], they discover [connection]" |

### Image Generation

Image generation for stories uses a **multi-turn Gemini chat session**:
1. Setup message: style guide + style reference image + all character reference sheets
2. Each subsequent message: scene prompt for one page → one illustration

Reference images are labeled as identity references with anti-copying instructions to prevent Gemini from compositing them into the scene. The style guide lives in `imageStyleGuide.ts`.

Image generation runs as a `story_images` job (`storyPipeline.ts: runStoryImagesJob`) consumed by the gemini-tasks queue. It only fills in scenes whose `imageUrl` is empty, so a partial-failure restart only redoes missing pages. The client polls `/stories/:id/status` to track progress.

### Async Generation Pipeline

All AI work runs through a queued `GenerationJob` row + a vendor-level
BullMQ worker. The HTTP routes are thin: validate, create the
placeholder entity row, enqueue, return 202 + `{ entityId, jobId }`.
The client navigates to the entity's reading/library view and polls
`/api/stories/:id/status` or `/api/universes/:id/status`.

**Files:**
- `src/server/lib/queues.ts` — two vendor-level BullMQ queues:
  `claude-tasks` (handles `story_text`, `universe_build`) and
  `gemini-tasks` (handles `story_images`, `universe_images`). Per-
  vendor concurrency knobs via `CLAUDE_QUEUE_CONCURRENCY` and
  `GEMINI_QUEUE_CONCURRENCY` (default 2 each).
- `src/server/lib/jobs.ts` — `GenerationJob` row CRUD: `createJob`
  (atomically inserts + enqueues to the matching queue), `claimJob`
  (atomic lock acquisition), `markJobCompleted` / `markJobFailed` /
  `updateJobProgress`, `findResumableJobs`. The BullMQ jobId is the
  GenerationJob row id so the two stores stay aligned.
- `src/server/services/storyPipeline.ts` — `runStoryTextJob` and
  `runStoryImagesJob` processors plus `createStoryPlaceholder` and
  `pickStoryParameters` route helpers.
- `src/server/services/universePipeline.ts` — same shape for
  universes: `runUniverseBuildJob`, `runUniverseImagesJob`,
  `createUniversePlaceholder`, `validateUniverseInput`.
- `src/server/worker.ts` — `bootWorkers()` entry point. Sets up
  BullMQ Workers for the two queues with their concurrency caps,
  dispatches each job to the right processor by `kind`, and runs
  the resume sweep on boot. Called inline by the web process when
  `WORKER_INLINE !== "false"` (the default) or standalone via
  `npm run worker` / `npm run start:worker`.

**Idempotency.** Every processor reloads the entity row first and
exits if the work has moved past its phase. `runStoryTextJob` also
checks for existing scenes (guards the "crashed after createMany"
case). `runStoryImagesJob` only generates images for scenes with
empty `imageUrl`. Same pattern for universe processors.

**Resume on restart.** `findResumableJobs` returns rows with
`status='queued'` plus rows whose `lockedAt` is older than 15 min
(presumed-abandoned). With Redis the resume sweep re-enqueues to
BullMQ; without Redis it runs the jobs in-process. In single-process
mode (no `REDIS_URL`) the boot path additionally resets all
`status='running'` rows to `queued` since they're by definition
abandoned by the previous process.

**No-Redis fallback.** Without `REDIS_URL` the queues are null and
the worker polls the DB every 2 seconds for queued jobs. An
in-process semaphore in `worker.ts` enforces the same per-vendor
concurrency caps (`inFlightClaude` / `inFlightGemini`) that BullMQ
would. Production should always set `REDIS_URL`; the polling
fallback is a dev convenience.

**Failure surfacing.** When a processor throws, the worker catches
it and:
1. Calls the entity-specific marker (`markStoryTextFailed` /
   `markStoryImagesFailed` / `markUniverseFailed`) to flip the
   entity row to a terminal failure status.
2. Calls `markJobFailed(jobId, error)` to populate
   `GenerationJob.lastError` for the status endpoint.
3. Re-throws so BullMQ records the retry attempt.

The status endpoints surface `Story.status` / `Universe.status`
plus the latest `GenerationJob.{step, progressPercent, lastError}`
so the polling client can render real progress and human-readable
error messages.

`GET /api/stories/:id/status` and `GET /api/universes/:id/status`
are the canonical polling endpoints. The legacy SSE-based
`POST /api/stories/generate` and `POST /api/stories/:id/regenerate-images`
endpoints (which used to stream events back over the request) have
been replaced with 202+enqueue.

### Key Configuration

- `src/server/lib/config.ts` — Claude model (`claude-sonnet-4-6`), temperatures (0.75 standard, 0.85 creative), token limits (4000 plan, 8000 write), moods, plan limits
- `src/server/services/imageStyleGuide.ts` — art style (`ART_STYLE`, `ART_STYLE_REMINDER`), color rules, composition, lighting, mood palettes
- `src/server/services/geminiGenerator.ts` — `IMAGE_MODEL` and `IMAGE_SIZE` constants
- `src/server/lib/queues.ts` — queue names, `JOB_KINDS`, and the per-vendor concurrency env constants
- `src/server/lib/storage.ts` — R2 / local-disk storage selection. Refuses to boot in production without R2; falls back to local disk in development with a warning

### Data Model

```
User → Universe → Character, Story → Scene, StoryCharacter
                                  ↘
                                   PrintOrder
User → GenerationJob (→ Story?, → Universe?)
```

**User**: Google OAuth, JWT auth. Roles: user, admin. Plans: free (5 stories/month, 1 universe), premium (unlimited), admin.

**Universe**: Name, setting description, themes, avoid-themes, style reference image. `status` tracks the async creation lifecycle: `queued | building | illustrating_assets | ready | failed`. Default is `"ready"` so legacy rows (pre-PR-5) are correct without a migration; new universes from `/api/auth/onboard` and `/api/universes/custom` start at `"queued"`. Preset clones (`/api/auth/onboard-preset`) skip the pipeline entirely and land at `"ready"` immediately. Sensory details/world rules/scale fields exist in schema but are deprecated.

**Character**: Name, species, personality traits, appearance, outfit, relationship archetype, reference image. The `specialDetail` field exists in schema but is deprecated.

**Story**: Title, mood, age group. `status` vocabulary: `queued | generating_text | illustrating | published | failed_text | failed_illustration`. Default is `"draft"` for legacy rows. Debug fields store the plan prompt, write prompt, generated plan, and structure archetype for admin inspection.

**Scene**: Scene number, content (prose text), image prompt, image URL.

**PrintOrder**: Lulu print job tracking — see Print on Demand section below.

**GenerationJob**: Worker-side metadata for async generation work, separate from the user-facing entity status. Carries `kind` (`story_text | universe_build | story_images | universe_images`), `status` (`queued | running | completed | failed | cancelled`), `payload` (Json), `step` + `progressPercent`, `attempts`, `lastError`, `lockedAt` / `lockedBy` claim fields, and timestamps. Optional `storyId` / `universeId` point at the entity being produced. One entity may have multiple jobs over its lifetime (e.g. `story_text` then `story_images`, or a retried `universe_build`).

Auth is JWT-based (Google OAuth), enforced by `src/server/middleware/auth.ts` on all `/api/*` routes except `/api/auth`. All routes verify universe ownership via `src/server/lib/ownership.ts`.

### Client-side polling

Pages that depend on async generation state poll the relevant
status endpoint via `react-query`'s `refetchInterval`:

- `ReadingMode.tsx` polls `/stories/:id/status` every 3s while the
  story is in any non-terminal state (`queued | generating_text |
  illustrating`). Renders `STORY_TEXT_PHRASES` during the text
  phase and `STORY_IMAGE_PHRASES` once images start. Failed states
  (`failed_text` / `failed_illustration`) render a friendly error
  screen with admin-only access to the underlying job error.
- `Library.tsx` and `MyUniverses.tsx` poll their respective list
  endpoints every 5s while any item is non-terminal. `BookCover`
  shows status-aware labels ("Generating…", "Adding illustrations…",
  "Failed") and a `displayTitle` fallback so empty-title placeholder
  rows don't show a blank book.
- `MyUniverses.tsx`'s `UniverseStatusBadge` component covers the
  full universe status vocabulary.

### Reading Mode

`src/client/pages/ReadingMode.tsx` renders stories using `react-pageflip` (HTMLFlipBook):
- Realistic page-flip animation with built-in shadow casting
- Portrait mode (single page) on mobile, landscape (two-page spread) on desktop
- Desktop: alternating image left/right per scene. Mobile: always text then illustration
- Colored book covers matching the library shelf colors (deterministic from story ID)
- Keyboard navigation (arrow keys, spacebar, escape)
- Admin-only: debug panel showing all prompts and the generated plan
- Admin-only: PDF export (jsPDF) and image regeneration
- Controls auto-hide on desktop, always visible on mobile

### Mobile Support

- `react-pageflip` with `usePortrait={true}` for single-page mode on phones (<400px)
- Responsive layouts throughout (Tailwind `sm:` breakpoints)
- Horizontally scrollable bookshelves on mobile
- FAQ modal centered on screen (not dropdown)
- Spine shadow hidden on mobile (no spine in single-page mode)

### Print on Demand (Lulu) — Phase 1, sandbox-only

Wired against Lulu's sandbox API. Single admin endpoint
`POST /api/print/test-order` builds a cover + interior PDF for a
story, uploads them to storage, gets a Lulu cost quote, and submits
a sandbox print job. `POST /api/print/test-order` accepts
`dryRun: true` to skip the Lulu submission and just return the
quote. `GET /api/print/orders/:id` fetches an order plus its
current Lulu status (including per-line-item rejection messages
when Lulu kicks a job back).

**PDF builder (`src/server/services/printPdfBuilder.ts`):**
- Trim size is derived from the configured Lulu SKU
  (`LULU_DEFAULT_POD_PACKAGE_ID`).
- **Inter font** (from `@fontsource/inter`) is read from the
  package on first PDF build, cached, and registered with every
  jsPDF doc via `addFileToVFS` + `addFont`. Lulu's normalizer
  rejects PDFs with non-embedded fonts; jsPDF's default helvetica
  references the standard PDF font by name rather than embedding
  glyph data, so it had to be replaced.
- **Interior** pages embed the scene illustration above the prose,
  fit-to-box with letterboxing/pillarboxing to preserve aspect
  ratio (Gemini's 4:3 art doesn't get stretched into the page
  aspect). Pages have a beige paper background that extends past
  the trim edge so the printer's cut can't leave a white sliver.
  Page count is padded to a multiple of 4 with blanks for
  saddle-stitch binding.
- **Cover** is a wraparound: back-cover + spine + front-cover with
  bleed on the outer edges, in landscape orientation. The title is
  centered inside the front-cover trim region (not the full PDF
  width). Spine width is zero for saddle-stitch (SS) binding;
  Phase 2 will compute spine width from interior page count for
  perfect-bound (PB).

Pricing: print cost × 1.5 + shipping pass-through (no separate tax
charge to customer).

Phase 2 will add user-facing UI (print button + address form +
Stripe Checkout) and a Lulu webhook handler. Phase 3 flips Lulu +
Stripe to live mode.

**TEMPORARY (development-only):** the admin "reset user" endpoint
(`POST /api/admin/users/:userId/reset`) currently deletes the user's
`PrintOrder` rows along with stories/universes so the same admin can
re-test onboarding+ordering. **Before final release, remove that
`prisma.printOrder.deleteMany` line in `src/server/routes/admin.ts`** —
print orders should survive a reset for accounting and refund records.

## Environment Variables

See `.env.example` for the full annotated list. Summary:

**Required everywhere:**
- `ANTHROPIC_API_KEY`, `GOOGLE_AI_KEY` — AI vendors
- `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID` — Google OAuth
- `JWT_SECRET` — must be ≥32 chars in production (server refuses to boot otherwise)
- `DATABASE_URL` — PostgreSQL

**Required in production:** all five Cloudflare R2 vars — `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`. The server refuses to boot in production with any of them missing, because local-disk storage is per-instance and would not survive a redeploy or scale out. Local development falls back to `public/images/` with a warning.

**Optional / feature-gated:**
- `REDIS_URL` — when set, enables BullMQ queues (legacy `image-generation`, plus the new `claude-tasks` and `gemini-tasks`). Without it, queues fall back to in-process execution.
- `WORKER_INLINE` — set to `"false"` once a separate worker service is provisioned. Default (unset) keeps the single-process behavior where the web process also runs background workers.
- `CLAUDE_QUEUE_CONCURRENCY`, `GEMINI_QUEUE_CONCURRENCY` — per-vendor worker concurrency. Default 2 each.
- `ADMIN_EMAILS` — comma-separated list auto-promoted to `admin` on first sign-in.
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`.
- Lulu (sandbox or production): `LULU_CLIENT_KEY`, `LULU_CLIENT_SECRET`, optionally `LULU_API_BASE_URL` and `LULU_DEFAULT_POD_PACKAGE_ID`.
