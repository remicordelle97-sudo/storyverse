import { Worker, type Job } from "bullmq";
import { randomUUID } from "crypto";
import {
  CLAUDE_QUEUE_CONCURRENCY,
  CLAUDE_QUEUE_NAME,
  GEMINI_QUEUE_CONCURRENCY,
  GEMINI_QUEUE_NAME,
  JOB_KINDS,
  redisConnection,
} from "./lib/queues.js";
import { claimJob, markJobCompleted, markJobFailed, findResumableJobs } from "./lib/jobs.js";
import { debug } from "./lib/debug.js";
import {
  runStoryTextJob,
  runStoryImagesJob,
  markStoryTextFailed,
  markStoryImagesFailed,
  type StoryTextJobPayload,
  type StoryImagesJobPayload,
} from "./services/storyPipeline.js";
import prisma from "./lib/prisma.js";

// Worker process entry. Boots all background consumers:
//   1. claude-tasks queue → story_text (universe_build lands later).
//   2. gemini-tasks queue → story_images (universe_images lands later).
//   3. Resume sweep: re-enqueues queued / stale-locked GenerationJob
//      rows so a restart doesn't lose work.
//
// `bootWorkers()` is exported so the web server can run workers inline
// (single-process mode) when WORKER_INLINE !== "false". Standalone mode
// is `npm run worker` / `npm run start:worker`, which calls
// `bootWorkers()` and never starts an HTTP listener.

interface JobEnvelope {
  jobId: string;
}

// Stale-lock threshold for the resume sweep. A job whose lockedAt is
// older than this is presumed abandoned (worker crashed) and may be
// reclaimed. Generous because a single illustrated story can take
// several minutes end-to-end.
const STALE_LOCK_MS = 15 * 60 * 1000; // 15 minutes

async function processClaudeJob(job: Job<JobEnvelope>, workerId: string) {
  const claimed = await claimJob(job.data.jobId, workerId);
  if (!claimed) {
    debug.story(`claude worker: job ${job.data.jobId} already claimed/finished — skipping`);
    return;
  }
  const storyId = claimed.storyId ?? undefined;
  try {
    if (claimed.kind === JOB_KINDS.storyText) {
      if (!storyId) throw new Error(`story_text job ${claimed.id} has no storyId`);
      await runStoryTextJob(claimed.id, claimed.payload as unknown as StoryTextJobPayload, storyId);
      await markJobCompleted(claimed.id);
    } else {
      // universe_build lands in a later PR — fail fast so we don't
      // silently swallow an unsupported job.
      throw new Error(`No processor registered for claude kind "${claimed.kind}"`);
    }
  } catch (e: any) {
    debug.error(`claude job ${claimed.id} (${claimed.kind}) failed: ${e.message}`);
    if (claimed.kind === JOB_KINDS.storyText && storyId) {
      await markStoryTextFailed(storyId).catch(() => {});
    }
    await markJobFailed(claimed.id, e.message);
    throw e; // surfaces to BullMQ for its retry bookkeeping
  }
}

async function processGeminiJob(job: Job<JobEnvelope>, workerId: string) {
  const claimed = await claimJob(job.data.jobId, workerId);
  if (!claimed) {
    debug.image(`gemini worker: job ${job.data.jobId} already claimed/finished — skipping`);
    return;
  }
  const storyId = claimed.storyId ?? undefined;
  try {
    if (claimed.kind === JOB_KINDS.storyImages) {
      const payload = claimed.payload as unknown as StoryImagesJobPayload;
      await runStoryImagesJob(claimed.id, payload);
      await markJobCompleted(claimed.id);
    } else {
      throw new Error(`No processor registered for gemini kind "${claimed.kind}"`);
    }
  } catch (e: any) {
    debug.error(`gemini job ${claimed.id} (${claimed.kind}) failed: ${e.message}`);
    if (claimed.kind === JOB_KINDS.storyImages && storyId) {
      await markStoryImagesFailed(storyId).catch(() => {});
    }
    await markJobFailed(claimed.id, e.message);
    throw e;
  }
}

/** Re-enqueue any jobs that are queued or whose lock is stale. Runs
 * once at worker boot so a redeploy doesn't strand work. Without
 * Redis we can't actually re-enqueue (no BullMQ queues), so we
 * fall back to running them in-process. */
