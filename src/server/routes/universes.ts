import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// List all universes for the hardcoded family
router.get("/", async (_req, res) => {
  try {
    const universes = await prisma.universe.findMany({
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
        family: { include: { children: true } },
      },
    });
    if (!universe) {
      return res.status(404).json({ error: "Universe not found" });
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
      familyId,
      name,
      settingDescription,
      themes,
      mood,
      avoidThemes,
      illustrationStyle,
      childName,
      childAge,
      childAgeGroup,
    } = req.body;

    // If no familyId provided, use the first family
    let resolvedFamilyId = familyId;
    if (!resolvedFamilyId) {
      const family = await prisma.family.findFirst();
      if (!family) {
        return res.status(400).json({ error: "No family found" });
      }
      resolvedFamilyId = family.id;
    }

    // Create child if provided
    if (childName && childAge && childAgeGroup) {
      await prisma.child.create({
        data: {
          familyId: resolvedFamilyId,
          name: childName,
          age: childAge,
          ageGroup: childAgeGroup,
        },
      });
    }

    const universe = await prisma.universe.create({
      data: {
        familyId: resolvedFamilyId,
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
