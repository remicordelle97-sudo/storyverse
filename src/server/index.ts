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
import { authMiddleware } from "./middleware/auth.js";
import { bootWorkers } from "./worker.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Stripe webhook needs raw body — must be before express.json()
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

// Bumped to 10mb to fit base64-encoded character photos that flow through
// /api/auth/onboard and /api/universes/custom. The photos are used in
// memory for a single Claude vision call and never persisted.
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Serve generated images
app.use("/images", express.static(path.resolve("public/images")));

// Public routes
app.use("/api/auth", authRouter);
app.use("/api/billing", billingRouter);

// Protected routes
app.use("/api/universes", authMiddleware, universesRouter);
app.use("/api/characters", authMiddleware, charactersRouter);
app.use("/api/stories", authMiddleware, storiesRouter);
app.use("/api/admin", authMiddleware, adminRouter);
app.use("/api/print", authMiddleware, printRouter);

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
