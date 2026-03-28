import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// List all universes for the authenticated user's family
router.get("/", async (req, res) => {
  try {
    if (!req.familyId) {
      return res.json([]);
    }
    const universes = await prisma.universe.findMany({
      where: { familyId: req.familyId },
      include: { characters: true, child: true },
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
        child: true,
        family: { include: { children: true } },
      },
    });
    if (!universe) {
      return res.status(404).json({ error: "Universe not found" });
    }
    if (universe.familyId !== req.familyId) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.json(universe);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch universe" });
  }
});

// Create universe (used by onboarding)
router.post("/", async (req, res) => {
  try {
    const {
      name,
      settingDescription,
      themes,
      mood,
      avoidThemes,
      illustrationStyle,
      childId,
      childName,
      childAge,
      childAgeGroup,
    } = req.body;

    if (!req.familyId) {
      return res.status(400).json({ error: "Set up your family first" });
    }

    // Create child if provided and no childId given
    let resolvedChildId = childId;
    if (!resolvedChildId && childName && childAge && childAgeGroup) {
      const child = await prisma.child.create({
        data: {
          familyId: req.familyId,
          name: childName,
          age: childAge,
          ageGroup: childAgeGroup,
        },
      });
      resolvedChildId = child.id;
    }

    const universe = await prisma.universe.create({
      data: {
        familyId: req.familyId,
        childId: resolvedChildId || null,
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
