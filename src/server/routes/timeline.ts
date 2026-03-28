import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// List timeline events for a universe
router.get("/", async (req, res) => {
  try {
    const { universeId } = req.query;
    if (!universeId || typeof universeId !== "string") {
      return res.status(400).json({ error: "universeId query param required" });
    }
    const events = await prisma.timelineEvent.findMany({
      where: { universeId },
      include: { character: true, story: true },
      orderBy: { storyDate: "desc" },
    });
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch timeline events" });
  }
});

export default router;
