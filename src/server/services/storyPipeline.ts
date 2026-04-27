import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { buildPrompt } from "./promptBuilder.js";
import { generateStory } from "./storyGenerator.js";
import { generateStoryImages } from "./geminiGenerator.js";
import { updateJobProgress, createJob } from "../lib/jobs.js";
import { JOB_KINDS } from "../lib/queues.js";
import { MOODS } from "../lib/config.js";
import { STRUCTURE_IDS, isStructureId } from "../../shared/structures.js";

// Async story-generation pipeline. Two job kinds run sequentially:
//
//   story_text   → plan + write + (optional) refine image prompts.
//                  Persists scenes; if illustrations were requested,
//                  enqueues story_images and leaves Story.status
//                  in "illustrating".
//   story_images → multi-turn Gemini chat that fills missing scene
//                  images. Idempotent — only generates for scenes
//                  whose imageUrl is empty.
//
// Both processors are written so a worker that crashes mid-run can
// safely re-claim and continue. The Story row itself carries the
// user-facing status; the GenerationJob row carries worker-side
// progress + lastError that the status endpoint surfaces.

export interface StoryTextJobPayload {
  universeId: string;
  characterIds: string[];
  language: string;
  ageGroup: string;
  structure: string;
  mood: string;
  parentPrompt: string;
  generateImages: boolean;
}

export interface StoryImagesJobPayload {
  storyId: string;
  // Optional: if true, regenerate ALL scene images even if imageUrl is
  // set. Used by the admin "regen images" path. Default false (only
  // fills in missing).
  regenerateAll?: boolean;
}

/** Decide structure / mood / character cast for a new story. Pulled out
 * of the route so the same logic can be reused if we ever generate
 * stories from a non-HTTP entry point (e.g. tests, admin tools). */
export async function pickStoryParameters(input: {
  universeId: string;
  requestedStructure?: string;
  requestedCharacterIds?: string[];
}): Promise<{ structure: string; mood: string; characterIds: string[] }> {
  const structure = isStructureId(input.requestedStructure)
    ? input.requestedStructure
    : STRUCTURE_IDS[Math.floor(Math.random() * STRUCTURE_IDS.length)];
  const mood = MOODS[Math.floor(Math.random() * MOODS.length)];

  let characterIds: string[];
  if (Array.isArray(input.requestedCharacterIds) && input.requestedCharacterIds.length > 0) {
    characterIds = input.requestedCharacterIds;
  } else {
    const universeCharacters = await prisma.character.findMany({
      where: { universeId: input.universeId },
    });
    const hero = universeCharacters.find((c) => c.role === "main");
    if (!hero) {
      throw new Error("Universe has no main character");
    }
    const supporting = universeCharacters.filter((c) => c.role !== "main");
    const totalTarget = Math.floor(Math.random() * 3) + 1;
    const supportingTarget = Math.min(totalTarget - 1, supporting.length);
    const shuffled = [...supporting];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    characterIds = [hero.id, ...shuffled.slice(0, supportingTarget).map((c) => c.id)];
  }

  return { structure, mood, characterIds };
}

/** Create the placeholder Story row + StoryCharacter rows. Scenes are
 * NOT created here — they need the plan output, so the text-generation
 * job creates them. The placeholder gives the client an id to navigate
 * to immediately. */
export async function createStoryPlaceholder(input: {
  universeId: string;
  createdById: string;
  ageGroup: string;
  language: string;
  mood: string;
  structure: string;
  characterIds: string[];
  generateImages: boolean;
}) {
  return prisma.story.create({
    data: {
      universeId: input.universeId,
      createdById: input.createdById,
      title: "",
      mood: input.mood,
      language: input.language,
      ageGroup: input.ageGroup,
      // Record intent up front so quota stays correct even if text
      // generation fails partway through.
      hasIllustrations: input.generateImages,
      status: "queued",
      debugStructure: input.structure,
      characters: {
        create: input.characterIds.map((characterId) => ({
          characterId,
          roleInStory: "featured",
        })),
      },
    },
  });
}

