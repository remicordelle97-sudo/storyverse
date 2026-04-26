import prisma from "./prisma.js";
import { PLAN_LIMITS } from "./config.js";

interface QuotaStatus {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

export async function checkUniverseQuota(userId: string): Promise<QuotaStatus> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const plan = user.role === "admin" ? "admin" : (user.plan || "free");
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const limit = limits.maxUniverses;

  if (limit === Infinity) {
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }

  // Preset (template-cloned) universes don't count: a free user can pick
  // a preset during onboarding AND still build their one custom universe.
  const used = await prisma.universe.count({
    where: { userId, fromPreset: false },
  });
  const remaining = Math.max(0, limit - used);

  return { allowed: used < limit, used, limit, remaining };
}

export async function checkStoryQuota(
  userId: string,
  illustrated: boolean
): Promise<QuotaStatus> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const plan = user.role === "admin" ? "admin" : (user.plan || "free");
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const limit = illustrated
    ? limits.illustratedStoriesPerMonth
    : limits.textStoriesPerMonth;

  if (limit === Infinity) {
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }

  // Count stories THIS user authored this calendar month. Tying the
  // quota to createdById (not universe ownership) is the only way to
  // bill the user who pressed Generate — otherwise generating inside
  // a public universe wouldn't tick the counter.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const used = await prisma.story.count({
    where: {
      createdById: userId,
      createdAt: { gte: monthStart },
      hasIllustrations: illustrated,
    },
  });

  const remaining = Math.max(0, limit - used);

  return {
    allowed: used < limit,
    used,
    limit,
    remaining,
  };
}
