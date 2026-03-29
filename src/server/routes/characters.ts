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
      outfit,
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
        outfit: outfit || "",
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

    // Generate multi-pose character model sheets, chained so each
    // character sees the previous sheets and matches the art style
    const characters = await prisma.character.findMany({
      where: { universeId },
      orderBy: { role: "asc" }, // "main" first, then "supporting"
    });
    debug.character(`Found ${characters.length} characters, generating model sheets (chained)...`);

    const completedSheetUrls: string[] = [];

    for (const char of characters) {
      if (!char.referenceImageUrl) {
        try {
          debug.image(`Generating model sheet for "${char.name}" (with ${completedSheetUrls.length} previous sheets as style reference)...`);
          const startImg = Date.now();
          const sheetUrl = await generateCharacterReference(char.id, completedSheetUrls);
          completedSheetUrls.push(sheetUrl);
          debug.image(`Model sheet for "${char.name}" done in ${Date.now() - startImg}ms`);
        } catch (e: any) {
          debug.error(`Model sheet failed for "${char.name}": ${e.message}`);
        }
      } else {
        debug.image(`"${char.name}" already has model sheet, using as reference`);
        completedSheetUrls.push(char.referenceImageUrl);
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

// Regenerate a character's reference sheet
router.post("/:id/regenerate-sheet", async (req, res) => {
  try {
    const character = await prisma.character.findUnique({
      where: { id: req.params.id },
    });
    if (!character) {
      return res.status(404).json({ error: "Character not found" });
    }

    // Get previously generated sheets from other characters in the same universe
    // to maintain style consistency
    const otherCharacters = await prisma.character.findMany({
      where: {
        universeId: character.universeId,
        id: { not: character.id },
        referenceImageUrl: { not: "" },
      },
    });
    const previousSheetUrls = otherCharacters.map((c) => c.referenceImageUrl);

    debug.image(`Regenerating sheet for "${character.name}" (with ${previousSheetUrls.length} style references)`);
    const startTime = Date.now();

    // Clear the old reference
    await prisma.character.update({
      where: { id: req.params.id },
      data: { referenceImageUrl: "" },
    });

    const sheetUrl = await generateCharacterReference(req.params.id, previousSheetUrls);

    debug.image(`Sheet regenerated for "${character.name}" in ${Date.now() - startTime}ms`);

    res.json({ referenceImageUrl: sheetUrl });
  } catch (e: any) {
    debug.error(`Sheet regeneration failed: ${e.message}`);
    res.status(500).json({ error: "Failed to regenerate character sheet" });
  }
});

export default router;
