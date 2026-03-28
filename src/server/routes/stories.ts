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

// Trigger AI generation
router.post("/generate", async (req, res) => {
  try {
    const {
      universeId,
      childId,
      characterIds,
      mood,
      language,
      structure,
      parentPrompt,
      generateImages,
    } = req.body;

    if (!universeId || !childId || !characterIds?.length) {
      return res.status(400).json({
        error: "universeId, childId, and characterIds are required",
      });
    }

    const child = await prisma.child.findUnique({ where: { id: childId } });
    if (!child) {
      return res.status(404).json({ error: "Child not found" });
    }

    // Build prompt and generate story
    const { userMessage, ageGroup } = await buildPrompt({
      universeId,
      childId,
      characterIds,
      mood: mood || "exciting adventures",
      language: language || "en",
      structure: structure || "problem-solution",
      parentPrompt: parentPrompt || "",
    });

    const generated = await generateStory(userMessage, ageGroup);

    // Save story
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
    for (const page of generated.pages) {
      let imageUrl = "";
      if (generateImages && page.image_prompt) {
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
    await writeTimelineEvents(story.id, universeId, generated);

    // Fetch the full story to return
    const fullStory = await prisma.story.findUnique({
      where: { id: story.id },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { include: { character: true } },
      },
    });

    res.status(201).json({ story: fullStory });
  } catch (e) {
    console.error("Story generation failed:", e);
    res.status(500).json({ error: "Story generation failed. Please try again." });
  }
});

export default router;
