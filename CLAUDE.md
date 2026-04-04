# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev              # Run server + client concurrently
npm run dev:server       # Express server only (port 3001, tsx watch)
npm run dev:client       # Vite client only (port 3000, proxies /api and /images to 3001)
npm run build            # TypeScript compile + Vite build
npm run db:push          # Push Prisma schema changes to SQLite (no migration)
npm run db:seed          # Seed database
npm run db:studio        # Open Prisma Studio
```

After changing `prisma/schema.prisma`, run `npm run db:push` to sync the database and regenerate the Prisma client. The running dev server must be restarted to pick up the new client.

## Architecture

Full-stack children's storybook generator. React client (Vite, port 3000) talks to Express API (port 3001). Vite proxies `/api` and `/images` to the server.

### AI Pipeline

Two AI services work in sequence:

1. **Claude** (`claude-sonnet-4-6` via Anthropic SDK) — generates text: universe concepts, character ensembles, location descriptions, story plans, and story prose
2. **Gemini** (`gemini-3-pro-image-preview` via Google GenAI SDK) — generates images: character reference sheets, location reference sheets, and per-page story illustrations

Story generation is a two-phase process: Claude first creates a **story plan** (structured outline with page-by-page beats), then writes **full prose** following that plan. This prevents logical gaps and vague hooks.

Image generation for stories uses a **multi-turn Gemini chat session**. The setup message contains the style guide (from `imageStyleGuide.ts`). Each subsequent message sends the scene prompt + relevant character reference images for that page only. Reference images are labeled as identity references with explicit anti-copying instructions to prevent Gemini from compositing them into the scene.

### Key Configuration

- `src/server/lib/config.ts` — single source of truth for Claude model, temperatures, token limits, moods
- `src/server/services/imageStyleGuide.ts` — single source of truth for art style (`ART_STYLE`, `ART_STYLE_REMINDER`), color rules, composition, lighting, mood palettes. All image generation (character sheets, location sheets, story pages) imports from here.
- `src/server/services/geminiGenerator.ts` — `IMAGE_MODEL` and `IMAGE_SIZE` constants at the top control the Gemini model and resolution for all image generation.

### Data Model

`User` → `Universe` → `Character`, `Location`, `Story` → `Scene`, `StoryCharacter`

Every entity chains through Universe, which has a `userId` foreign key. All API routes verify universe ownership via `src/server/lib/ownership.ts`. Auth is JWT-based (Google OAuth), enforced by `src/server/middleware/auth.ts` on all `/api/*` routes except `/api/auth`.

### Streaming

Story generation and image regeneration use **Server-Sent Events (SSE)**. The server sends `data: {type, ...}\n\n` events. Types: `progress` (step + detail), `complete` (full story object), `error`. The client in `src/client/api/client.ts` has SSE reader functions (`generateStory`, `regenerateStoryImages`) that parse these streams.

### Story Prompt System

`src/server/services/promptBuilder.ts` is the largest service (~350 lines). It assembles the story generation prompt from:
- Universe context (setting, sensory details, world rules, scale/geography) — framed as backdrop, not plot
- Character traits (personality, special detail, archetype) — with restraint instructions to avoid overindexing
- Location descriptions and landmarks
- Story structure guidelines (6 archetypes: rule-of-three, cumulative, circular, journey, problem-solution, unlikely-friendship)
- Age-specific vocabulary and sentence rules
- Clarity rules (no vague hooks, concrete pronouns, grounded openings)
- Image prompt format instructions

The structure archetype is randomly selected per story. Mood is randomly selected from the `MOODS` array in config.

### Reading Mode & PDF

`src/client/pages/ReadingMode.tsx` renders stories as an open book with:
- 3D page-flip animation (CSS `rotateY` with `perspective`)
- Alternating image left/right on even/odd pages
- Parchment styling with spine shadow and page-edge darkening
- PDF export (jsPDF) that mirrors the on-screen layout

## Environment Variables

Requires `.env` with: `ANTHROPIC_API_KEY`, `GOOGLE_AI_KEY`, `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `VITE_GOOGLE_CLIENT_ID`. See `.env.example`.
