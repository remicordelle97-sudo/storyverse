import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { generateLocationConcepts } from "../services/locationGenerator.js";
import { generateLocationSheet } from "../services/geminiGenerator.js";
import { verifyUniverseOwnership } from "../lib/ownership.js";

const router = Router();

// List locations for a universe
router.get("/", async (req, res) => {
  try {
    const { universeId } = req.query;
    if (!universeId || typeof universeId !== "string") {
      return res.status(400).json({ error: "universeId query param required" });
    }
    if (!await verifyUniverseOwnership(universeId, req.userId!)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const locations = await prisma.location.findMany({
      where: { universeId },
      orderBy: { createdAt: "asc" },
    });
    res.json(locations);
  } catch {
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});

// Auto-generate location concepts for a universe
router.post("/generate", async (req, res) => {
  try {
    const { universeId } = req.body;
    if (!universeId) {
      return res.status(400).json({ error: "universeId is required" });
    }
    if (!await verifyUniverseOwnership(universeId, req.userId!)) {
      return res.status(403).json({ error: "Access denied" });
    }

    debug.universe("Generating locations for universe", { universeId });
    const startTime = Date.now();
    await generateLocationConcepts(universeId);
    debug.universe(`Locations generated in ${Date.now() - startTime}ms`);

    const locations = await prisma.location.findMany({
      where: { universeId },
      orderBy: { createdAt: "asc" },
    });
    res.status(201).json(locations);
  } catch (e: any) {
    debug.error(`Location generation failed: ${e.message}`);
    res.status(500).json({ error: "Failed to generate locations" });
  }
});

// Generate or regenerate a location's reference sheet
router.post("/:id/generate-sheet", async (req, res) => {
  try {
    const location = await prisma.location.findUnique({
      where: { id: req.params.id },
      include: { universe: true },
    });
    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }
    if (location.universe.userId !== req.userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Gather existing sheets (characters + other locations) for style reference
    const characters = await prisma.character.findMany({
      where: { universeId: location.universeId, referenceImageUrl: { not: "" } },
    });
    const otherLocations = await prisma.location.findMany({
      where: {
        universeId: location.universeId,
        id: { not: location.id },
        referenceImageUrl: { not: "" },
      },
    });

    const previousSheetUrls = [
      ...characters.map((c) => c.referenceImageUrl),
      ...otherLocations.map((l) => l.referenceImageUrl),
    ];

    // Clear old sheet
    await prisma.location.update({
      where: { id: req.params.id },
      data: { referenceImageUrl: "" },
    });

    const sheetUrl = await generateLocationSheet(req.params.id, previousSheetUrls);
    res.json({ referenceImageUrl: sheetUrl });
  } catch (e: any) {
    debug.error(`Location sheet generation failed: ${e.message}`);
    res.status(500).json({ error: "Failed to generate location sheet" });
  }
});

export default router;
