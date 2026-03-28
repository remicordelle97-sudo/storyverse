import { Router } from "express";
import prisma from "../lib/prisma.js";
import { buildPrompt } from "../services/promptBuilder.js";
import { generateStory } from "../services/storyGenerator.js";
import { writeTimelineEvents } from "../services/timelineWriter.js";
import { generateImage } from "../services/imageGenerator.js";

const router = Router();

// List stories for a universe
router.get("/", async (req, res) => {
  try {
    const { universeId } = req.query;
    if (!universeId || typeof universeId !== "string") {
      return res.status(400).json({ error: "universeId query param required" });
    }
    const stories = await prisma.story.findMany({
      where: { universeId },
      include: {
        characters: { include: { character: true } },
        scenes: { orderBy: { sceneNumber: "asc" } },
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
        child: true,
      },
    });
    if (!story) {
      return res.status(404).json({ error: "Story not found" });
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
      childId,
      characterIds,
      mood,
      language,
      length,
      parentPrompt,
      generateImages,
    } = req.body;

    // Pick a random story structure
    const structures = ["problem-solution", "rule-of-three", "cumulative", "circular", "journey"];
    const structure = structures[Math.floor(Math.random() * structures.length)];

    if (!universeId || !childId || !characterIds?.length) {
      return sendError("universeId, childId, and characterIds are required");
    }

    const child = await prisma.child.findUnique({ where: { id: childId } });
    if (!child) {
      return sendError("Child not found");
    }

    // Step 1: Build prompt
    sendProgress("building", "Building your story world...");

    const { userMessage, ageGroup } = await buildPrompt({
      universeId,
      childId,
      characterIds,
      mood: mood || "exciting adventures",
      language: language || "en",
      structure,
      length: length || "long",
      parentPrompt: parentPrompt || "",
    });

    // Step 2: Generate story
    sendProgress("writing", "Writing the story...");

    const generated = await generateStory(userMessage, ageGroup, length || "long");

    // Step 3: Save to database
    sendProgress("saving", `"${generated.title}" — saving ${generated.pages.length} pages...`);

    const story = await prisma.story.create({
      data: {
        universeId,
        childId,
        title: generated.title,
        mood: mood || "exciting adventures",
        language: language || "en",
        ageGroup: child.ageGroup,
        status: "published",
      },
    });

    // Save pages and optionally generate images
    const totalPages = generated.pages.length;
    for (let i = 0; i < totalPages; i++) {
      const page = generated.pages[i];
      let imageUrl = "";

      if (generateImages && page.image_prompt) {
        sendProgress(
          "illustrating",
          `Creating illustration ${i + 1} of ${totalPages}...`
        );
        try {
          imageUrl = await generateImage(page.image_prompt);
        } catch (e) {
          console.error(`Image generation failed for page ${page.page_number}:`, e);
        }
      }

      await prisma.scene.create({
        data: {
          storyId: story.id,
          sceneNumber: page.page_number,
          content: page.content,
          imagePrompt: page.image_prompt || "",
          imageUrl,
        },
      });
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

    // Write timeline events
    sendProgress("finishing", "Adding to the timeline...");
    await writeTimelineEvents(story.id, universeId, generated);

    // Fetch the full story to return
    const fullStory = await prisma.story.findUnique({
      where: { id: story.id },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { include: { character: true } },
      },
    });

    sendComplete(fullStory);
  } catch (e) {
    console.error("Story generation failed:", e);
    sendError("Story generation failed. Please try again.");
  }
});

export default router;
