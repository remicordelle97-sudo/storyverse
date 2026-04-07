import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import authRouter from "./routes/auth.js";
import billingRouter from "./routes/billing.js";
import universesRouter from "./routes/universes.js";
import charactersRouter from "./routes/characters.js";
import storiesRouter from "./routes/stories.js";
import locationsRouter from "./routes/locations.js";
import adminRouter from "./routes/admin.js";
import { authMiddleware } from "./middleware/auth.js";
import { resumeIncompleteStories } from "./lib/resumeStories.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Stripe webhook needs raw body — must be before express.json()
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
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
app.use("/api/locations", authMiddleware, locationsRouter);
app.use("/api/admin", authMiddleware, adminRouter);

// In production, serve the built React app
const clientDist = path.resolve("dist/client");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Storyverse running on http://localhost:${PORT}`);
  // Resume any stories that were mid-illustration when the server restarted
  resumeIncompleteStories().catch((e) => {
    console.error("Failed to resume incomplete stories:", e);
  });
});
