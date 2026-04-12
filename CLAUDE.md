# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev              # Run server + client concurrently
npm run dev:server       # Express server only (port 3001, tsx watch)
npm run dev:client       # Vite client only (port 3000, proxies /api and /images to 3001)
npm run build            # TypeScript compile + Vite build
npm run db:push          # Push Prisma schema changes to DB and regenerate client
npm run db:seed          # Seed database
npm run db:studio        # Open Prisma Studio
```

After changing `prisma/schema.prisma`, run `npm run db:push` to sync the database and regenerate the Prisma client. The running dev server must be restarted to pick up the new client.

## Architecture

Full-stack children's storybook generator. React client (Vite, port 3000) talks to Express API (port 3001). Vite proxies `/api` and `/images` to the server. Hosted on Railway.

### AI Pipeline

Two AI services work in sequence:

1. **Claude** (`claude-sonnet-4-6` via Anthropic SDK) — generates text: universe concepts, character ensembles, location descriptions, story plans, and story prose
2. **Gemini** (`gemini-3-pro-image-preview` via Google GenAI SDK) — generates images: character reference sheets, location reference sheets, and per-page story illustrations

### Story Generation Flow

Story generation uses **three sequential Claude API calls**:

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
  - Location data (name, description, landmarks)
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

Image generation runs **in the background** after the story text is saved and returned to the client. The client polls `/stories/:id/status` to track progress. On server restart, `resumeStories.ts` finds stories stuck in "illustrating" status and re-queues them.

### Key Configuration

- `src/server/lib/config.ts` — Claude model (`claude-sonnet-4-6`), temperatures (0.75 standard, 0.85 creative), token limits (4000 plan, 8000 write), moods, plan limits
- `src/server/services/imageStyleGuide.ts` — art style (`ART_STYLE`, `ART_STYLE_REMINDER`), color rules, composition, lighting, mood palettes
- `src/server/services/geminiGenerator.ts` — `IMAGE_MODEL` and `IMAGE_SIZE` constants

### Data Model

```
User → Universe → Character, Location, Story → Scene, StoryCharacter
```

**User**: Google OAuth, JWT auth. Roles: user, admin. Plans: free (5 stories/month, 1 universe), premium (unlimited), admin.

**Universe**: Name, setting description, themes, avoid-themes, style reference image. Sensory details/world rules/scale fields exist in schema but are deprecated (no longer written to or read from).

**Character**: Name, species, personality traits, appearance, outfit, relationship archetype, reference image. The `specialDetail` field exists in schema but is deprecated.

**Story**: Title, mood, age group, status (draft/illustrating/published). Debug fields store the plan prompt, write prompt, generated plan, and structure archetype for admin inspection.

**Scene**: Scene number, content (prose text), image prompt, image URL.

Auth is JWT-based (Google OAuth), enforced by `src/server/middleware/auth.ts` on all `/api/*` routes except `/api/auth`. All routes verify universe ownership via `src/server/lib/ownership.ts`.

### Streaming

Story generation uses **Server-Sent Events (SSE)**. The server sends `data: {type, ...}\n\n` events. Types: `progress` (step + detail), `complete` (full story object), `error`. The client in `src/client/api/client.ts` has SSE reader functions that parse these streams.

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

## Environment Variables

Requires `.env` with: `ANTHROPIC_API_KEY`, `GOOGLE_AI_KEY`, `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `VITE_GOOGLE_CLIENT_ID`, `DATABASE_URL`. See `.env.example`.
