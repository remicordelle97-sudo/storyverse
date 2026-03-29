import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { generateSecondaryCharacters } from "../services/characterGenerator.js";
import { generateCharacterReference } from "../services/imageGenerator.js";
import { trainUniverseLora } from "../services/fluxGenerator.js";

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
    const { universeId, trainLora } = req.body;
    if (!universeId) {
      return res.status(400).json({ error: "universeId is required" });
    }
    debug.character("Generating secondary characters via Claude...", { universeId });
    const startGen = Date.now();
    await generateSecondaryCharacters(universeId);
    debug.character(`Secondary characters generated in ${Date.now() - startGen}ms`);

    // Generate reference images for all characters in the universe
    const characters = await prisma.character.findMany({
      where: { universeId },
    });
    debug.character(`Found ${characters.length} characters, generating reference images...`);

    for (const char of characters) {
      if (!char.referenceImageUrl) {
        try {
          debug.image(`Generating reference sheet for "${char.name}"...`);
          const startImg = Date.now();
          await generateCharacterReference(char.id);
          debug.image(`Reference sheet for "${char.name}" done in ${Date.now() - startImg}ms`);
        } catch (e: any) {
          debug.error(`Reference image failed for "${char.name}": ${e.message}`);
        }
      } else {
        debug.image(`"${char.name}" already has reference image, skipping`);
      }
    }

    // Train a LoRA if requested
    if (trainLora) {
      const replicateOwner = process.env.REPLICATE_OWNER;
      if (replicateOwner) {
        try {
          debug.lora("Starting LoRA training...", { universeId, replicateOwner });
          const modelId = await trainUniverseLora(universeId, replicateOwner);
          debug.lora("LoRA training started", { modelId });
        } catch (e: any) {
          debug.error(`LoRA training failed: ${e.message}`);
        }
      } else {
        debug.error("LoRA training requested but REPLICATE_OWNER not set in .env");
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

// Train a LoRA model for a universe's characters
router.post("/train-lora", async (req, res) => {
  try {
    const { universeId, replicateOwner } = req.body;
    if (!universeId || !replicateOwner) {
      return res.status(400).json({
        error: "universeId and replicateOwner are required",
      });
    }
    const modelId = await trainUniverseLora(universeId, replicateOwner);
    res.status(201).json({ modelId, status: "training_started" });
  } catch (e: any) {
    console.error("LoRA training failed:", e);
    res.status(500).json({ error: e.message || "Failed to start LoRA training" });
  }
});

export default router;
