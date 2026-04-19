import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { requireAdmin } from "../middleware/auth.js";
import { checkStoryQuota } from "../lib/quota.js";
import { buildPrompt, buildSystemPrompt } from "../services/promptBuilder.js";
import { generateStory, PLANNER_SYSTEM_PROMPT } from "../services/storyGenerator.js";
import { MOODS } from "../lib/config.js";
import { generateStoryImages } from "../services/geminiGenerator.js";
import { enqueueImageGeneration } from "../lib/imageQueue.js";
import { verifyUniverseOwnership, verifyUniverseAccess } from "../lib/ownership.js";

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

router.get("/", async (req, res) => {
  try {
    const { universeId } = req.query;

    if (universeId && typeof universeId === "string") {
      if (!await verifyUniverseOwnership(universeId, req.userId as string)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const stories = await prisma.story.findMany({
        where: { universeId },
        include: {
          characters: { include: { character: true } },
          scenes: { orderBy: { sceneNumber: "asc" } },
          universe: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json(stories);
    }

    // User's own stories (created by them) + public/featured stories
    const stories = await prisma.story.findMany({
      where: {
        OR: [
          { createdById: req.userId as string },
          { createdById: null, universe: { userId: req.userId as string } },
          { isPublic: true },
        ],
      },
      include: {
        characters: { include: { character: true } },
        scenes: { orderBy: { sceneNumber: "asc" } },
        universe: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(stories);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch stories" });
  }
});

// Check story status (for polling during image generation)
router.get("/:id/status", async (req, res) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true,
        status: true,
        hasIllustrations: true,
        scenes: { select: { sceneNumber: true, imageUrl: true }, orderBy: { sceneNumber: "asc" } },
      },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });

    const imagesReady = story.scenes.filter((s) => s.imageUrl).length;
    const totalPages = story.scenes.length;

    res.json({
      status: story.status,
      hasIllustrations: story.hasIllustrations,
      imagesReady,
      totalPages,
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

// Trigger AI generation with SSE progress
router.post("/generate", async (req, res) => {
  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send heartbeat every 30s to prevent proxy/Railway timeout
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  function sendProgress(step: string, detail?: string) {
    const data = JSON.stringify({ type: "progress", step, detail });
    res.write(`data: ${data}\n\n`);
  }

  function sendError(message: string) {
    clearInterval(heartbeat);
    const data = JSON.stringify({ type: "error", error: message });
    res.write(`data: ${data}\n\n`);
    res.end();
  }

  function sendComplete(story: any) {
    clearInterval(heartbeat);
    const data = JSON.stringify({ type: "complete", story });
    res.write(`data: ${data}\n\n`);
    res.end();
  }

  // Clean up heartbeat if client disconnects
  res.on("close", () => clearInterval(heartbeat));

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

    // Use requested structure, or pick randomly if not provided
    const structures = ["problem-solution", "rule-of-three", "cumulative", "circular", "journey", "unlikely-friendship"];
    const structure = requestedStructure && structures.includes(requestedStructure)
      ? requestedStructure
      : structures[Math.floor(Math.random() * structures.length)];

    // Pick mood randomly for each story
    const mood = MOODS[Math.floor(Math.random() * MOODS.length)];

    if (!universeId || !ageGroup) {
      return sendError("universeId and ageGroup are required");
    }

    // Check story quota for the right bucket (illustrated vs text-only)
    const quota = await checkStoryQuota(req.userId as string, !!generateImages);
    if (!quota.allowed) {
      const kind = generateImages ? "illustrated stories" : "text-only stories";
      return sendError(`You've reached your limit of ${quota.limit} ${kind} this month. Upgrade to premium for more.`);
    }

    if (!await verifyUniverseAccess(universeId, req.userId as string)) {
      return sendError("Access denied");
    }

    // Resolve character cast. If the client provides an explicit list (admin
    // workflow), honor it. Otherwise pick randomly: hero is always included,
    // then a uniformly-random number of supporting characters (0, 1, or 2)
    // is added so each story has 1-3 characters total.
    let characterIds: string[];
    if (Array.isArray(requestedCharacterIds) && requestedCharacterIds.length > 0) {
      characterIds = requestedCharacterIds;
    } else {
      const universeCharacters = await prisma.character.findMany({
        where: { universeId },
      });
      const hero = universeCharacters.find((c) => c.role === "main");
      if (!hero) {
        return sendError("Universe has no main character");
      }
      const supporting = universeCharacters.filter((c) => c.role !== "main");
      // Pick total character count uniformly from {1, 2, 3} then derive how
      // many supporting characters that means. Cap by what's actually
      // available in the universe.
      const totalTarget = Math.floor(Math.random() * 3) + 1;
      const supportingTarget = Math.min(totalTarget - 1, supporting.length);
      // Fisher-Yates shuffle on a copy so each story gets a fresh random pick.
      const shuffled = [...supporting];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      characterIds = [hero.id, ...shuffled.slice(0, supportingTarget).map((c) => c.id)];
    }

    debug.story("=== STORY GENERATION START ===");
    debug.story("Parameters", {
      universeId,
      characters: characterIds.length,
      mood,
      ageGroup,
      structure,
      generateImages: !!generateImages,
    });

    // Step 1: Build prompt
    sendProgress("building", "Building your story world...");
    debug.prompt("Building prompt...");
    const promptStart = Date.now();

    const { planMessage, writeMessage, ageGroup: resolvedAgeGroup } = await buildPrompt({
      universeId,
      characterIds,
      mood: mood,
      language: language || "en",
      ageGroup,
      structure,
      length: "short",
      parentPrompt: parentPrompt || "",
    });

    debug.prompt(`Prompt built in ${Date.now() - promptStart}ms`, {
      planLength: planMessage.length,
      writeLength: writeMessage.length,
      ageGroup: resolvedAgeGroup,
    });

    // Step 2: Generate story text (plan + write)
    debug.story("Calling Claude for story generation...");
    const storyStart = Date.now();

    if (res.closed) {
      debug.story("Client disconnected before story generation");
      return;
    }

    const generated = await generateStory(
      planMessage,
      writeMessage,
      resolvedAgeGroup,
      {
        generateImages: !!generateImages,
        onProgress: (step, detail) => sendProgress(step, detail),
      },
    );

    debug.story(`Story generated in ${Date.now() - storyStart}ms`, {
      title: generated.title,
      pages: generated.pages.length,
    });

    // Step 3: Save story with text (images pending)
    sendProgress("saving", `"${generated.title}" — saving...`);

    const story = await prisma.story.create({
      data: {
        universeId,
        createdById: req.userId as string,
        title: generated.title,
        mood: mood,
        language: language || "en",
        ageGroup,
        status: generateImages ? "illustrating" : "published",
        // Record intent at creation so quota counts stay stable while a
        // story is mid-illustration. imageQueue still flips this to true
        // on success (idempotent).
        hasIllustrations: !!generateImages,
        debugPlanPrompt: planMessage,
        debugWritePrompt: writeMessage,
        debugPlan: JSON.stringify(generated.plan || {}),
        debugStructure: structure,
        scenes: {
          create: generated.pages.map((page) => ({
            sceneNumber: page.page_number,
            content: page.content,
            imagePrompt: page.image_prompt || "",
            imageUrl: "",
            imageSeed: 0,
            imageEngine: "",
          })),
        },
        characters: {
          create: characterIds.map((charId: string) => ({
            characterId: charId,
            roleInStory: "featured",
          })),
        },
      },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { include: { character: true } },
      },
    });

    debug.story("Story text saved", { storyId: story.id, title: story.title });

    // Return story ID to client — client will poll for completion
    sendComplete(story);

    // Step 4: Queue image generation (runs in background via BullMQ or in-process fallback)
    if (generateImages) {
      const sceneMap: Record<number, string> = {};
      for (const scene of story.scenes) {
        sceneMap[scene.sceneNumber] = scene.id;
      }
      enqueueImageGeneration({
        storyId: story.id,
        universeId,
        characterIds,
        mood,
        pages: generated.pages.map((p) => ({
          page_number: p.page_number,
          image_prompt: p.image_prompt,
          characters_in_scene: p.characters_in_scene,
        })),
        sceneMap,
      });
    }
  } catch (e: any) {
    debug.error(`Story generation failed: ${e.message}`);
    sendError("Story generation failed. Please try again.");
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

// Regenerate images for an existing story
router.post("/:id/regenerate-images", requireAdmin, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  function sendProgress(step: string, detail?: string) {
    res.write(`data: ${JSON.stringify({ type: "progress", step, detail })}\n\n`);
  }
  function sendError(message: string) {
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`);
    res.end();
  }
  function sendComplete(story: any) {
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ type: "complete", story })}\n\n`);
    res.end();
  }

  res.on("close", () => clearInterval(heartbeat));

  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id as string },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { include: { character: true } },
        universe: true,
      },
    });

    if (!story) return sendError("Story not found");
    if (!await verifyUniverseOwnership(story.universeId, req.userId as string)) {
      return sendError("Access denied");
    }

    const characterIds = story.characters.map((sc: any) => sc.characterId);
    const pages = story.scenes.map((s: any) => ({
      page_number: s.sceneNumber,
      image_prompt: s.imagePrompt,
    }));

    const mood = MOODS[Math.floor(Math.random() * MOODS.length)];

    sendProgress("illustrating", `Regenerating ${pages.length} illustrations...`);

    const imageMap = await generateStoryImages(
      story.universeId,
      characterIds,
      mood,
      pages,
      (pageNum, total, _imageUrl) => {
        sendProgress("illustrating", `Created illustration ${pageNum} of ${total}...`);
      }
    );

    // Update scenes with new images
    for (const scene of story.scenes) {
      const newUrl = imageMap.get(scene.sceneNumber);
      if (newUrl) {
        await prisma.scene.update({
          where: { id: scene.id },
          data: {
            imageUrl: newUrl,
            imageEngine: "gemini",
          },
        });
      }
    }

    const fullStory = await prisma.story.findUnique({
      where: { id: story.id },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { include: { character: true } },
      },
    });

    sendComplete(fullStory);
  } catch (e: any) {
    debug.error(`Image regeneration failed: ${e.message}`);
    sendError("Image regeneration failed. Please try again.");
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

    await prisma.storyCharacter.deleteMany({ where: { storyId } });
    await prisma.scene.deleteMany({ where: { storyId } });
    await prisma.story.delete({ where: { id: storyId } });

    debug.story(`Deleted story "${story.title}"`);
    res.json({ ok: true });
  } catch (e: any) {
    debug.error(`Failed to delete story: ${e.message}`);
    res.status(500).json({ error: "Failed to delete story" });
  }
});

export default router;