async function resumeJobs(workerId: string) {
  const resumable = await findResumableJobs(STALE_LOCK_MS);
  if (resumable.length === 0) return;
  debug.story(`Resume sweep: ${resumable.length} job(s) to recover`);

  for (const row of resumable) {
    debug.story(`Resuming job ${row.id} (${row.kind}, status=${row.status})`);

    if (redisConnection) {
      // With Redis we let the BullMQ worker pick it up. Reset the lock
      // and the BullMQ-side retry budget by re-adding the job; the
      // claim path will set status=running atomically.
      await prisma.generationJob.update({
        where: { id: row.id },
        data: { status: "queued", lockedAt: null, lockedBy: null },
      });
      // Re-enqueue: BullMQ uses the row id as jobId, so adding with the
      // same id is a no-op if it's still in the queue, otherwise it
      // re-creates the BullMQ job. Either way the worker will see it.
      const { claudeQueue, geminiQueue, isClaudeKind, isGeminiKind } = await import("./lib/queues.js");
      const queue = isClaudeKind(row.kind) ? claudeQueue : isGeminiKind(row.kind) ? geminiQueue : null;
      if (queue) {
        await queue.add(row.kind, { jobId: row.id }, { jobId: row.id, attempts: 3 });
      }
    } else {
      // No Redis: run inline so the work doesn't sit forever.
      const claimed = await claimJob(row.id, workerId);
      if (!claimed) continue;
      try {
        if (claimed.kind === JOB_KINDS.storyText && claimed.storyId) {
          await runStoryTextJob(
            claimed.id,
            claimed.payload as unknown as StoryTextJobPayload,
            claimed.storyId,
          );
        } else if (claimed.kind === JOB_KINDS.storyImages) {
          await runStoryImagesJob(claimed.id, claimed.payload as unknown as StoryImagesJobPayload);
        } else {
          throw new Error(`Resume: unsupported kind "${claimed.kind}"`);
        }
        await markJobCompleted(claimed.id);
      } catch (e: any) {
        debug.error(`Resume failed for ${claimed.id}: ${e.message}`);
        if (claimed.kind === JOB_KINDS.storyText && claimed.storyId) {
          await markStoryTextFailed(claimed.storyId).catch(() => {});
        } else if (claimed.kind === JOB_KINDS.storyImages && claimed.storyId) {
          await markStoryImagesFailed(claimed.storyId).catch(() => {});
        }
        await markJobFailed(claimed.id, e.message);
      }
    }
  }
}

let booted = false;

/** Idempotently start every background consumer. Safe to call from both
 * the web process (inline mode) and the standalone worker entry. */
export function bootWorkers(): void {
  if (booted) return;
  booted = true;

  const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

  // No-Redis single-process mode: any "running" job at boot is by
  // definition abandoned (we ARE the only worker). Reset them to
  // queued before the resume sweep runs so they get picked up
  // immediately instead of waiting 15 minutes for the stale-lock
  // threshold. With Redis, BullMQ's own stalled-job recovery handles
  // this — and other worker processes might legitimately be running
  // those jobs — so we only do it in the no-Redis branch.
  const bootStart = redisConnection
    ? Promise.resolve()
    : prisma.generationJob
        .updateMany({
          where: { status: "running" },
          data: { status: "queued", lockedAt: null, lockedBy: null },
        })
        .then((res) => {
          if (res.count > 0) {
            debug.story(`Boot: reclaimed ${res.count} job(s) abandoned by previous process`);
          }
        });

  // Resume sweep is fire-and-forget; we don't want to block boot on it.
  bootStart
    .then(() => resumeJobs(workerId))
    .catch((e) => {
      console.error("Resume sweep failed:", e);
    });

  if (!redisConnection) {
    debug.story("Workers: claude-tasks/gemini-tasks not started (no REDIS_URL); polling DB for new jobs every 2s");
    // Dev fallback: without Redis there's no queue worker, so we
    // poll for queued jobs every 2s. Cheap because jobs are sparse.
    // Production should always have REDIS_URL set.
    setInterval(() => {
      resumeJobs(workerId).catch((e) => {
        debug.error(`Inline poll failed: ${e.message}`);
      });
    }, 2000);
    return;
  }

  const claudeWorker = new Worker<JobEnvelope>(
    CLAUDE_QUEUE_NAME,
    (job) => processClaudeJob(job, workerId),
    { connection: redisConnection, concurrency: CLAUDE_QUEUE_CONCURRENCY },
  );
  claudeWorker.on("failed", (job, err) => {
    debug.error(`claude worker job ${job?.id} failed: ${err.message}`);
  });

  const geminiWorker = new Worker<JobEnvelope>(
    GEMINI_QUEUE_NAME,
    (job) => processGeminiJob(job, workerId),
    { connection: redisConnection, concurrency: GEMINI_QUEUE_CONCURRENCY },
  );
  geminiWorker.on("failed", (job, err) => {
    debug.error(`gemini worker job ${job?.id} failed: ${err.message}`);
  });

  debug.story(`Workers booted as ${workerId}`);
}

const invokedDirectly =
  process.argv[1] && (
    process.argv[1].endsWith("worker.ts") || process.argv[1].endsWith("worker.js")
  );

if (invokedDirectly) {
  console.log("Storyverse worker process starting");
  bootWorkers();
}
