import express from "express";
import universesRouter from "./routes/universes.js";
import charactersRouter from "./routes/characters.js";
import storiesRouter from "./routes/stories.js";
import timelineRouter from "./routes/timeline.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.use("/api/universes", universesRouter);
app.use("/api/characters", charactersRouter);
app.use("/api/stories", storiesRouter);
app.use("/api/timeline", timelineRouter);

app.listen(PORT, () => {
  console.log(`Storyverse API running on http://localhost:${PORT}`);
});
