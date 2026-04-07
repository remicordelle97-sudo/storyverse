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

    debug.image(`Resuming image generation for "${story.title}" (${missingScenes.length} images missing)`);

    const characterIds = story.characters.map((sc) => sc.characterId);
    const pages = story.scenes.map((s) => ({
      page_number: s.sceneNumber,
      image_prompt: s.imagePrompt,
      characters_in_scene: [] as string[],
    }));

    // Only generate images for scenes that don't have one yet
    const pagesToGenerate = pages.filter((p) =>
      missingScenes.some((s) => s.sceneNumber === p.page_number)
    );

    generateStoryImages(
      story.universeId,
      characterIds,
      story.mood,
      pagesToGenerate,
      async (pageNum, _total, imageUrl) => {
        const scene = story.scenes.find((s) => s.sceneNumber === pageNum);
        if (scene) {
          await prisma.scene.update({
            where: { id: scene.id },
            data: { imageUrl, imageEngine: "gemini" },
          });
        }
        debug.image(`Resumed image ${pageNum} saved for story "${story.title}"`);
      }
    ).then(async () => {
      await prisma.story.update({
        where: { id: story.id },
        data: { status: "published", hasIllustrations: true },
      });
      debug.image(`Resumed image generation complete for "${story.title}"`);
    }).catch(async (err) => {
      debug.error(`Resumed image generation failed for "${story.title}": ${err.message}`);
      await prisma.story.update({
        where: { id: story.id },
        data: { status: "published" },
      });
    });
  }
}
