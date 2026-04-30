import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { requireAdmin } from "../middleware/auth.js";
import { checkStoryQuota } from "../lib/quota.js";
import { buildSystemPrompt } from "../services/promptBuilder.js";
import { PLANNER_SYSTEM_PROMPT } from "../services/storyGenerator.js";
import { verifyUniverseOwnership, verifyUniverseAccess } from "../lib/ownership.js";
import { deleteStoriesCascade } from "../lib/cascade.js";
import { createJob } from "../lib/jobs.js";
import { JOB_KINDS } from "../lib/queues.js";
import { parseLimit, paginate } from "../lib/pagination.js";
import {
  pickStoryParameters,
  createStoryPlaceholder,
  type StoryTextJobPayload,
  type StoryImagesJobPayload,
} from "../services/storyPipeline.js";

const router = Router();

// List stories — optionally filtered by universeId, otherwise all for user
// Get story quota for current user (both illustrated and text-only buckets)
router.get("/quota", async (req, res) => {
  try {
    const [illustrated, text] = await Promise.all([
      checkStoryQuota(req.userId as string, true),
      checkStoryQuota(req.userId as string, false),
    ]);
    res.json({ illustrated, text });
  } catch {
    res.status(500).json({ error: "Failed to check quota" });
  }
});

// Slim shape for the library/story-list views: just the metadata
// needed to render covers and badges. Full story data (scenes,
// characters, universe) is served by GET /:id. Avoids shipping
// every page's prose and image URLs on the home shelf.
const STORY_SUMMARY_SELECT = {
  id: true,
  title: true,
  isPublic: true,
  hasIllustrations: true,
  status: true,
  createdAt: true,
  universe: { select: { id: true, name: true } },
  _count: { select: { scenes: true } },
} as const;

function flattenStorySummary(s: {
  id: string;
  title: string;
  isPublic: boolean;
  hasIllustrations: boolean;
  status: string;
  createdAt: Date;
  universe: { id: string; name: string };
  _count: { scenes: number };
}) {
  return {
    id: s.id,
    title: s.title,
    isPublic: s.isPublic,
    hasIllustrations: s.hasIllustrations,
    status: s.status,
    createdAt: s.createdAt,
    universe: s.universe,
    scenesCount: s._count.scenes,
  };
}

// Pagination helpers (DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, parseLimit,
// paginate) live in src/server/lib/pagination.ts so stories.ts and
// universes.ts share one source of truth.

// GET /api/stories/my — paginated list of stories the user created
// (directly via createdById) or that live in a universe they own.
// Excludes other users' public stories, which live on /featured.
router.get("/my", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    const rows = await prisma.story.findMany({
      where: {
        OR: [
          { createdById: req.userId as string },
          { createdById: null, universe: { userId: req.userId as string } },
        ],
      },
      select: STORY_SUMMARY_SELECT,
      // `id` as a tiebreaker keeps cursor + skip:1 stable when two rows
      // share the same createdAt (timestamps are millisecond-precise so
      // bursts of bulk-generated content easily collide).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const { items, nextCursor } = paginate(rows, limit);
    res.json({ items: items.map(flattenStorySummary), nextCursor });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch your stories" });
  }
});

// GET /api/stories/featured — paginated list of public stories
// (admin-curated). Used for the "featured" shelf in the library.
router.get("/featured", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    const rows = await prisma.story.findMany({
      where: { isPublic: true },
      select: STORY_SUMMARY_SELECT,
      // `id` as a tiebreaker keeps cursor + skip:1 stable when two rows
      // share the same createdAt (timestamps are millisecond-precise so
      // bursts of bulk-generated content easily collide).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const { items, nextCursor } = paginate(rows, limit);
    res.json({ items: items.map(flattenStorySummary), nextCursor });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch featured stories" });
  }
});

