import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import authRouter from "./routes/auth.js";
import universesRouter from "./routes/universes.js";
import charactersRouter from "./routes/characters.js";
import storiesRouter from "./routes/stories.js";
import locationsRouter from "./routes/locations.js";
import { authMiddleware } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cookieParser());

// Serve generated images
app.use("/images", express.static(path.resolve("public/images")));

// Public routes
app.use("/api/auth", authRouter);

// Protected routes
app.use("/api/universes", authMiddleware, universesRouter);
app.use("/api/characters", authMiddleware, charactersRouter);
app.use("/api/stories", authMiddleware, storiesRouter);
app.use("/api/locations", authMiddleware, locationsRouter);

// In production, serve the built React app
const clientDist = path.resolve("dist/client");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Storyverse running on http://localhost:${PORT}`);
});
