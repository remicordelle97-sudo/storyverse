import { Router } from "express";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { requireAdmin } from "../middleware/auth.js";
import { checkUniverseQuota } from "../lib/quota.js";
import {
  validateUniverseInput,
  createUniversePlaceholder,
  type UniverseBuildJobPayload,
} from "../services/universePipeline.js";
import { createJob } from "../lib/jobs.js";
import { JOB_KINDS } from "../lib/queues.js";
import { verifyUniverseOwnership } from "../lib/ownership.js";
import { deleteUniversesCascade } from "../lib/cascade.js";

const router = Router();

// List preset (template) universes available during onboarding. Any
// authed user can read them — they're meant as ready-made starting
// points. Returns slim shape: name, themes, settingDescription, plus
// hero name + style reference URL for the picker UI.
router.get("/templates", async (_req, res) => {
  try {
    const templates = await prisma.universe.findMany({
      where: { isTemplate: true },
      select: {
        id: true,
        name: true,
        settingDescription: true,
        themes: true,
        styleReferenceUrl: true,
        characters: {
          select: { id: true, name: true, role: true, referenceImageUrl: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    res.json(templates);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

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

// Create a custom universe from the same builder used during onboarding.
// Quota-checked. Returns 202 with { universeId, jobId }; the worker
// runs the Claude build + Gemini image generation in the background
// and the client polls /api/universes/:id/status to track progress.
router.post("/custom", async (req, res) => {
  try {
    const quota = await checkUniverseQuota(req.userId as string);
    if (!quota.allowed) {
      return res.status(403).json({
        error: `You've reached your limit of ${quota.limit} universe${quota.limit === 1 ? "" : "s"}. Upgrade to premium for unlimited universes.`,
      });
    }

    let validated;
    try {
      validated = validateUniverseInput(req.body || {});
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    const universe = await createUniversePlaceholder({
      userId: req.userId as string,
      universeName: validated.universeName,
      themes: validated.themes,
    });

    const job = await createJob({
      kind: JOB_KINDS.universeBuild,
      ownerId: req.userId as string,
      universeId: universe.id,
      payload: { input: req.body } satisfies UniverseBuildJobPayload as any,
    });

    res.status(202).json({ universeId: universe.id, jobId: job.id });
  } catch (e: any) {
    const msg = e?.message || "Failed to create universe";
    debug.error(`Custom universe enqueue failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// Poll-friendly status for the async universe-creation pipeline. Mirrors
// /api/stories/:id/status: returns the Universe.status plus the latest
// GenerationJob's step / progressPercent / lastError.
router.get("/:id/status", async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true,
        userId: true,
        status: true,
        styleReferenceUrl: true,
        characters: { select: { id: true, referenceImageUrl: true } },
      },
    });
    if (!universe) return res.status(404).json({ error: "Universe not found" });

    if (!await verifyUniverseOwnership(universe.id, req.userId as string)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const totalAssets = universe.characters.length + 1; // +1 for style ref
    const assetsReady =
      (universe.styleReferenceUrl ? 1 : 0) +
      universe.characters.filter((c) => c.referenceImageUrl).length;

    const latestJob = await prisma.generationJob.findFirst({
      where: { universeId: universe.id },
      orderBy: { createdAt: "desc" },
      select: { kind: true, status: true, step: true, progressPercent: true, lastError: true },
    });

    res.json({
      status: universe.status,
      assetsReady,
      totalAssets,
      job: latestJob ?? null,
    });
  } catch {
    res.status(500).json({ error: "Failed to check status" });
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

// Toggle preset/template status (admin only). Templates appear in the
// onboarding "use a preset" picker.
router.post("/:id/toggle-template", requireAdmin, async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({
      where: { id: req.params.id as string },
    });
    if (!universe) {
      return res.status(404).json({ error: "Universe not found" });
    }
    const updated = await prisma.universe.update({
      where: { id: universe.id },
      data: { isTemplate: !universe.isTemplate },
    });
    debug.universe(`Universe "${updated.name}" template flag is now ${updated.isTemplate}`);
    res.json({ isTemplate: updated.isTemplate });
  } catch {
    res.status(500).json({ error: "Failed to toggle template status" });
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

    await deleteUniversesCascade([universeId]);

    debug.universe(`Deleted universe "${universe.name}" and all its data`);
    res.json({ ok: true });
  } catch (e: any) {
    debug.error(`Failed to delete universe: ${e.message}`);
    res.status(500).json({ error: "Failed to delete universe" });
  }
});

export default router;
