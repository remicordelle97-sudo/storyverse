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

export default router;