// GET /api/stories?universeId=... — list stories in a specific
// universe. Used by the universe-detail and story-builder pages where
// the count is bounded by per-universe story growth (small in practice
// — a universe rarely accumulates more than a few dozen stories).
// Not paginated for the same reason; if this ever grows we can swap to
// the cursor pattern above.
router.get("/", async (req, res) => {
  console.log("[stories] GET / hit", { universeId: req.query.universeId, userId: req.userId });
  try {
    const { universeId } = req.query;
    if (!universeId || typeof universeId !== "string") {
      return res.status(400).json({ error: "universeId is required" });
    }
    if (!await verifyUniverseOwnership(universeId, req.userId as string)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const rows = await prisma.story.findMany({
      where: { universeId },
      select: STORY_SUMMARY_SELECT,
      orderBy: { createdAt: "desc" },
    });
    res.json(rows.map(flattenStorySummary));
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch stories" });
  }
});

// Check story status (for polling during image generation). Same access
// rules as GET /:id — must be public, or the requester must own the
// universe, or have authored the story.
router.get("/:id/status", async (req, res) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true,
        status: true,
        hasIllustrations: true,
        isPublic: true,
        universeId: true,
        createdById: true,
        scenes: { select: { sceneNumber: true, imageUrl: true }, orderBy: { sceneNumber: "asc" } },
      },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });

    const isOwner = await verifyUniverseOwnership(story.universeId, req.userId as string);
    const isCreator = story.createdById === (req.userId as string);
    if (!story.isPublic && !isOwner && !isCreator) {
      return res.status(403).json({ error: "Access denied" });
    }

    const imagesReady = story.scenes.filter((s) => s.imageUrl).length;
    const totalPages = story.scenes.length;

    // Surface the most recent GenerationJob so the polling client can
    // show step / progress / error. We pick the latest by createdAt
    // because a story can have multiple jobs over its lifetime
    // (story_text → story_images, or a regenerate-images run).
    const latestJob = await prisma.generationJob.findFirst({
      where: { storyId: story.id },
      orderBy: { createdAt: "desc" },
      select: { kind: true, status: true, step: true, progressPercent: true, lastError: true },
    });

    res.json({
      status: story.status,
      hasIllustrations: story.hasIllustrations,
      imagesReady,
      totalPages,
      job: latestJob ?? null,
    });
  } catch {
    res.status(500).json({ error: "Failed to check status" });
  }
});

// Full story with scenes and characters
router.get("/:id", async (req, res) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id as string },
      include: {
        characters: { include: { character: true } },
        scenes: { orderBy: { sceneNumber: "asc" } },
        universe: true,
      },
    });
    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }
    // Allow access to: public stories, own universe stories, or stories the user created
    const isOwner = await verifyUniverseOwnership(story.universeId, req.userId as string);
    const isCreator = story.createdById === (req.userId as string);
    if (!story.isPublic && !isOwner && !isCreator) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.json(story);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch story" });
  }
});

