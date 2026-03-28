import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// List children for the authenticated user's family
router.get("/", async (req, res) => {
  try {
    if (!req.familyId) {
      return res.json([]);
    }
    const children = await prisma.child.findMany({
      where: { familyId: req.familyId },
      orderBy: { name: "asc" },
    });
    res.json(children);
  } catch {
    res.status(500).json({ error: "Failed to fetch children" });
  }
});

// Add a child
router.post("/", async (req, res) => {
  try {
    if (!req.familyId) {
      return res.status(400).json({ error: "Set up your family first" });
    }
    const { name, age, ageGroup } = req.body;
    if (!name || !age || !ageGroup) {
      return res.status(400).json({ error: "name, age, and ageGroup are required" });
    }
    const child = await prisma.child.create({
      data: { familyId: req.familyId, name, age, ageGroup },
    });
    res.status(201).json(child);
  } catch {
    res.status(500).json({ error: "Failed to create child" });
  }
});

// Update a child
router.put("/:id", async (req, res) => {
  try {
    const child = await prisma.child.findUnique({ where: { id: req.params.id } });
    if (!child || child.familyId !== req.familyId) {
      return res.status(404).json({ error: "Child not found" });
    }
    const { name, age, ageGroup } = req.body;
    const updated = await prisma.child.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(age !== undefined && { age }),
        ...(ageGroup !== undefined && { ageGroup }),
      },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update child" });
  }
});

// Delete a child
router.delete("/:id", async (req, res) => {
  try {
    const child = await prisma.child.findUnique({ where: { id: req.params.id } });
    if (!child || child.familyId !== req.familyId) {
      return res.status(404).json({ error: "Child not found" });
    }
    await prisma.child.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete child" });
  }
});

export default router;
