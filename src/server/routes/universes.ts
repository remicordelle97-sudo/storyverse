import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { requireAdmin } from "../middleware/auth.js";
import { CLAUDE_MODEL, TEMPERATURE_STANDARD, MAX_TOKENS_SMALL } from "../lib/config.js";

const anthropic = new Anthropic();

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

// Single universe with characters and locations
router.get("/:id", async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({
      where: { id: req.params.id },
      include: {
        characters: true,
        locations: {
          orderBy: { createdAt: "asc" },
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

// Generate a unique universe concept (name and description only)
router.post("/generate-concept", async (req, res) => {
  try {
    const { interests } = req.body;

    debug.universe("Generating universe concept via Claude", { interests });

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS_SMALL,
      temperature: TEMPERATURE_STANDARD,
      system: "You create unique, imaginative worlds for children's stories. These worlds need to be rich enough to support hundreds of stories. Return ONLY valid JSON. No markdown fences.",
      messages: [
        {
          role: "user",
          content: `Create a unique children's story universe based on these interests:

INTERESTS: ${JSON.stringify(interests)}

=== UNIVERSE NAME ===
Generate a creative, evocative name. Vary your naming style — try different approaches like made-up words ("Plonkton"), unexpected combinations ("Pocketwatch Bay"), onomatopoeia ("Tiktokka"), place-sounding names ("Little Dundry"), or single evocative words ("Brambles").

=== SETTING DESCRIPTION ===
2-3 sentences that paint a vivid picture of this world. What does it LOOK like? Include specific, surprising details that make it feel alive and lived-in.

=== SENSORY DETAILS ===
What does this world SOUND like? SMELL like? FEEL like? Give 2-3 specific sensory details beyond visuals that make a child feel immersed. (e.g., "The air always tastes faintly of cinnamon near the bakery tree", "The ground hums gently underfoot when the big gears turn below", "Everything has a soft mossy texture, even the buildings")

=== WORLD RULES ===
Every great children's world has 1-2 unique rules or mechanics that make it special — things that are true in THIS world but not in ours. These create built-in story hooks. (e.g., "When someone tells a lie, their shadow turns a different color", "Every animal discovers their one special talent on their Bloom Day", "The weather changes based on what the oldest tree is dreaming about"). Rules should be simple enough for a 4-year-old to understand and exciting enough to build stories around.

=== SCALE & GEOGRAPHY ===
How big is this world? What are its boundaries? Give children a mental map. (e.g., "The whole world fits inside a single hollow oak tree — each branch is a different neighborhood", "A cluster of seven tiny islands connected by rope bridges, surrounded by an endless warm sea", "A valley between two mountains, small enough to walk across in a morning but full of hidden paths"). Include 2-3 landmark types that define the geography.

Return exactly this JSON:
{
  "name": "A unique universe name",
  "settingDescription": "2-3 sentences describing what this world looks like",
  "sensoryDetails": "2-3 specific non-visual sensory details (sounds, smells, textures)",
  "worldRules": "1-2 unique rules or mechanics that make this world special",
  "scaleAndGeography": "The size, boundaries, and key landmark types of this world"
}`,
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from AI");
    }

    let raw = textBlock.text.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const concept = JSON.parse(raw);
    debug.universe("Universe concept generated", { name: concept.name });

    res.json(concept);
  } catch (e: any) {
    debug.error(`Universe concept generation failed: ${e.message}`);
    res.status(500).json({ error: "Failed to generate universe concept" });
  }
});

// Create universe
router.post("/", async (req, res) => {
  try {
    const {
      name,
      settingDescription,
      sensoryDetails,
      worldRules,
      scaleAndGeography,
      themes,
      avoidThemes,
      illustrationStyle,
    } = req.body;

    debug.universe("Creating universe", { name, themes: typeof themes === "string" ? themes : JSON.stringify(themes) });

    const universe = await prisma.universe.create({
      data: {
        userId: req.userId!,
        name,
        settingDescription,
        sensoryDetails: sensoryDetails || "",
        worldRules: worldRules || "",
        scaleAndGeography: scaleAndGeography || "",
        themes: typeof themes === "string" ? themes : JSON.stringify(themes),
        avoidThemes: avoidThemes || "",
        illustrationStyle: illustrationStyle || "storybook",
      },
      include: { characters: true },
    });

    debug.universe("Universe created", { id: universe.id, name: universe.name });
    res.status(201).json(universe);
  } catch (e: any) {
    debug.error(`Universe creation failed: ${e.message}`);
    res.status(500).json({ error: "Failed to create universe" });
  }
});

// Generate style reference image for a universe
router.post("/:id/generate-style-reference", requireAdmin, async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({ where: { id: req.params.id } });
    if (!universe) return res.status(404).json({ error: "Universe not found" });
    if (universe.userId !== req.userId) return res.status(403).json({ error: "Access denied" });

    const { generateStyleReference } = await import("../services/geminiGenerator.js");
    const imageUrl = await generateStyleReference(req.params.id);
    res.json({ styleReferenceUrl: imageUrl });
  } catch (e: any) {
    debug.error(`Style reference generation failed: ${e.message}`);
    res.status(500).json({ error: "Failed to generate style reference" });
  }
});

export default router;
