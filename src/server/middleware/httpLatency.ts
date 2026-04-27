import type { Request, Response, NextFunction } from "express";

// Lightweight in-memory request-latency recorder. Stores the last
// MAX_SAMPLES requests in a ring buffer; the metrics endpoint
// computes percentiles and per-route averages on demand.
//
// In-memory only by design — restarts wipe the buffer. For longer
// retention point Prometheus / Datadog at the metrics endpoint and
// scrape periodically. The buffer is sized so a single instance
// at ~10 req/s keeps roughly an hour of history.

interface Sample {
  // Pattern, not the URL — `/api/stories/:id` not `/api/stories/abc`.
  // Falls back to the URL path if no route matched.
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
}

const MAX_SAMPLES = 5000;
const ring: Sample[] = [];
let writeIndex = 0;

function record(sample: Sample) {
  if (ring.length < MAX_SAMPLES) {
    ring.push(sample);
  } else {
    ring[writeIndex] = sample;
    writeIndex = (writeIndex + 1) % MAX_SAMPLES;
  }
}

/** Express middleware: capture wall-clock duration of every request
 * and bucket by route pattern. Insert this BEFORE the route handlers
 * but AFTER body parsing so request parsing isn't counted as latency
 * we own. */
export function httpLatencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    // req.route?.path is the express route pattern (e.g. "/:id/status").
    // baseUrl is the mount path (e.g. "/api/stories"). Joining gives
    // a stable key per route regardless of dynamic segments.
    const pattern =
      req.route?.path
        ? `${req.baseUrl}${req.route.path}`
        : req.path;
    record({
      route: pattern,
      method: req.method,
      statusCode: res.statusCode,
      durationMs,
      timestamp: Date.now(),
    });
  });
  next();
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Snapshot the current latency buffer aggregated by route. Used by
 * the admin metrics endpoint. */
export function snapshotLatency(): {
  totalSamples: number;
  windowSeconds: number;
  routes: Array<{
    route: string;
    method: string;
    count: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    errorCount: number;
  }>;
} {
  if (ring.length === 0) {
    return { totalSamples: 0, windowSeconds: 0, routes: [] };
  }
  const oldest = Math.min(...ring.map((s) => s.timestamp));
  const windowSeconds = Math.round((Date.now() - oldest) / 1000);

  const buckets = new Map<string, Sample[]>();
  for (const s of ring) {
    const key = `${s.method} ${s.route}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(s);
    buckets.set(key, bucket);
  }

  const routes = [...buckets.entries()].map(([key, samples]) => {
    const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
    const sum = durations.reduce((acc, d) => acc + d, 0);
    const errorCount = samples.filter((s) => s.statusCode >= 500).length;
    return {
      route: key.split(" ").slice(1).join(" "),
      method: key.split(" ")[0],
      count: samples.length,
      avgMs: Math.round((sum / samples.length) * 100) / 100,
      p50Ms: Math.round(quantile(durations, 0.5) * 100) / 100,
      p95Ms: Math.round(quantile(durations, 0.95) * 100) / 100,
      p99Ms: Math.round(quantile(durations, 0.99) * 100) / 100,
      errorCount,
    };
  });

  routes.sort((a, b) => b.count - a.count);
  return { totalSamples: ring.length, windowSeconds, routes };
}