/** Process a story_text job. Idempotent: if the Story is already past
 * the "queued"/"generating_text" gate OR scenes already exist, exits
 * without doing work. The scenes check guards against the
 * "worker crashed after createMany but before markJobCompleted" case
 * — without it, a re-claim would write duplicate (storyId, sceneNumber)
 * rows. */
export async function runStoryTextJob(jobId: string, payload: StoryTextJobPayload, storyId: string) {
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: { _count: { select: { scenes: true } } },
  });
  if (!story) {
    throw new Error(`Story ${storyId} not found`);
  }
  if (story.status !== "queued" && story.status !== "generating_text") {
    debug.story(`story_text: ${storyId} already past text generation (status=${story.status}) — skipping`);
    return;
  }
  if (story._count.scenes > 0) {
    debug.story(`story_text: ${storyId} already has ${story._count.scenes} scenes — skipping (likely a re-claim)`);
    // Treat this as "text done" — flip status forward so we don't loop.
    if (payload.generateImages) {
      await prisma.story.update({ where: { id: storyId }, data: { status: "illustrating" } });
      await createJob({
        kind: JOB_KINDS.storyImages,
        ownerId: story.createdById ?? "",
        storyId,
        payload: { storyId } satisfies StoryImagesJobPayload as any,
      });
    } else {
      await prisma.story.update({ where: { id: storyId }, data: { status: "published" } });
    }
    return;
  }

  await prisma.story.update({
    where: { id: storyId },
    data: { status: "generating_text" },
  });
  await updateJobProgress(jobId, "building", 5);

  const { planMessage, writeMessage, ageGroup: resolvedAgeGroup } = await buildPrompt({
    universeId: payload.universeId,
    characterIds: payload.characterIds,
    mood: payload.mood,
    language: payload.language,
    ageGroup: payload.ageGroup,
    structure: payload.structure as any,
    length: "short",
    parentPrompt: payload.parentPrompt,
  });

  await updateJobProgress(jobId, "planning", 15);

  const generated = await generateStory(planMessage, writeMessage, resolvedAgeGroup, {
    generateImages: payload.generateImages,
    onProgress: async (step) => {
      // Map storyGenerator's coarse steps to a progress-percent ramp
      // so the polling client has something to display.
      const percent = step === "planning" ? 25 : step === "writing" ? 55 : step === "refining" ? 85 : 50;
      await updateJobProgress(jobId, step, percent);
    },
  });

  await updateJobProgress(jobId, "saving", 92);

  // Persist the title, debug fields, and scenes. Scenes are created in
  // a single transaction here because this is the first time we have
  // them; the placeholder row had no scenes yet.
  await prisma.$transaction(async (tx) => {
    await tx.story.update({
      where: { id: storyId },
      data: {
        title: generated.title,
        debugPlanPrompt: planMessage,
        debugWritePrompt: writeMessage,
        debugPlan: JSON.stringify(generated.plan || {}),
      },
    });
    await tx.scene.createMany({
      data: generated.pages.map((page) => ({
        storyId,
        sceneNumber: page.page_number,
        content: page.content,
        imagePrompt: page.image_prompt || "",
        imageUrl: "",
      })),
    });
  });

  if (payload.generateImages) {
    // Hand off to the image pipeline — keep status="illustrating"
    // until that job completes.
    await prisma.story.update({
      where: { id: storyId },
      data: { status: "illustrating" },
    });
    await createJob({
      kind: JOB_KINDS.storyImages,
      ownerId: story.createdById ?? "",
      storyId,
      payload: { storyId } satisfies StoryImagesJobPayload as any,
    });
    debug.story(`story_text done; story_images enqueued for ${storyId}`);
  } else {
    await prisma.story.update({
      where: { id: storyId },
      data: { status: "published" },
    });
    debug.story(`story_text done (text-only) for ${storyId}`);
  }
}

