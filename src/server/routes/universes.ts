import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// List all universes for the authenticated user
router.get("/", async (req, res) => {
  try {
    const universes = await prisma.universe.findMany({
      where: { userId: req.userId },
      include: { characters: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(universes);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch universes" });
  }
});

// Single universe with characters and recent timeline
router.get("/:id", async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({
      where: { id: req.params.id },
      include: {
        characters: {
          include: {
            relationshipsA: { include: { characterB: true } },
            relationshipsB: { include: { characterA: true } },
          },
        },
        timelineEvents: {
          orderBy: { storyDate: "desc" },
          take: 20,
          include: { character: true },
        },
      },
    });
    if (!universe) {
      return res.status(404).json({ error: "Universe not found" });
    }
    if (universe.userId !== req.userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.json(universe);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch universe" });
  }
});

// Create universe
router.post("/", async (req, res) => {
  try {
    const {
      name,
      settingDescription,
      themes,
      mood,
      avoidThemes,
      illustrationStyle,
    } = req.body;

    const universe = await prisma.universe.create({
      data: {
        userId: req.userId!,
        name,
        settingDescription,
        themes: typeof themes === "string" ? themes : JSON.stringify(themes),
        mood,
        avoidThemes: avoidThemes || "",
        illustrationStyle: illustrationStyle || "storybook",
      },
      include: { characters: true },
    });
    res.status(201).json(universe);
  } catch (e) {
    res.status(500).json({ error: "Failed to create universe" });
  }
});

export default router;
