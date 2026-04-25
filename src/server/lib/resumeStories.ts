import prisma from "./prisma.js";
import { debug } from "./debug.js";
import { generateStoryImages } from "../services/geminiGenerator.js";

/**
 * On server startup, find stories stuck in "illustrating" status
 * (from a previous container shutdown) and resume image generation.
 */
export async function resumeIncompleteStories(): Promise<void> {
  const incompleteStories = await prisma.story.findMany({
    where: { status: "illustrating" },
    include: {
      scenes: { orderBy: { sceneNumber: "asc" } },
      characters: { include: { character: true } },
      universe: true,
    },
  });

  if (incompleteStories.length === 0) return;

  debug.image(`Found ${incompleteStories.length} incomplete stories — resuming image generation`);

  for (const story of incompleteStories) {
    try {
      const missingScenes = story.scenes.filter((s) => !s.imageUrl);
      if (missingScenes.length === 0) {
        // All images are actually done — just update status
        await prisma.story.update({
          where: { id: story.id },
          data: { status: "published", hasIllustrations: true },
        });
        debug.image(`Story "${story.title}" already has all images — marked published`);
        continue;
      }

      debug.image(`Resuming "${story.title}" — ${missingScenes.length}/${story.scenes.length} images missing`);

      const characterIds = story.characters.map((sc) => sc.characterId);

      // Build pages from ALL scenes (not just missing ones) so the Gemini
      // chat gets the full narrative context for visual consistency.
      // generateStoryImages will generate images for all pages, but we
      // only save the ones that are missing.
      const allPages = story.scenes.map((s) => ({
        page_number: s.sceneNumber,
        image_prompt: s.imagePrompt,
        characters_in_scene: [] as string[],
      }));

      const missingPageNumbers = new Set(missingScenes.map((s) => s.sceneNumber));

      generateStoryImages(
        story.universeId,
        characterIds,
        story.mood,
        allPages,
        async (pageNum, _total, imageUrl) => {
          // Only save images for scenes that don't already have one
          if (!missingPageNumbers.has(pageNum)) return;
          const scene = story.scenes.find((s) => s.sceneNumber === pageNum);
          if (scene) {
            await prisma.scene.update({
              where: { id: scene.id },
              data: { imageUrl },
            });
          }
          debug.image(`Resumed image ${pageNum} saved for "${story.title}"`);
        }
      ).then(async () => {
        await prisma.story.update({
          where: { id: story.id },
          data: { status: "published", hasIllustrations: true },
        });
        debug.image(`Resume complete for "${story.title}"`);
      }).catch(async (err) => {
        debug.error(`Resume failed for "${story.title}": ${err.message}`);
        await prisma.story.update({
          where: { id: story.id },
          data: { status: "published" },
        });
      });
    } catch (err: any) {
      debug.error(`Failed to set up resume for "${story.title}": ${err.message}`);
      // Mark as published so it doesn't stay stuck forever
      await prisma.story.update({
        where: { id: story.id },
        data: { status: "published" },
      });
    }
  }
}
