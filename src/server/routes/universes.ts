import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";

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

    debug.universe("Creating universe", { name, mood, themes: typeof themes === "string" ? themes : JSON.stringify(themes) });

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

    debug.universe("Universe created", { id: universe.id, name: universe.name });
    res.status(201).json(universe);
  } catch (e) {
    res.status(500).json({ error: "Failed to create universe" });
  }
});

// Check LoRA training status for a universe
router.get("/:id/lora-status", async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({
      where: { id: req.params.id },
    });
    if (!universe) {
      return res.status(404).json({ error: "Universe not found" });
    }

    const style = universe.illustrationStyle || "";

    if (style.startsWith("lora:")) {
      res.json({ status: "ready", model: style.slice(5) });
    } else if (style.startsWith("lora-training:")) {
      // Check with Replicate for current status
      const parts = style.split(":");
      const trainingId = parts[2];
      let replicateStatus = "processing";

      if (trainingId) {
        try {
          const Replicate = (await import("replicate")).default;
          const replicate = new Replicate();
          const training = await replicate.trainings.get(trainingId);
          replicateStatus = training.status;

          if (training.status === "succeeded") {
            const destination = parts[1];
            await prisma.universe.update({
              where: { id: req.params.id },
              data: { illustrationStyle: `lora:${destination}` },
            });
            return res.json({ status: "ready", model: destination });
          } else if (training.status === "failed" || training.status === "canceled") {
            await prisma.universe.update({
              where: { id: req.params.id },
              data: { illustrationStyle: "storybook" },
            });
            return res.json({ status: "failed" });
          }
        } catch {
          // Can't reach Replicate, report as still training
        }
      }

      res.json({ status: "training", replicateStatus });
    } else {
      res.json({ status: "none" });
    }
  } catch {
    res.status(500).json({ error: "Failed to check LoRA status" });
  }
});

export default router;
