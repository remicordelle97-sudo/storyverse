import { Prisma } from "@prisma/client";
import prisma from "./prisma.js";
import {
  claudeQueue,
  geminiQueue,
  isClaudeKind,
  isGeminiKind,
  type JobKind,
} from "./queues.js";

// Persistence + lifecycle helpers for the GenerationJob row. The BullMQ
// job is scheduled in the matching vendor queue using the GenerationJob
// id as the BullMQ jobId — this keeps the two stores aligned and lets
// the worker look up the DB row from the BullMQ job.
//
// Status vocabulary: queued | running | completed | failed | cancelled.
// `running` is set when a worker claims the row. `completed`/`failed`
// are terminal.

export interface CreateJobInput {
  kind: JobKind;
  ownerId: string;
  storyId?: string | null;
  universeId?: string | null;
  payload?: Prisma.InputJsonValue;
}

/** Create a queued GenerationJob row and (if Redis is configured) enqueue
 * the matching BullMQ job. Returns the row. */
export async function createJob(input: CreateJobInput) {
  const row = await prisma.generationJob.create({
    data: {
      kind: input.kind,
      ownerId: input.ownerId,
      storyId: input.storyId ?? null,
      universeId: input.universeId ?? null,
      payload: input.payload ?? {},
    },
  });

  const queue = isClaudeKind(input.kind)
    ? claudeQueue
    : isGeminiKind(input.kind)
      ? geminiQueue
      : null;

  if (queue) {
    await queue.add(
      input.kind,
      { jobId: row.id },
      {
        jobId: row.id,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    );
  }

  return row;
}

/** Atomically claim a queued/running job for this worker. Returns the
 * updated row, or null if another worker already claimed it. Used by
 * resume on startup and by the per-job processor wrapper. */
export async function claimJob(jobId: string, workerId: string) {
  const result = await prisma.generationJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "queued" },
        // Allow re-claim of a stale running job (lock holder is gone).
        // The caller decides whether the lock is stale before invoking
        // this with a "running" job.
        { status: "running" },
      ],
    },
    data: {
      status: "running",
      lockedAt: new Date(),
      lockedBy: workerId,
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (result.count === 0) return null;
  return prisma.generationJob.findUnique({ where: { id: jobId } });
}

export async function updateJobProgress(
  jobId: string,
  step: string,
  progressPercent: number,
) {
  await prisma.generationJob.update({
    where: { id: jobId },
    data: { step, progressPercent },
  });
}

export async function markJobCompleted(jobId: string) {
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      finishedAt: new Date(),
      progressPercent: 100,
      lockedAt: null,
      lockedBy: null,
      lastError: "",
    },
  });
}

export async function markJobFailed(jobId: string, error: string) {
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: error.slice(0, 4000),
    },
  });
}

/** Find jobs that are queued or appear to have a stale lock. Used by
 * worker startup to resume work after a restart. `staleLockMs` is the
 * threshold beyond which a `running` job is considered abandoned. */
export async function findResumableJobs(staleLockMs: number) {
  const staleBefore = new Date(Date.now() - staleLockMs);
  return prisma.generationJob.findMany({
    where: {
      OR: [
        { status: "queued" },
        { status: "running", lockedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}
