import { Queue } from "bullmq";
import IORedis from "ioredis";
import { debug } from "./debug.js";

// Vendor-level queues. Each AI vendor gets one queue so we have one
// concurrency dial per vendor — independent of which feature is producing
// the load. claude-tasks carries story_text + universe_build, gemini-tasks
// carries story_images + universe_images.
//
// If REDIS_URL is unset, the queues are null. Routes that try to enqueue
// must fall back to in-process execution, mirroring the existing
// imageQueue.ts behavior. This keeps local dev frictionless (no Redis
// needed for a single-process workflow).

const REDIS_URL = process.env.REDIS_URL;

export const redisConnection = REDIS_URL
  ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
  : null;

export const CLAUDE_QUEUE_NAME = "claude-tasks";
export const GEMINI_QUEUE_NAME = "gemini-tasks";

export const claudeQueue = redisConnection
  ? new Queue(CLAUDE_QUEUE_NAME, { connection: redisConnection })
  : null;

export const geminiQueue = redisConnection
  ? new Queue(GEMINI_QUEUE_NAME, { connection: redisConnection })
  : null;

// Conservative starting concurrency. A single illustrated story fans out
// into many vendor calls (~10 Gemini calls per story, 3 Claude calls).
// Tune upward only after observing queue depth, runtime, and 429 rates.
export const CLAUDE_QUEUE_CONCURRENCY = parseInt(
  process.env.CLAUDE_QUEUE_CONCURRENCY ?? "2",
  10,
);
export const GEMINI_QUEUE_CONCURRENCY = parseInt(
  process.env.GEMINI_QUEUE_CONCURRENCY ?? "2",
  10,
);

// Job kinds, namespaced to the queue that handles them. Used as the
// BullMQ job name and stored on GenerationJob.kind.
export const JOB_KINDS = {
  storyText: "story_text",
  universeBuild: "universe_build",
  storyImages: "story_images",
  universeImages: "universe_images",
} as const;

export type JobKind = (typeof JOB_KINDS)[keyof typeof JOB_KINDS];

export function isClaudeKind(kind: string): boolean {
  return kind === JOB_KINDS.storyText || kind === JOB_KINDS.universeBuild;
}

export function isGeminiKind(kind: string): boolean {
  return kind === JOB_KINDS.storyImages || kind === JOB_KINDS.universeImages;
}

if (!redisConnection) {
  debug.image("Queues: REDIS_URL not set — claude-tasks/gemini-tasks queues disabled, falling back to in-process");
} else {
  debug.image(
    `Queues: claude-tasks (concurrency=${CLAUDE_QUEUE_CONCURRENCY}), gemini-tasks (concurrency=${GEMINI_QUEUE_CONCURRENCY})`,
  );
}
