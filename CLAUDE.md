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

### Read API & Pagination

The list endpoints are split by scope and cursor-paginated. Response
shape is always `{ items, nextCursor: string | null }` — pass back
`nextCursor` as `?cursor=...` for the next page. Default `?limit=50`,
max 100.

- `GET /api/stories/my` — your own stories (createdById match OR
  stories in a universe you own).
- `GET /api/stories/featured` — admin-curated public stories.
- `GET /api/stories?universeId=...` — bounded, unpaginated list of
  stories in a single universe (still capped by per-universe story
  growth in practice).
- `GET /api/universes/my` — your own universes (with characters
  included; every consumer needs them).
- `GET /api/universes/templates` — admin-curated preset universes
  for onboarding.

The pagination relies on the `Story(createdById, createdAt)` and
`Universe(userId, createdAt)` indexes from PR 2. Server uses
Prisma's `cursor + skip:1 + take: limit + 1` trick to detect
"more available" without a separate count query.

### Photo uploads (universe builder)

Character photos uploaded during onboarding / new-universe creation
go directly to R2 from the browser via a presigned URL. The bytes
never ride inside the JSON request body.

1. Client calls `POST /api/uploads/photo-url` with `{ mimeType,
   contentLength }`. Validates against an allowlist (jpeg/png/webp/
   gif) and ≤5MB.
2. Server returns `{ uploadUrl, key, expiresInSeconds }`. The
   uploadUrl is a 15-minute presigned `PutObjectCommand` URL; the
   key is namespaced `uploads/<userId>/<uuid>.<ext>`.
3. Client `PUT`s the file blob directly to the URL.
4. Client submits the universe-build payload with `{ photoKey }`
   instead of `{ mimeType, data }`.

The worker's `runUniverseBuildJob` resolves keys to bytes
just-in-time via `readImageByKey()` in `storage.ts` so the bytes
aren't stored in `GenerationJob.payload`. The legacy inline shape
(`{ mimeType, data }`) is still accepted by `photoToImageBlock` so
pre-PR-6 jobs sitting in the queue at deploy time keep processing.

**R2 setup required:**
- **CORS**: the bucket must allow `PUT` from the app origin
  (`Content-Type` header included).
- **Lifecycle rule**: configure R2 to expire objects under
  `uploads/` after ~30 days. Universes that never finished building
  leave orphan photos there; the lifecycle rule is the simplest
  cleanup path. A server-side cron is a future TODO if it ever
  becomes a problem.

The express body limit is `1mb` (down from 10mb pre-PR-6) since
photos no longer ride the JSON body.

### Observability — `GET /api/admin/metrics`

Admin-only endpoint that returns three blocks:

- **`queues`** — BullMQ counts per queue (`waiting / active /
  completed / failed / delayed`) plus a `redisAvailable` flag.
  Without `REDIS_URL` the counts are null and the flag is false —
  signal to provision Redis before bumping concurrency env vars.
- **`jobs`** — `GenerationJob` aggregates: `groupBy(status, kind)`
  for current state, average runtime per kind over the last 24h
  (sample count + avg ms), and total `failed` count last 24h.
  Lets you spot a regressed kind without trawling logs.
- **`http`** — per-route latency from `httpLatencyMiddleware`
  (`src/server/middleware/httpLatency.ts`). 5000-sample in-memory
  ring buffer keyed by route pattern (not URL). Returns count,
  avg, p50, p95, p99, and 5xx error count per `(method, route)`.
  In-memory only; restarts wipe the buffer. For longer retention
  point Prometheus / Datadog at the endpoint and scrape on a
  schedule.

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

### Print on Demand (Lulu) — Phase 2, sandbox-only

Cart-based print flow. The user adds books to a "waiting to print"
list, then checks out the whole list as a single Stripe payment and
a single Lulu print-job with multiple line items. Saved shipping
address lives on `User.shippingAddress`, captured during onboarding
(skippable) and editable from `/account`.

**User flow:**
1. **Onboarding** — first-time users hit a "Want printed copies
   later?" step right after the plan picker. They can fill in a
   shipping address (saved via `PUT /api/account/address`) or skip
   it. The onboarded universe build proceeds either way.
2. **Account** — `/account` lets users edit or clear the saved
   shipping address (`GET/PUT/DELETE /api/account[/address]`).
3. **Add to print list** — `ReadingMode` shows an "Add to print
   list" control once the story is `published`. It calls
   `POST /api/print/cart` which creates a `PrintOrder` row at
   `status="cart"` (no PDFs, no Lulu calls). A toast confirms.
4. **Cart** — `/print/cart` lists every cart row, shows the saved
   shipping address (with a link to edit), and pulls a single
   batch quote from Lulu via `GET /api/print/cart`. The quote
   includes per-item print cost (proportional to page count) plus
   one shared shipping fee for the batch.
