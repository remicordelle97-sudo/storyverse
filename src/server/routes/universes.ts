import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { requireAdmin } from "../middleware/auth.js";
import { checkUniverseQuota } from "../lib/quota.js";
import { CLAUDE_MODEL, TEMPERATURE_STANDARD, MAX_TOKENS_SMALL } from "../lib/config.js";

const anthropic = new Anthropic();

const router = Router();

// Get universe quota for current user
router.get("/quota", async (req, res) => {
  try {
    const quota = await checkUniverseQuota(req.userId as string);
    res.json(quota);
  } catch {
    res.status(500).json({ error: "Failed to check quota" });
  }
});

// List all universes for the authenticated user + public universes
router.get("/", async (req, res) => {
  try {
    const universes = await prisma.universe.findMany({
      where: {
        OR: [
          { userId: req.userId as string },
          { isPublic: true },
        ],
      },
      include: { characters: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(universes);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch universes" });
  }
});

// Single universe with characters
router.get("/:id", async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({
      where: { id: req.params.id as string },
      include: {
        characters: true,
      },
    });
    if (!universe) {
      return res.status(404).json({ error: "Universe not found" });
    }
    if (universe.userId !== (req.userId as string) && !universe.isPublic) {
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
3-4 sentences that paint a vivid picture of this world. What does it LOOK like? What makes it feel alive and lived-in? Include specific, surprising details. The description should give a child a clear mental picture of where the stories take place.

Return exactly this JSON:
{
  "name": "A unique universe name",
  "settingDescription": "3-4 sentences describing this world vividly"
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
    // Check universe quota
    const quota = await checkUniverseQuota(req.userId as string);
    if (!quota.allowed) {
      return res.status(403).json({ error: `You've reached your limit of ${quota.limit} universe${quota.limit === 1 ? "" : "s"}. Upgrade to premium for unlimited universes.` });
    }

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
        userId: req.userId as string,
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
  } catch (e: any) {
    debug.error(`Universe creation failed: ${e.message}`);
    res.status(500).json({ error: "Failed to create universe" });
  }
});

// Generate style reference image for a universe
router.post("/:id/generate-style-reference", requireAdmin, async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({ where: { id: req.params.id as string } });
    if (!universe) return res.status(404).json({ error: "Universe not found" });
    if (universe.userId !== (req.userId as string)) return res.status(403).json({ error: "Access denied" });

    const { generateStyleReference } = await import("../services/geminiGenerator.js");
    const imageUrl = await generateStyleReference(req.params.id as string);
    res.json({ styleReferenceUrl: imageUrl });
  } catch (e: any) {
    debug.error(`Style reference generation failed: ${e.message}`);
    res.status(500).json({ error: "Failed to generate style reference" });
  }
});

// Toggle public/featured status (admin only)
router.post("/:id/toggle-public", requireAdmin, async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({
      where: { id: req.params.id as string },
    });
    if (!universe) {
      return res.status(404).json({ error: "Universe not found" });
    }

    const updated = await prisma.universe.update({
      where: { id: req.params.id as string },
      data: { isPublic: !universe.isPublic },
    });

    debug.universe(`Universe "${updated.name}" is now ${updated.isPublic ? "public" : "private"}`);
    res.json({ isPublic: updated.isPublic });
  } catch (e) {
    res.status(500).json({ error: "Failed to toggle public status" });
  }
});

// Delete a universe and all its data (admin only)
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const universeId = req.params.id as string;
    const universe = await prisma.universe.findUnique({ where: { id: universeId } });
    if (!universe) {
      return res.status(404).json({ error: "Universe not found" });
    }

    // Delete in order: story characters → scenes → stories → characters → universe
    const stories = await prisma.story.findMany({ where: { universeId }, select: { id: true } });
    const storyIds = stories.map((s) => s.id);

    if (storyIds.length > 0) {
      await prisma.storyCharacter.deleteMany({ where: { storyId: { in: storyIds } } });
      await prisma.scene.deleteMany({ where: { storyId: { in: storyIds } } });
      await prisma.story.deleteMany({ where: { universeId } });
    }

    await prisma.character.deleteMany({ where: { universeId } });
    await prisma.universe.delete({ where: { id: universeId } });

    debug.universe(`Deleted universe "${universe.name}" and all its data`);
    res.json({ ok: true });
  } catch (e: any) {
    debug.error(`Failed to delete universe: ${e.message}`);
    res.status(500).json({ error: "Failed to delete universe" });
  }
});

export default router;
