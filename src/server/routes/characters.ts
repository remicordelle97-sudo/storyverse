import { Router } from "express";
import prisma from "../lib/prisma.js";

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

// Create a character
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
    res.status(201).json(character);
  } catch (e) {
    res.status(500).json({ error: "Failed to create character" });
  }
});

export default router;