5. **Checkout** — `POST /api/print/cart/checkout` builds PDFs for
   every cart item in parallel, stamps them all with the same
   `printBatchId`, snapshots their pricing + shipping address, and
   creates one Stripe Checkout session in `mode: "payment"` for the
   batch total. Cart rows flip to `status="pending_payment"`.
6. **Stripe success** — Stripe redirects to
   `/print/orders/:batchId?session_id=...`. That page polls
   `GET /api/print/orders/:batchId` every 3s while the batch is in
   any non-terminal state. Stripe fires
   `checkout.session.completed`; `routes/billing.ts` keys off
   `metadata.kind === "print"` + `metadata.batchId`, marks every row
   `paid`, and calls `submitBatchToLulu(batchId)`.
7. **Lulu submission** — `submitBatchToLulu` builds one
   `createPrintJob` request with N line items (one per book in the
   batch), and stamps every batch row with the same `luluPrintJobId`.
8. **Lulu webhooks** — `POST /api/print/lulu-webhook` receives
   status-change events. `mapLuluStatusToOrderStatus` translates to
   our vocabulary; `updateMany` applies the new status (and the
   first tracking URL) to every row sharing the `luluPrintJobId`.
   Signature is HMAC-SHA256 of the raw body using
   `LULU_WEBHOOK_SECRET`.

**Order lifecycle vocabulary** (`PRINT_ORDER_STATUS` in
`services/printSubmit.ts`):
`cart` (in cart, not checked out) |
`draft` (admin test path) | `pending_payment` | `paid` |
`submitted` | `in_production` | `shipped` | `delivered` |
`cancelled` | `failed` | `refunded`. Per-row state moves in lockstep
across a batch — every row in the same `printBatchId` shares its
status, `luluPrintJobId`, and tracking URL.

**Pricing snapshot per row:**
- `luluPrintCostCents` — that row's print cost (proportional to
  the row's page count over total batch page count).
- `luluShippingCostCents` — full batch shipping, duplicated on
  every row (single source of truth — read from any row).
- `customerPriceCents` — `luluPrintCostCents * 1.5`. The batch
  total is `sum(customerPriceCents) + luluShippingCostCents`.

**Schema additions:**
- `User.shippingAddress` — JSON-encoded saved address. Empty
  string means unset; `serializeUser` exposes a derived
  `hasShippingAddress: boolean` to the client.
- `PrintOrder.printBatchId` — groups orders into one Lulu job.
  Null for cart rows and legacy single-book orders.

**Admin smoke test:**
`POST /api/print/test-order` is still wired in (admin-only). It
takes a `storyId` + optional `shippingAddress` + optional
`dryRun: true` and runs the same PDF build / Lulu cost calc /
Lulu submit chain as the user flow but without Stripe. Used to
debug PDF-rejection issues against Lulu's normalizer without
spending credit.

**PDF builder (`src/server/services/printPdfBuilder.ts`):**
- Trim size is derived from the configured Lulu SKU
  (`LULU_DEFAULT_POD_PACKAGE_ID`).
- **Inter font** is read from `assets/fonts/Inter-Regular.ttf` and
  `Inter-Bold.ttf` (committed to the repo from rsms/inter v4.0),
  cached on first build, and registered with every jsPDF doc via
  `addFileToVFS` + `addFont`. Lulu rejects PDFs with non-embedded
  fonts; jsPDF's default helvetica references the standard PDF
  font by name rather than embedding glyph data. Both `assets/`
  and `public/` are copied into the runtime stage in `Dockerfile`.
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
  Phase 3 will compute spine width from interior page count for
  perfect-bound (PB).

Pricing: print cost × 1.5 + shipping pass-through (no separate tax
charge to customer).

**Idempotency:** `submitBatchToLulu` short-circuits if any row in
the batch already has a `luluPrintJobId`. The Stripe webhook also
gates on every row being `pending_payment` before calling submit,
so a webhook retry can't double-submit. The Lulu webhook ignores
events for unknown jobs (acks 200 so Lulu doesn't keep retrying)
and refuses to roll backwards over terminal statuses (`refunded` /
`cancelled` / etc).

Phase 3 will flip Lulu + Stripe to live mode (production base URLs
+ live keys), add real address validation (currently the form
accepts whatever the user types), and a polished cover/interior
layout that matches the on-screen reader.

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
- Lulu (sandbox or production): `LULU_CLIENT_KEY`, `LULU_CLIENT_SECRET`, optionally `LULU_API_BASE_URL`, `LULU_DEFAULT_POD_PACKAGE_ID`, and `LULU_WEBHOOK_SECRET` (HMAC-SHA256 secret configured against the Lulu webhook URL — required only if you want auto-updates to `shipped`/`delivered`).
