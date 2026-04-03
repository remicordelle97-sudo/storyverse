import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";

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

// Generate a unique universe concept (name, description, hero species)
router.post("/generate-concept", async (req, res) => {
  try {
    const { interests, heroName } = req.body;

    debug.universe("Generating universe concept via Claude", { interests, heroName });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      temperature: 0.75,
      system: "You create unique, imaginative worlds for children's stories. Return ONLY valid JSON. No markdown fences.",
      messages: [
        {
          role: "user",
          content: `Create a unique children's story universe based on these inputs:

INTERESTS: ${JSON.stringify(interests)}
HERO NAME: ${heroName}

Generate a creative, evocative universe name and a rich setting description. The name should be unique and memorable, not generic (avoid "The [Adjective] [Noun]" patterns every time — be creative with the naming).

The setting description should be 2-3 sentences that paint a vivid picture of this world: what it looks, sounds, and feels like. Include specific, surprising details that make it feel alive.

Also suggest what species or type the hero "${heroName}" could be, based on the interests and world.

Generate a COMPLETE VISUAL SPECIFICATION for the hero's appearance — detailed enough for an illustrator to draw the character identically across 50 different images. Include ALL of the following:
- BODY: shape, size, posture, primary color
- HEAD: shape, size relative to body, color
- EYES: count, shape, size, color, pupil style
- NOSE/MOUTH/BEAK/SNOUT: type, shape, color
- EARS: count, shape, size, position (or "none")
- ARMS: count, length, thickness, color, what's at the end (hands/paws/claws, finger count)
- LEGS: count, length, thickness, color, what's at the end (feet/hooves/claws)
- WINGS: count, size, shape, color, transparency, attachment point (or "none")
- TAIL: length, shape, color (or "none")
- ANTENNAE/HORNS: count, shape, length (or "none")
- MARKINGS: stripes, spots, patterns, locations on body
- CLOTHING: what they always wear
Be SPECIFIC with numbers: "2 large translucent teal wings" not just "wings".
If the character has WHISKERS, specify: count per side, length, color.

Also generate the hero's OUTFIT separately — everything they wear, carry, or have on them. List each item with its EXACT color as a hex code. Format as a bulleted list starting with "ALWAYS WEARS AND CARRIES (never remove any item):".

Generate the hero's CHARACTER DEPTH:
- "heroDominantTrait": The ONE trait that defines this hero above all others. Not a list — one single word or short phrase. (e.g., "recklessly brave", "uncontrollably curious", "stubbornly optimistic")
- "heroPersonalWant": A small, specific, ongoing desire the hero has — something personal that drives them beyond any single story. (e.g., "Wants to climb to the very top of the tallest tree in the forest", "Dreams of finding the legendary golden shell")
- "heroSignatureBehavior": One specific, repeatable action or verbal habit that children can anticipate and join in on. Should appear in EVERY story. (e.g., "Always sniffs the air three times before entering a new place", "Says 'let's GO!' while jumping with both feet")

Return exactly this JSON:
{
  "name": "A unique universe name",
  "settingDescription": "2-3 sentences describing this world vividly",
  "heroSpecies": "The suggested species or type for the hero",
  "heroAppearance": "Complete BODY-ONLY visual specification (no clothing)",
  "heroOutfit": "ALWAYS WEARS AND CARRIES (never remove any item):\\n- #hexcode color item description\\n- #hexcode color item description",
  "heroDominantTrait": "one defining trait",
  "heroPersonalWant": "a specific ongoing desire",
  "heroSignatureBehavior": "a repeatable action or verbal habit"
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
    debug.universe("Universe concept generated", {
      name: concept.name,
      heroSpecies: concept.heroSpecies,
    });

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
        themes: typeof themes === "string" ? themes : JSON.stringify(themes),
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

export default router;
