import prisma from "./prisma.js";

/**
 * Cascading deletes for our manually-managed relations. Prisma doesn't
 * generate true ON DELETE CASCADE for these tables, so every site that
 * deletes a story or universe needs to clean up the rows underneath it
 * in the right order. Centralized here so we have one definition.
 *
 * Order matters:
 *   StoryCharacter  → Scene  → Story
 *   Story (above)   → Character  → Universe
 */

export async function deleteStoriesCascade(storyIds: string[]): Promise<void> {
  if (storyIds.length === 0) return;
  await prisma.storyCharacter.deleteMany({ where: { storyId: { in: storyIds } } });
  await prisma.scene.deleteMany({ where: { storyId: { in: storyIds } } });
  await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
}

export async function deleteUniversesCascade(universeIds: string[]): Promise<void> {
  if (universeIds.length === 0) return;
  const stories = await prisma.story.findMany({
    where: { universeId: { in: universeIds } },
    select: { id: true },
  });
  await deleteStoriesCascade(stories.map((s) => s.id));
  await prisma.character.deleteMany({ where: { universeId: { in: universeIds } } });
  await prisma.universe.deleteMany({ where: { id: { in: universeIds } } });
}
