import { Router } from "express";
import prisma from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { requireAdmin } from "../middleware/auth.js";
import { debug } from "../lib/debug.js";

const router = Router();

// All routes require admin
router.use(requireAdmin);

// GET /api/admin/users — list all users with universe/story counts
router.get("/users", async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        picture: true,
        role: true,
        plan: true,
        createdAt: true,
        _count: {
          select: {
            universes: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get story counts per user (stories chain through universe)
    const storyCounts = await prisma.story.groupBy({
      by: ["universeId"],
      _count: { id: true },
    });

    // Map universe -> userId
    const universes = await prisma.universe.findMany({
      select: { id: true, userId: true },
    });
    const universeOwner = new Map(universes.map((u) => [u.id, u.userId]));

    const userStoryCounts = new Map<string, number>();
    for (const sc of storyCounts) {
      const userId = universeOwner.get(sc.universeId);
      if (userId) {
        userStoryCounts.set(userId, (userStoryCounts.get(userId) || 0) + sc._count.id);
      }
    }

    const result = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      picture: u.picture,
      role: u.role,
      plan: u.plan,
      createdAt: u.createdAt,
      universeCount: u._count.universes,
      storyCount: userStoryCounts.get(u.id) || 0,
    }));

    res.json(result);
  } catch (e) {
    debug.error("Failed to fetch admin users", { error: String(e) });
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// POST /api/admin/impersonate/:userId — get an access token for the target user
router.post("/impersonate/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.userId;

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    debug.story("Admin impersonation", {
      adminId: adminId || "unknown",
      targetUserId: targetUser.id,
      targetEmail: targetUser.email,
    });

    const accessToken = signAccessToken(targetUser.id, null, adminId as string);

    res.json({
      accessToken,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        picture: targetUser.picture,
        role: targetUser.role,
        plan: targetUser.plan,
      },
    });
  } catch (e) {
    debug.error("Impersonation failed", { error: String(e) });
    res.status(500).json({ error: "Impersonation failed" });
  }
});

// GET /api/admin/universes — all universes (for template management)
router.get("/universes", async (_req, res) => {
  try {
    const universes = await prisma.universe.findMany({
      select: {
        id: true,
        name: true,
        settingDescription: true,
        isPublic: true,
        isTemplate: true,
        styleReferenceUrl: true,
        createdAt: true,
        user: { select: { email: true } },
        _count: { select: { characters: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(universes);
  } catch (e) {
    debug.error("Failed to fetch admin universes", { error: String(e) });
    res.status(500).json({ error: "Failed to fetch universes" });
  }
});

// POST /api/admin/users/:userId/reset — wipe a user's stories, characters,
// and universes and re-arm the onboarding flow so they pick a template
// again on their next login.
router.post("/users/:userId/reset", async (req, res) => {
  try {
    const { userId } = req.params;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    const universes = await prisma.universe.findMany({
      where: { userId },
      select: { id: true },
    });
    const universeIds = universes.map((u) => u.id);

    const stories = await prisma.story.findMany({
      where: { universeId: { in: universeIds } },
      select: { id: true },
    });
    const storyIds = stories.map((s) => s.id);

    if (storyIds.length > 0) {
      await prisma.storyCharacter.deleteMany({ where: { storyId: { in: storyIds } } });
      await prisma.scene.deleteMany({ where: { storyId: { in: storyIds } } });
      await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
    }

    if (universeIds.length > 0) {
      await prisma.character.deleteMany({ where: { universeId: { in: universeIds } } });
      await prisma.universe.deleteMany({ where: { id: { in: universeIds } } });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { onboardedAt: null },
    });

    debug.story("Admin reset user", {
      adminId: req.userId || "unknown",
      targetEmail: target.email,
      storiesDeleted: storyIds.length,
      universesDeleted: universeIds.length,
    });

    res.json({ ok: true, storiesDeleted: storyIds.length, universesDeleted: universeIds.length });
  } catch (e) {
    debug.error("User reset failed", { error: String(e) });
    res.status(500).json({ error: "Failed to reset user" });
  }
});

// POST /api/admin/universes/:id/toggle-template — mark/unmark a universe as a default template
router.post("/universes/:id/toggle-template", async (req, res) => {
  try {
    const universe = await prisma.universe.findUnique({ where: { id: req.params.id as string } });
    if (!universe) {
      return res.status(404).json({ error: "Universe not found" });
    }
    const updated = await prisma.universe.update({
      where: { id: universe.id },
      data: { isTemplate: !universe.isTemplate },
    });
    res.json({ isTemplate: updated.isTemplate });
  } catch (e) {
    debug.error("Failed to toggle template", { error: String(e) });
    res.status(500).json({ error: "Failed to toggle template" });
  }
});

export default router;
