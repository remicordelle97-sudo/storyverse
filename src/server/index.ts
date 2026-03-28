import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.js";
import universesRouter from "./routes/universes.js";
import charactersRouter from "./routes/characters.js";
import childrenRouter from "./routes/children.js";
import storiesRouter from "./routes/stories.js";
import timelineRouter from "./routes/timeline.js";
import { authMiddleware } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cookieParser());

// Public routes
app.use("/api/auth", authRouter);

// Protected routes
app.use("/api/universes", authMiddleware, universesRouter);
app.use("/api/children", authMiddleware, childrenRouter);
app.use("/api/characters", authMiddleware, charactersRouter);
app.use("/api/stories", authMiddleware, storiesRouter);
app.use("/api/timeline", authMiddleware, timelineRouter);

app.listen(PORT, () => {
  console.log(`Storyverse API running on http://localhost:${PORT}`);
});