/** Process a story_images job. Idempotent: only generates images for
 * scenes that don't already have one (unless `regenerateAll` is set).
 * If every scene already has an image, just flips status to published. */
export async function runStoryImagesJob(jobId: string, payload: StoryImagesJobPayload) {
  const story = await prisma.story.findUnique({
    where: { id: payload.storyId },
    include: {
      scenes: { orderBy: { sceneNumber: "asc" } },
      characters: { include: { character: true } },
    },
  });
  if (!story) {
    throw new Error(`Story ${payload.storyId} not found`);
  }
  if (story.status === "published" && !payload.regenerateAll) {
    debug.image(`story_images: ${payload.storyId} already published — skipping`);
    return;
  }

  const totalPages = story.scenes.length;
  if (totalPages === 0) {
    // No scenes means the text job didn't run (or partially failed).
    // Don't loop on it — fail loudly.
    throw new Error(`Story ${payload.storyId} has no scenes; can't illustrate`);
  }

  // Determine which scenes still need an image.
  const targetScenes = payload.regenerateAll
    ? story.scenes
    : story.scenes.filter((s) => !s.imageUrl);

  if (targetScenes.length === 0) {
    // Everything already done; just publish.
    await prisma.story.update({
      where: { id: payload.storyId },
      data: { status: "published", hasIllustrations: true },
    });
    debug.image(`story_images: ${payload.storyId} all images already saved — marked published`);
    return;
  }

  await prisma.story.update({
    where: { id: payload.storyId },
    data: { status: "illustrating" },
  });
  await updateJobProgress(jobId, "illustrating", 0);

  const targetSceneNumbers = new Set(targetScenes.map((s) => s.sceneNumber));
  const characterIds = story.characters.map((sc) => sc.characterId);

  // We pass ALL pages to Gemini so the chat session has full narrative
  // context — but only persist images for scenes we're targeting.
  const allPages = story.scenes.map((s) => ({
    page_number: s.sceneNumber,
    image_prompt: s.imagePrompt,
    characters_in_scene: [] as string[],
  }));

  let savedCount = 0;
  await generateStoryImages(
    story.universeId,
    characterIds,
    allPages,
    async (pageNum, total, imageUrl) => {
      if (!targetSceneNumbers.has(pageNum)) return;
      const scene = story.scenes.find((s) => s.sceneNumber === pageNum);
      if (!scene) return;
      await prisma.scene.update({
        where: { id: scene.id },
        // For regenerateAll we overwrite. For the default path the
        // imageUrl was empty, so this is a write either way.
        data: { imageUrl },
      });
      savedCount++;
      const percent = Math.round((savedCount / targetScenes.length) * 95);
      await updateJobProgress(jobId, `illustrating ${savedCount}/${targetScenes.length}`, percent);
      debug.image(`Image ${pageNum}/${total} saved for story ${payload.storyId}`);
    },
  );

  // Verify we got SOME images. Gemini sometimes returns zero on every
  // attempt — better to fail the job than to publish an empty book.
  if (savedCount === 0) {
    throw new Error(`Image generation returned no usable images for story ${payload.storyId}`);
  }

  await prisma.story.update({
    where: { id: payload.storyId },
    data: { status: "published", hasIllustrations: true },
  });
  debug.image(`story_images: ${payload.storyId} done (${savedCount}/${targetScenes.length} saved)`);
}

/** Mark a story_text job's failure on the Story row so the polling
 * client sees a terminal state. Mirrored for story_images. */
export async function markStoryTextFailed(storyId: string) {
  await prisma.story.update({
    where: { id: storyId },
    data: { status: "failed_text" },
  });
}

export async function markStoryImagesFailed(storyId: string) {
  await prisma.story.update({
    where: { id: storyId },
    data: { status: "failed_illustration" },
  });
}
