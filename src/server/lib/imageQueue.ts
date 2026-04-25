import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import prisma from "./prisma.js";
import { debug } from "./debug.js";
import { generateStoryImages } from "../services/geminiGenerator.js";

const REDIS_URL = process.env.REDIS_URL;

// Connection is null if no Redis URL — image generation falls back to in-process
const connection = REDIS_URL ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) : null;

export const imageQueue = connection
  ? new Queue("image-generation", { connection })
  : null;

interface ImageJobData {
  storyId: string;
  universeId: string;
  characterIds: string[];
  pages: { page_number: number; image_prompt: string; characters_in_scene?: string[] }[];
  sceneMap: Record<number, string>; // sceneNumber → sceneId
}

/**
 * Add an image generation job to the queue.
 * Falls back to in-process generation if Redis is not available.
 */
export async function enqueueImageGeneration(data: ImageJobData): Promise<void> {
  if (imageQueue) {
    await imageQueue.add("generate-images", data, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
    debug.image(`Queued image generation for story ${data.storyId}`);
  } else {
    // No Redis — fall back to fire-and-forget (existing behavior)
    debug.image(`No Redis — running image generation in-process for story ${data.storyId}`);
    runImageGeneration(data);
  }
}

/** Process a single image generation job */
async function runImageGeneration(data: ImageJobData): Promise<void> {
  const { storyId, universeId, characterIds, pages, sceneMap } = data;

  try {
    await generateStoryImages(
      universeId,
      characterIds,
      pages,
      async (pageNum, total, imageUrl) => {
        const sceneId = sceneMap[pageNum];
        if (sceneId) {
          await prisma.scene.update({
            where: { id: sceneId },
            data: { imageUrl },
          });
        }
        debug.image(`Image ${pageNum}/${total} saved for story ${storyId}`);
      },
    );
    await prisma.story.update({
      where: { id: storyId },
      data: { status: "published", hasIllustrations: true },
    });
    debug.image(`Image generation complete for story ${storyId}`);
  } catch (err: any) {
    debug.error(`Image generation failed for story ${storyId}: ${err.message}`);
    await prisma.story.update({
      where: { id: storyId },
      data: { status: "published" },
    });
    throw err; // Re-throw so BullMQ knows the job failed (triggers retry)
  }
}

/** Start the image generation worker. Call once at server startup. */
export function startImageWorker(): void {
  if (!connection) {
    debug.image("No Redis URL — image queue worker not started (using in-process fallback)");
    return;
  }

  const worker = new Worker<ImageJobData>(
    "image-generation",
    async (job) => {
      debug.image(`Worker processing job ${job.id} for story ${job.data.storyId}`);
      await runImageGeneration(job.data);
    },
    {
      connection,
      concurrency: 2, // Max 2 stories generating images at once
    },
  );

  worker.on("completed", (job) => {
    debug.image(`Worker completed job ${job.id}`);
  });

  worker.on("failed", (job, err) => {
    debug.error(`Worker job ${job?.id} failed: ${err.message}`);
  });

  debug.image("Image queue worker started (concurrency: 2)");
}
