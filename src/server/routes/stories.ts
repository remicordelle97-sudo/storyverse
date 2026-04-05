import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { buildPrompt } from "../services/promptBuilder.js";
import { generateStory } from "../services/storyGenerator.js";
import { MOODS } from "../lib/config.js";
import { generateStoryImages } from "../services/geminiGenerator.js";
import { verifyUniverseOwnership } from "../lib/ownership.js";

const router = Router();

// List stories — optionally filtered by universeId, otherwise all for user
router.get("/", async (req, res) => {
  try {
    const { universeId } = req.query;
    const where: any = {};

    if (universeId && typeof universeId === "string") {
      if (!await verifyUniverseOwnership(universeId, req.userId!)) {
        return res.status(403).json({ error: "Access denied" });
      }
      where.universeId = universeId;
    } else {
      // All stories across user's universes
      const userUniverses = await prisma.universe.findMany({
        where: { userId: req.userId },
        select: { id: true },
      });
      where.universeId = { in: userUniverses.map((u) => u.id) };
    }

    const stories = await prisma.story.findMany({
      where,
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

// Full story with scenes and characters
router.get("/:id", async (req, res) => {
  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id },
      include: {
        characters: { include: { character: true } },
        scenes: { orderBy: { sceneNumber: "asc" } },
        universe: true,
      },
    });
    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }
    if (!await verifyUniverseOwnership(story.universeId, req.userId!)) {
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

  function sendProgress(step: string, detail?: string) {
    const data = JSON.stringify({ type: "progress", step, detail });
    res.write(`data: ${data}\n\n`);
  }

  function sendError(message: string) {
    const data = JSON.stringify({ type: "error", error: message });
    res.write(`data: ${data}\n\n`);
    res.end();
  }

  function sendComplete(story: any) {
    const data = JSON.stringify({ type: "complete", story });
    res.write(`data: ${data}\n\n`);
    res.end();
  }

  try {
    const {
      universeId,
      characterIds,
      language,
      ageGroup,
      structure: requestedStructure,
      length,
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

    if (!universeId || !characterIds?.length || !ageGroup) {
      return sendError("universeId, characterIds, and ageGroup are required");
    }

    if (!await verifyUniverseOwnership(universeId, req.userId!)) {
      return sendError("Access denied");
    }

    debug.story("=== STORY GENERATION START ===");
    debug.story("Parameters", {
      universeId,
      characters: characterIds.length,
      mood,
      ageGroup,
      structure,
      length: length || "long",
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
      length: length || "long",
      parentPrompt: parentPrompt || "",
    });

    debug.prompt(`Prompt built in ${Date.now() - promptStart}ms`, {
      planLength: planMessage.length,
      writeLength: writeMessage.length,
      ageGroup: resolvedAgeGroup,
    });

    // Step 2: Generate story (plan + write)
    debug.story("Calling Claude for story generation...");
    const storyStart = Date.now();

    // Fetch character visual data for identity anchors
    const storyCharacters = await prisma.character.findMany({
      where: { id: { in: characterIds } },
      select: { name: true, appearance: true, outfit: true, specialDetail: true },
    });

    const generated = await generateStory(
      planMessage,
      writeMessage,
      resolvedAgeGroup,
      length || "long",
      (step, detail) => sendProgress(step, detail),
      storyCharacters
    );

    debug.story(`Story generated in ${Date.now() - storyStart}ms`, {
      title: generated.title,
      pages: generated.pages.length,
    });

    // Step 3: Save to database
    sendProgress("saving", `"${generated.title}" — saving ${generated.pages.length} pages...`);

    const story = await prisma.story.create({
      data: {
        universeId,
        title: generated.title,
        mood: mood,
        language: language || "en",
        ageGroup,
        status: "published",
      },
    });

    const totalPages = generated.pages.length;

    if (generateImages) {
      debug.image(`=== IMAGE GENERATION START (Gemini multi-turn chat) ===`);
      sendProgress("illustrating", `Creating ${totalPages} illustrations...`);

      // Generate all images in a single chat session for consistency
      const imageMap = await generateStoryImages(
        universeId,
        characterIds,
        mood,
        generated.pages,
        (pageNum, total, _imageUrl) => {
          sendProgress("illustrating", `Created illustration ${pageNum} of ${total}...`);
        },
        generated.characterAnchors
      );

      // Save all pages with their images
      for (const page of generated.pages) {
        await prisma.scene.create({
          data: {
            storyId: story.id,
            sceneNumber: page.page_number,
            content: page.content,
            imagePrompt: page.image_prompt || "",
            imageUrl: imageMap.get(page.page_number) || "",
            imageSeed: 0,
            imageEngine: imageMap.has(page.page_number) ? "gemini" : "",
          },
        });
      }
    } else {
      // No images — save pages directly
      for (const page of generated.pages) {
        await prisma.scene.create({
          data: {
            storyId: story.id,
            sceneNumber: page.page_number,
            content: page.content,
            imagePrompt: page.image_prompt || "",
            imageUrl: "",
          },
        });
      }
    }

    // Save story-character associations
    for (const charId of characterIds) {
      await prisma.storyCharacter.create({
        data: {
          storyId: story.id,
          characterId: charId,
          roleInStory: "featured",
        },
      });
    }

    // Fetch the full story to return
    const fullStory = await prisma.story.findUnique({
      where: { id: story.id },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { include: { character: true } },
      },
    });

    debug.story("=== STORY GENERATION COMPLETE ===", {
      storyId: fullStory?.id,
      title: fullStory?.title,
      pages: fullStory?.scenes?.length,
      images: fullStory?.scenes?.filter((s: any) => s.imageUrl).length,
    });

    sendComplete(fullStory);
  } catch (e: any) {
    debug.error(`Story generation failed: ${e.message}`);
    sendError("Story generation failed. Please try again.");
  }
});

// Regenerate images for an existing story
router.post("/:id/regenerate-images", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function sendProgress(step: string, detail?: string) {
    res.write(`data: ${JSON.stringify({ type: "progress", step, detail })}\n\n`);
  }
  function sendError(message: string) {
    res.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`);
    res.end();
  }
  function sendComplete(story: any) {
    res.write(`data: ${JSON.stringify({ type: "complete", story })}\n\n`);
    res.end();
  }

  try {
    const story = await prisma.story.findUnique({
      where: { id: req.params.id },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { include: { character: true } },
        universe: true,
      },
    });

    if (!story) return sendError("Story not found");
    if (!await verifyUniverseOwnership(story.universeId, req.userId!)) {
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

export default router;
