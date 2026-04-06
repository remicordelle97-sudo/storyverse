import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { requireAdmin } from "../middleware/auth.js";
import { generateAllCharacters } from "../services/characterGenerator.js";
import { generateCharacterSheet, generateAllCharacterSheets } from "../services/geminiGenerator.js";
import { verifyUniverseOwnership } from "../lib/ownership.js";

const router = Router();

// List characters for a universe
router.get("/", async (req, res) => {
  try {
    const { universeId } = req.query;
    if (!universeId || typeof universeId !== "string") {
      return res.status(400).json({ error: "universeId query param required" });
    }
    if (!await verifyUniverseOwnership(universeId, req.userId as string)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const characters = await prisma.character.findMany({
      where: { universeId },
      orderBy: { createdAt: "asc" },
    });
    res.json(characters);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch characters" });
  }
});

// Create a character
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
    } = req.body;

    if (!await verifyUniverseOwnership(universeId, req.userId as string)) {
      return res.status(403).json({ error: "Access denied" });
    }

    debug.character("Creating character", { name, speciesOrType: speciesOrType, role, hasOutfit: !!outfit, hasAppearance: !!appearance });

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
    if (!await verifyUniverseOwnership(universeId, req.userId as string)) {
      return res.status(403).json({ error: "Access denied" });
    }
    debug.character("Generating all characters via Claude...", { universeId });
    const startGen = Date.now();
    await generateAllCharacters(universeId);
    debug.character(`All characters generated in ${Date.now() - startGen}ms`);

    // Generate all character sheets in a single multi-turn chat
    // for art style consistency
    await generateAllCharacterSheets(universeId);


    const fullCharacters = await prisma.character.findMany({
      where: { universeId },
    });
    res.status(201).json(fullCharacters);
  } catch (e) {
    console.error("Character generation failed:", e);
    res.status(500).json({ error: "Failed to generate characters" });
  }
});

// Regenerate a character's reference sheet
router.post("/:id/regenerate-sheet", requireAdmin, async (req, res) => {
  try {
    const character = await prisma.character.findUnique({
      where: { id: req.params.id as string },
    });
    if (!character) {
      return res.status(404).json({ error: "Character not found" });
    }
    if (!await verifyUniverseOwnership(character.universeId, req.userId as string)) {
      return res.status(403).json({ error: "Access denied" });
    }

    debug.image(`Regenerating sheet for "${character.name}"`);
    const startTime = Date.now();

    // Clear the old reference
    await prisma.character.update({
      where: { id: req.params.id as string },
      data: { referenceImageUrl: "" },
    });

    const poseCount = parseInt(req.body?.poseCount) || 8;
    const sheetUrl = await generateCharacterSheet(req.params.id as string, poseCount);

    debug.image(`Sheet regenerated for "${character.name}" in ${Date.now() - startTime}ms`);

    res.json({ referenceImageUrl: sheetUrl });
  } catch (e: any) {
    debug.error(`Sheet regeneration failed: ${e.message}`);
    res.status(500).json({ error: "Failed to regenerate character sheet" });
  }
});

// Generate all character sheets via multi-turn chat (style consistent)
router.post("/generate-all-sheets", requireAdmin, async (req, res) => {
  try {
    const { universeId, poseCount } = req.body;
    if (!universeId) {
      return res.status(400).json({ error: "universeId is required" });
    }
    if (!await verifyUniverseOwnership(universeId, req.userId as string)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const poses = parseInt(poseCount) || 8;
    debug.image("Generating all character sheets", { universeId, poses });
    await generateAllCharacterSheets(universeId, poses);
    const characters = await prisma.character.findMany({
      where: { universeId },
    });
    res.json(characters);
  } catch (e: any) {
    debug.error(`All sheets generation failed: ${e.message}`);
    res.status(500).json({ error: "Failed to generate character sheets" });
  }
});

export default router;
