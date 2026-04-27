import { Worker, type Job } from "bullmq";
import { randomUUID } from "crypto";
import { startImageWorker } from "./lib/imageQueue.js";
import { resumeIncompleteStories } from "./lib/resumeStories.js";
import {
  CLAUDE_QUEUE_CONCURRENCY,
  CLAUDE_QUEUE_NAME,
  GEMINI_QUEUE_CONCURRENCY,
  GEMINI_QUEUE_NAME,
  redisConnection,
} from "./lib/queues.js";
import { claimJob, markJobCompleted, markJobFailed } from "./lib/jobs.js";
import { debug } from "./lib/debug.js";

// Worker process entry. Boots all background consumers:
//   1. Existing image-generation queue (story illustrations) — to be
//      replaced by the GenerationJob-driven gemini-tasks pipeline in a
//      later PR.
//   2. New claude-tasks and gemini-tasks queues, backed by GenerationJob
//      rows. Processors are stubs in this PR; the routes that produce
//      these jobs land in PR 4 / PR 5.
//   3. Resume sweep for stories stuck in "illustrating" after a restart.
//
// `bootWorkers()` is exported so the web server can run workers inline
// (single-process mode) when WORKER_INLINE !== "false". Standalone mode
// is `npm run worker`, which calls `bootWorkers()` and never starts an
// HTTP listener.

interface JobEnvelope {
  jobId: string;
}

type ProcessorFn = (
  job: Job<JobEnvelope>,
  workerId: string,
) => Promise<void>;

// Stub processors. Real implementations land in PR 4 / PR 5, which will
// switch on the job's `kind` from the GenerationJob row and dispatch to
// storyText / universeBuild / storyImages / universeImages handlers.
const claudeProcessor: ProcessorFn = async (job, workerId) => {
  const claimed = await claimJob(job.data.jobId, workerId);
  if (!claimed) {
    debug.story(`claude worker: job ${job.data.jobId} already claimed/finished — skipping`);
    return;
  }
  await markJobFailed(
    job.data.jobId,
    `Processor for kind="${claimed.kind}" not yet implemented (PR 3 skeleton).`,
  );
  throw new Error(`No processor registered for claude kind "${claimed.kind}"`);
};

const geminiProcessor: ProcessorFn = async (job, workerId) => {
  const claimed = await claimJob(job.data.jobId, workerId);
  if (!claimed) {
    debug.image(`gemini worker: job ${job.data.jobId} already claimed/finished — skipping`);
    return;
  }
  await markJobFailed(
    job.data.jobId,
    `Processor for kind="${claimed.kind}" not yet implemented (PR 3 skeleton).`,
  );
  throw new Error(`No processor registered for gemini kind "${claimed.kind}"`);
};

let booted = false;

/** Idempotently start every background consumer. Safe to call from both
 * the web process (inline mode) and the standalone worker entry. */
export function bootWorkers(): void {
  if (booted) return;
  booted = true;

  // Existing image queue + resume sweep — preserved during the migration
  // window so single-process deployments keep illustrating stories.
  startImageWorker();
  resumeIncompleteStories().catch((e) => {
    console.error("Failed to resume incomplete stories:", e);
  });

  if (!redisConnection) {
    debug.story("Workers: claude-tasks/gemini-tasks not started (no REDIS_URL)");
    return;
  }

  const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

  const claudeWorker = new Worker<JobEnvelope>(
    CLAUDE_QUEUE_NAME,
    (job) => claudeProcessor(job, workerId),
    { connection: redisConnection, concurrency: CLAUDE_QUEUE_CONCURRENCY },
  );
  claudeWorker.on("failed", (job, err) => {
    debug.error(`claude worker job ${job?.id} failed: ${err.message}`);
    if (job?.data?.jobId) markJobFailed(job.data.jobId, err.message).catch(() => {});
  });

  const geminiWorker = new Worker<JobEnvelope>(
    GEMINI_QUEUE_NAME,
    (job) => geminiProcessor(job, workerId),
    { connection: redisConnection, concurrency: GEMINI_QUEUE_CONCURRENCY },
  );
  geminiWorker.on("failed", (job, err) => {
    debug.error(`gemini worker job ${job?.id} failed: ${err.message}`);
    if (job?.data?.jobId) markJobFailed(job.data.jobId, err.message).catch(() => {});
  });

  // markJobCompleted is wired here for completeness, but the stub
  // processors never reach this branch. Real processors will call it
  // on success.
  void markJobCompleted;

  debug.story(`Workers booted as ${workerId}`);
}

// Standalone entry point: when this file is run directly (npm run worker
// / npm run start:worker), boot workers and stay alive. The web server
// imports `bootWorkers` instead and runs in-process when WORKER_INLINE
// is truthy.
const invokedDirectly =
  process.argv[1] && (
    process.argv[1].endsWith("worker.ts") || process.argv[1].endsWith("worker.js")
  );

if (invokedDirectly) {
  console.log("Storyverse worker process starting");
  bootWorkers();
}
