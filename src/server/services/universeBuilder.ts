import prisma from "../lib/prisma.js";

// Synchronous preset clone path — used by /api/auth/onboard-preset.
// Cloning is cheap (no AI work; the preset already has its art
// generated), so this stays a regular request/response handler instead
// of being routed through the async GenerationJob pipeline. The custom
// (Claude-driven) universe build lives in services/universePipeline.ts.

interface BuiltUniverse {
  id: string;
  name: string;
}

/**
 * Clone a template universe into the user's account. Copies the
 * universe row and every character row, preserving the existing style
 * reference and character reference image URLs (no Gemini work — the
 * preset already has its art generated). Throws if the source isn't
 * marked as a template.
 */
export async function clonePresetUniverse(
  userId: string,
  templateUniverseId: string,
): Promise<BuiltUniverse> {
  const template = await prisma.universe.findUnique({
    where: { id: templateUniverseId },
    include: { characters: true },
  });
  if (!template || !template.isTemplate) {
    throw new Error("Template not found");
  }

  const cloned = await prisma.universe.create({
    data: {
      userId,
      name: template.name,
      settingDescription: template.settingDescription,
      themes: template.themes,
      avoidThemes: template.avoidThemes,
      styleReferenceUrl: template.styleReferenceUrl,
      isPublic: false,
      // Preset clones don't count toward the user's universe quota — the
      // user can still build a custom one alongside it.
      fromPreset: true,
    },
  });

  for (const c of template.characters) {
    await prisma.character.create({
      data: {
        universeId: cloned.id,
        name: c.name,
        speciesOrType: c.speciesOrType,
        personalityTraits: c.personalityTraits,
        appearance: c.appearance,
        outfit: c.outfit,
        relationshipArchetype: c.relationshipArchetype,
        referenceImageUrl: c.referenceImageUrl,
        role: c.role,
      },
    });
  }

  return { id: cloned.id, name: cloned.name };
}
