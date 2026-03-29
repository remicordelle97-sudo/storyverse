import { Router } from "express";
import prisma from "../lib/prisma.js";
import { generateSecondaryCharacters } from "../services/characterGenerator.js";
import { generateCharacterReference } from "../services/imageGenerator.js";

const router = Router();

// List characters for a universe
router.get("/", async (req, res) => {
  try {
    const { universeId } = req.query;
    if (!universeId || typeof universeId !== "string") {
      return res.status(400).json({ error: "universeId query param required" });
    }
    const characters = await prisma.character.findMany({
      where: { universeId },
      include: {
        relationshipsA: { include: { characterB: true } },
        relationshipsB: { include: { characterA: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    res.json(characters);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch characters" });
  }
});

// Create a character (with optional relationship to hero)
router.post("/", async (req, res) => {
  try {
    const {
      universeId,
      name,
      speciesOrType,
      personalityTraits,
      appearance,
      specialDetail,
      role,
      relationshipToHero,
    } = req.body;

    const character = await prisma.character.create({
      data: {
        universeId,
        name,
        speciesOrType,
        personalityTraits:
          typeof personalityTraits === "string"
            ? personalityTraits
            : JSON.stringify(personalityTraits),
        appearance,
        specialDetail: specialDetail || "",
        role: role || "main",
      },
    });

    // If a relationship description is provided, link to the hero
    if (relationshipToHero) {
      const hero = await prisma.character.findFirst({
        where: { universeId, role: "main" },
      });
      if (hero) {
        await prisma.relationship.create({
          data: {
            characterAId: hero.id,
            characterBId: character.id,
            description: relationshipToHero,
          },
        });
      }
    }

    res.status(201).json(character);
  } catch (e) {
    res.status(500).json({ error: "Failed to create character" });
  }
});

// Auto-generate secondary characters for a universe
router.post("/generate", async (req, res) => {
  try {
    const { universeId } = req.body;
    if (!universeId) {
      return res.status(400).json({ error: "universeId is required" });
    }
    await generateSecondaryCharacters(universeId);

    // Generate reference images for all characters in the universe
    const characters = await prisma.character.findMany({
      where: { universeId },
    });
    for (const char of characters) {
      if (!char.referenceImageUrl) {
        try {
          await generateCharacterReference(char.id);
        } catch (e) {
          console.error(`Reference image failed for ${char.name}:`, e);
        }
      }
    }

    const fullCharacters = await prisma.character.findMany({
      where: { universeId },
      include: {
        relationshipsA: { include: { characterB: true } },
        relationshipsB: { include: { characterA: true } },
      },
    });
    res.status(201).json(fullCharacters);
  } catch (e) {
    console.error("Character generation failed:", e);
    res.status(500).json({ error: "Failed to generate characters" });
  }
});

export default router;
