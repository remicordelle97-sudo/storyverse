import { Router } from "express";
import prisma from "../lib/prisma.js";
import { signAccessToken } from "../lib/jwt.js";
import { requireAdmin } from "../middleware/auth.js";
import { debug } from "../lib/debug.js";
import { deleteUniversesCascade } from "../lib/cascade.js";
import { serializeUser } from "../lib/serializeUser.js";
import { snapshotLatency } from "../middleware/httpLatency.js";
import { claudeQueue, geminiQueue } from "../lib/queues.js";

const router = Router();

// All routes require admin
router.use(requireAdmin);

// GET /api/admin/metrics — operational visibility for the async
// pipeline. Combines BullMQ queue counts (live), GenerationJob row
// stats (durable), and HTTP latency from the in-memory ring buffer.
router.get("/metrics", async (_req, res) => {
  try {
    // BullMQ counts. Returns null entries if no Redis is configured.
    const [claudeCounts, geminiCounts] = await Promise.all([
      claudeQueue?.getJobCounts("waiting", "active", "completed", "failed", "delayed").catch(() => null),
      geminiQueue?.getJobCounts("waiting", "active", "completed", "failed", "delayed").catch(() => null),
    ]);

    // GenerationJob aggregates: status × kind counts, recent-failure
    // count (last 24h), and average runtime per kind for completed
    // jobs (also last 24h to keep the average representative).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [statusKindCounts, recentCompleted, recentFailed] = await Promise.all([
      prisma.generationJob.groupBy({
        by: ["status", "kind"],
        _count: true,
      }),
      prisma.generationJob.findMany({
        where: { status: "completed", finishedAt: { gte: since }, startedAt: { not: null } },
        select: { kind: true, startedAt: true, finishedAt: true },
      }),
      prisma.generationJob.count({
        where: { status: "failed", finishedAt: { gte: since } },
      }),
    ]);

    // Avg runtime per kind. Skip rows missing either timestamp (shouldn't
    // happen for completed but defensive).
    const runtimes = new Map<string, number[]>();
    for (const j of recentCompleted) {
      if (!j.startedAt || !j.finishedAt) continue;
      const ms = j.finishedAt.getTime() - j.startedAt.getTime();
      const arr = runtimes.get(j.kind) ?? [];
      arr.push(ms);
      runtimes.set(j.kind, arr);
    }
    const avgRuntimeMs: Record<string, { count: number; avgMs: number }> = {};
    for (const [kind, samples] of runtimes) {
      const sum = samples.reduce((a, b) => a + b, 0);
      avgRuntimeMs[kind] = {
        count: samples.length,
        avgMs: Math.round(sum / samples.length),
      };
    }

    res.json({
      queues: {
        claudeTasks: claudeCounts,
        geminiTasks: geminiCounts,
        redisAvailable: claudeCounts !== null,
      },
      jobs: {
        byStatusAndKind: statusKindCounts,
        avgRuntimeLast24hMs: avgRuntimeMs,
        failedLast24h: recentFailed,
      },
      http: snapshotLatency(),
    });
  } catch (e: any) {
    debug.error(`admin metrics failed: ${e.message}`);
    res.status(500).json({ error: "Failed to compute metrics" });
  }
});

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
      user: serializeUser(targetUser),
    });
  } catch (e) {
    debug.error("Impersonation failed", { error: String(e) });
    res.status(500).json({ error: "Impersonation failed" });
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

    // TEMP: see CLAUDE.md — print orders should survive a reset before launch.
    await prisma.printOrder.deleteMany({ where: { userId } });

    await deleteUniversesCascade(universeIds);

    await prisma.user.update({
      where: { id: userId },
      data: { onboardedAt: null, shippingAddress: "" },
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

export default router;