// Kick off async story generation. Validates quota/access, creates a
// placeholder Story row, enqueues a story_text job, and returns 202
// with { storyId, jobId } so the client can immediately navigate to
// /reading/:id and poll /api/stories/:id/status. The text job will
// (optionally) chain a story_images job; no HTTP request stays open.
router.post("/generate", async (req, res) => {
  try {
    const {
      universeId,
      characterIds: requestedCharacterIds,
      language,
      ageGroup,
      structure: requestedStructure,
      parentPrompt,
      generateImages,
    } = req.body;

    if (!universeId || !ageGroup) {
      return res.status(400).json({ error: "universeId and ageGroup are required" });
    }

    const quota = await checkStoryQuota(req.userId as string, !!generateImages);
    if (!quota.allowed) {
      const kind = generateImages ? "illustrated stories" : "text-only stories";
      return res.status(403).json({
        error: `You've reached your limit of ${quota.limit} ${kind} this month. Upgrade to premium for more.`,
      });
    }

    if (!await verifyUniverseAccess(universeId, req.userId as string)) {
      return res.status(403).json({ error: "Access denied" });
    }

    let structure: string;
    let mood: string;
    let characterIds: string[];
    try {
      const picked = await pickStoryParameters({
        universeId,
        requestedStructure,
        requestedCharacterIds,
      });
      structure = picked.structure;
      mood = picked.mood;
      characterIds = picked.characterIds;
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    const story = await createStoryPlaceholder({
      universeId,
      createdById: req.userId as string,
      ageGroup,
      language: language || "en",
      mood,
      structure,
      characterIds,
      generateImages: !!generateImages,
    });

    const payload: StoryTextJobPayload = {
      universeId,
      characterIds,
      language: language || "en",
      ageGroup,
      structure,
      mood,
      parentPrompt: parentPrompt || "",
      generateImages: !!generateImages,
    };

    const job = await createJob({
      kind: JOB_KINDS.storyText,
      ownerId: req.userId as string,
      storyId: story.id,
      payload: payload as any,
    });

    debug.story("Story enqueued", {
      storyId: story.id,
      jobId: job.id,
      structure,
      mood,
      generateImages: !!generateImages,
    });

    res.status(202).json({ storyId: story.id, jobId: job.id });
  } catch (e: any) {
    debug.error(`Story enqueue failed: ${e.message}`);
    res.status(500).json({ error: "Failed to start story generation" });
  }
});

// Get debug data for a story (admin only)
router.get("/:id/debug", requireAdmin, async (req, res) => {
  const story = await prisma.story.findUnique({
    where: { id: req.params.id as string },
    select: {
      id: true,
      title: true,
      mood: true,
      ageGroup: true,
      debugPlanPrompt: true,
      debugWritePrompt: true,
      debugPlan: true,
      debugStructure: true,
      scenes: {
        select: { sceneNumber: true, imagePrompt: true, imageUrl: true },
        orderBy: { sceneNumber: "asc" },
      },
    },
  });

  if (!story) return res.status(404).json({ error: "Story not found" });

  res.json({
    id: story.id,
    title: story.title,
    mood: story.mood,
    ageGroup: story.ageGroup,
    structure: story.debugStructure,
    plannerSystemPrompt: PLANNER_SYSTEM_PROMPT,
    writerSystemPrompt: buildSystemPrompt(story.ageGroup),
    planPrompt: story.debugPlanPrompt,
    writePrompt: story.debugWritePrompt,
    plan: story.debugPlan ? JSON.parse(story.debugPlan) : null,
    imagePrompts: story.scenes.map((s) => ({
      page: s.sceneNumber,
      prompt: s.imagePrompt,
      imageUrl: s.imageUrl,
    })),
  });
});

// Regenerate ALL scene images for an existing story (admin only).
// Async: creates a story_images job with regenerateAll=true, flips
// the story back to "illustrating", and returns 202. Client polls
// /status the same way it does for first-time generation.
router.post("/:id/regenerate-images", requireAdmin, async (req, res) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, universeId: true, createdById: true, scenes: { select: { id: true } } },
    });

    if (!story) return res.status(404).json({ error: "Story not found" });
    if (!await verifyUniverseOwnership(story.universeId, req.userId as string)) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (story.scenes.length === 0) {
      return res.status(400).json({ error: "Story has no scenes to illustrate" });
    }

    // Flip status so the polling client sees "illustrating" right
    // away. The job processor will flip it to "published" or
    // "failed_illustration" when done.
    await prisma.story.update({
      where: { id: story.id },
      data: { status: "illustrating" },
    });

    const payload: StoryImagesJobPayload = {
      storyId: story.id,
      regenerateAll: true,
    };

    const job = await createJob({
      kind: JOB_KINDS.storyImages,
      ownerId: (story.createdById ?? req.userId) as string,
      storyId: story.id,
      payload: payload as any,
    });

    debug.story("Image regeneration enqueued", { storyId: story.id, jobId: job.id });
    res.status(202).json({ storyId: story.id, jobId: job.id });
  } catch (e: any) {
    debug.error(`Image regeneration enqueue failed: ${e.message}`);
    res.status(500).json({ error: "Failed to start image regeneration" });
  }
});

// Toggle public/featured status (admin only)
router.post("/:id/toggle-public", requireAdmin, async (req, res) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id as string },
    });
    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    const updated = await prisma.story.update({
      where: { id: req.params.id as string },
      data: { isPublic: !story.isPublic },
    });

    debug.story(`Story "${updated.title}" is now ${updated.isPublic ? "public" : "private"}`);
    res.json({ isPublic: updated.isPublic });
  } catch (e) {
    res.status(500).json({ error: "Failed to toggle public status" });
  }
});

// Delete a story and all its data (admin only)
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const storyId = req.params.id as string;
    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    await deleteStoriesCascade([storyId]);

    debug.story(`Deleted story "${story.title}"`);
    res.json({ ok: true });
  } catch (e: any) {
    debug.error(`Failed to delete story: ${e.message}`);
    res.status(500).json({ error: "Failed to delete story" });
  }
});

export default router;
