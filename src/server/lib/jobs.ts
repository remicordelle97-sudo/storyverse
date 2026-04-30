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

/** Atomically claim a queued job for this worker. Returns the
 * updated row, or null if the job was no longer queued (already
 * claimed, completed, or failed).
 *
 * Strict by design: ONLY status='queued' is accepted. A "running"
 * job is owned by some other worker — even if its lockedAt is old.
 * The caller (resume sweep) is responsible for resetting an
 * abandoned-running row back to queued FIRST and then claiming it
 * here. Without this discipline two workers could race on the same
 * BullMQ delivery and double-execute. */
export async function claimJob(jobId: string, workerId: string) {
  const result = await prisma.generationJob.updateMany({
    where: {
      id: jobId,
      status: "queued",
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

/** Find jobs the worker should reclaim. `staleLockMs` is the threshold
 * beyond which a `running` job is considered abandoned.
 *
 * - With `includeQueued: true` (default, no-Redis poll path), returns
 *   queued rows AND stale-running rows. The poller picks up new work
 *   plus recovers crashed work.
 * - With `includeQueued: false` (BullMQ-backed boot path), returns
 *   only stale-running rows. Healthy queued rows are BullMQ's
 *   responsibility — re-enqueueing them is wasteful and, combined with
 *   any race in the claim path, risks duplicate execution. */
export async function findResumableJobs(
  staleLockMs: number,
  opts: { includeQueued?: boolean } = {},
) {
  const staleBefore = new Date(Date.now() - staleLockMs);
  const includeQueued = opts.includeQueued ?? true;
  return prisma.generationJob.findMany({
    where: {
      OR: includeQueued
        ? [
            { status: "queued" },
            { status: "running", lockedAt: { lt: staleBefore } },
          ]
        : [{ status: "running", lockedAt: { lt: staleBefore } }],
    },
    orderBy: { createdAt: "asc" },
  });
}
