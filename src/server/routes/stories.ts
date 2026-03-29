import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { buildPrompt } from "../services/promptBuilder.js";
import { generateStory } from "../services/storyGenerator.js";
import { writeTimelineEvents } from "../services/timelineWriter.js";
import { generateImage } from "../services/imageGenerator.js";
import { generateFluxImage } from "../services/fluxGenerator.js";

const router = Router();

// List stories — optionally filtered by universeId, otherwise all for user
router.get("/", async (req, res) => {
  try {
    const { universeId } = req.query;
    const where: any = {};

    if (universeId && typeof universeId === "string") {
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
      mood,
      language,
      ageGroup,
      structure: requestedStructure,
      length,
      parentPrompt,
      generateImages,
      imageQuality,
      imageEngine,
    } = req.body;

    // Use requested structure, or pick randomly if not provided
    const structures = ["problem-solution", "rule-of-three", "cumulative", "circular", "journey", "unlikely-friendship"];
    const structure = requestedStructure && structures.includes(requestedStructure)
      ? requestedStructure
      : structures[Math.floor(Math.random() * structures.length)];

    if (!universeId || !characterIds?.length || !ageGroup) {
      return sendError("universeId, characterIds, and ageGroup are required");
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
      imageEngine: imageEngine || "flux",
      imageQuality: imageQuality || "high",
    });

    // Step 1: Build prompt
    sendProgress("building", "Building your story world...");
    debug.prompt("Building prompt...");
    const promptStart = Date.now();

    const { userMessage, ageGroup: resolvedAgeGroup } = await buildPrompt({
      universeId,
      characterIds,
      mood: mood || "exciting adventures",
      language: language || "en",
      ageGroup,
      structure,
      length: length || "long",
      parentPrompt: parentPrompt || "",
    });

    debug.prompt(`Prompt built in ${Date.now() - promptStart}ms`, {
      promptLength: userMessage.length,
      ageGroup: resolvedAgeGroup,
    });

    // Step 2: Generate story
    sendProgress("writing", "Writing the story...");
    debug.story("Calling Claude for story generation...");
    const storyStart = Date.now();

    const generated = await generateStory(userMessage, resolvedAgeGroup, length || "long");

    debug.story(`Story generated in ${Date.now() - storyStart}ms`, {
      title: generated.title,
      pages: generated.pages.length,
      timelineEvents: generated.timeline_events?.length || 0,
    });

    // Step 3: Save to database
    sendProgress("saving", `"${generated.title}" — saving ${generated.pages.length} pages...`);

    const story = await prisma.story.create({
      data: {
        universeId,
        title: generated.title,
        mood: mood || "exciting adventures",
        language: language || "en",
        ageGroup,
        status: "published",
      },
    });

    // Save pages and optionally generate images (in parallel batches of 4)
    const totalPages = generated.pages.length;

    const engine = imageEngine || "flux";

    if (generateImages) {
      const engineLabel = engine === "flux" ? "Flux" : "GPT-4o";
      debug.image(`=== IMAGE GENERATION START (${engineLabel}, quality=${imageQuality || "high"}) ===`);
      debug.image(`Generating ${totalPages} illustrations sequentially`);
      sendProgress("illustrating", `Creating ${totalPages} illustrations with ${engineLabel}...`);

      const generatedImageUrls: string[] = [];
      const imageStartTotal = Date.now();

      for (let i = 0; i < totalPages; i++) {
        const page = generated.pages[i];
        let imageUrl = "";
        let imageSeed = 0;

        sendProgress(
          "illustrating",
          `Creating illustration ${i + 1} of ${totalPages} (${engineLabel})...`
        );

        if (page.image_prompt) {
          debug.image(`Page ${i + 1}/${totalPages}: generating...`, {
            promptPreview: page.image_prompt.slice(0, 80),
            previousPages: generatedImageUrls.length,
          });
          const pageImgStart = Date.now();

          try {
            if (engine === "gpt4o") {
              imageUrl = await generateImage(
                page.image_prompt,
                universeId,
                characterIds,
                mood || "exciting adventures",
                ageGroup,
                generatedImageUrls,
                imageQuality || "high"
              );
            } else {
              const result = await generateFluxImage(
                page.image_prompt,
                universeId,
                characterIds,
                mood || "exciting adventures",
                ageGroup,
                generatedImageUrls,
                imageQuality || "high"
              );
              imageUrl = result.imageUrl;
              imageSeed = result.seed;
            }
            if (imageUrl) generatedImageUrls.push(imageUrl);
            debug.image(`Page ${i + 1}/${totalPages}: done in ${Date.now() - pageImgStart}ms`, {
              imageUrl,
              seed: imageSeed || "n/a",
            });
          } catch (e: any) {
            debug.error(`Page ${i + 1}/${totalPages}: image generation failed: ${e.message}`);
          }
        }

        await prisma.scene.create({
          data: {
            storyId: story.id,
            sceneNumber: page.page_number,
            content: page.content,
            imagePrompt: page.image_prompt || "",
            imageUrl,
            imageSeed,
            imageEngine: imageUrl ? engine : "",
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

export default router;
