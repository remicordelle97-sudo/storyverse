import prisma from "./prisma.js";

/**
 * Verify that the given universe belongs to the given user.
 * Returns the universe if owned, or null if not found / not owned.
 */
export async function verifyUniverseOwnership(universeId: string, userId: string) {
  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
    select: { id: true, userId: true },
  });
  if (!universe || universe.userId !== userId) return null;
  return universe;
}

/**
 * Verify the user can access a universe — either owns it or it's public.
 */
export async function verifyUniverseAccess(universeId: string, userId: string) {
  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
    select: { id: true, userId: true, isPublic: true },
  });
  if (!universe) return null;
  if (universe.userId === userId || universe.isPublic) return universe;
  return null;
}
