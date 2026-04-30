import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import authRouter from "./routes/auth.js";
import billingRouter from "./routes/billing.js";
import universesRouter from "./routes/universes.js";
import charactersRouter from "./routes/characters.js";
import storiesRouter from "./routes/stories.js";
import adminRouter from "./routes/admin.js";
import printRouter from "./routes/print.js";
import luluWebhookRouter from "./routes/luluWebhook.js";
import uploadsRouter from "./routes/uploads.js";
import { authMiddleware } from "./middleware/auth.js";
import { httpLatencyMiddleware } from "./middleware/httpLatency.js";
import { bootWorkers } from "./worker.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Webhooks that verify signatures need the raw request body; they
// must be mounted before express.json() so the JSON parser doesn't
// consume the stream first. The Lulu webhook router carries its own
// raw() middleware so we mount it directly here.
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use("/api/print/lulu-webhook", luluWebhookRouter);

// Photos no longer ride inside the JSON body — the universe builder
// uploads them directly to R2 via /api/uploads/photo-url and submits
// only the resulting key. 1MB is a generous ceiling for what's left
// (story-builder requests, status polls, admin actions).
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Serve generated images
app.use("/images", express.static(path.resolve("public/images")));

// Latency middleware — captures every /api/* request after body parsing
// so we can expose per-route p50/p95/p99 from /api/admin/metrics. The
// recorded duration is the time spent in our handlers, not in body
// parsing or static serving.
app.use("/api", httpLatencyMiddleware);

// Public routes
app.use("/api/auth", authRouter);
app.use("/api/billing", billingRouter);

// Protected routes
app.use("/api/universes", authMiddleware, universesRouter);
app.use("/api/characters", authMiddleware, charactersRouter);
app.use("/api/stories", authMiddleware, storiesRouter);
app.use("/api/admin", authMiddleware, adminRouter);
app.use("/api/print", authMiddleware, printRouter);
app.use("/api/uploads", authMiddleware, uploadsRouter);

// In production, serve the built React app
const clientDist = path.resolve("dist/client");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Storyverse running on http://localhost:${PORT}`);

  // Run background workers in the same process by default. Set
  // WORKER_INLINE=false on the web service once a separate worker
  // service is provisioned (then run `npm run start:worker` there).
  if (process.env.WORKER_INLINE !== "false") {
    bootWorkers();
  } else {
    console.log("WORKER_INLINE=false — skipping in-process workers (expect a standalone worker service)");
  }
});
