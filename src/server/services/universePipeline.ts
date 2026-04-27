import prisma from "../lib/prisma.js";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, TEMPERATURE_CREATIVE, MAX_TOKENS_SHORT } from "../lib/config.js";
import { debug } from "../lib/debug.js";
import { ANTHROPIC_API_KEY } from "../lib/aiKeys.js";
import {
  generateStyleReference,
  generateAllCharacterSheets,
} from "./geminiGenerator.js";
import { updateJobProgress, createJob } from "../lib/jobs.js";
import { JOB_KINDS } from "../lib/queues.js";

// Async universe-creation pipeline. Two job kinds run sequentially:
//
//   universe_build   → Claude derives setting + character ensemble from
//                      the user's input (universe name, themes, hero,
//                      optional photos for each character). Persists
//                      Universe.settingDescription and the Character
//                      rows. Always enqueues universe_images on success.
//   universe_images  → Gemini generates the universe's style reference
//                      image and a reference sheet for every character
//                      lacking one. Idempotent — only fills gaps.
//
// Both processors are written so a worker that crashes mid-run can
// safely re-claim and continue. The Universe row carries the
// user-facing status; the GenerationJob row carries worker-side
// progress + lastError that the status endpoint surfaces.

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Shared types — kept here rather than imported from universeBuilder.ts
// so this module owns the async path end-to-end.
type AnthropicImageMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const ALLOWED_PHOTO_MIME: AnthropicImageMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface CharacterPhoto {
  mimeType: string;
  data: string; // raw base64, no "data:..." prefix
}

export interface UniverseBuildInput {
  universeName: string;
  themes: string[];
  hero: { name: string; species: string; traits: string[]; photo?: CharacterPhoto };
  supporting:
    | "auto"
    | { name: string; species: string; traits: string[]; photo?: CharacterPhoto }[];
}

export interface UniverseBuildJobPayload {
  input: UniverseBuildInput;
}

export interface UniverseImagesJobPayload {
  universeId: string;
}

interface ClaudeImageBlock {
  type: "image";
  source: { type: "base64"; media_type: AnthropicImageMimeType; data: string };
}
interface ClaudeTextBlock {
  type: "text";
  text: string;
}
type ClaudeContentBlock = ClaudeImageBlock | ClaudeTextBlock;

const SYSTEM_PROMPT = `You design complete children's story universes — setting and an ensemble cast — with rich enough detail that every character looks identical across many illustrations.

For any character where the user has uploaded a photo (likely a real-world toy or stuffed animal), treat that photo as the SOURCE OF TRUTH for that character's visual details: shape, colors, distinguishing features, accessories. Use the user-supplied name, species, and traits as personality and behavioral context. If the photo contradicts the species label (e.g., the user typed "rabbit" but the photo shows a teddy bear), describe what you actually see.

When deriving fields from a photo: if a feature isn't directly visible (e.g., the back of the body, the underside, or one side of the head), infer it plausibly from what you can see and from common characteristics of this kind of toy/animal. Never say "not visible" or omit a field — the illustrator needs a complete spec to draw the character from any angle.

For characters with no photo, invent appearance and outfit from species + traits as usual. Every character must have a distinct silhouette, primary color, and size relative to the others.

Return ONLY valid JSON, no markdown fences.`;

function isAllowedMime(m: string): m is AnthropicImageMimeType {
  return (ALLOWED_PHOTO_MIME as string[]).includes(m);
}

function photoToImageBlock(photo?: CharacterPhoto): ClaudeImageBlock | null {
  if (!photo || !photo.data || !photo.mimeType) return null;
  if (!isAllowedMime(photo.mimeType)) return null;
  const approxBytes = Math.floor((photo.data.length * 3) / 4);
  if (approxBytes > MAX_PHOTO_BYTES) return null;
  return {
    type: "image",
    source: { type: "base64", media_type: photo.mimeType, data: photo.data },
  };
}

/** Validate the input before persisting anything. Throws with a clear
 * message that the route can return as a 400. */
export function validateUniverseInput(input: UniverseBuildInput): {
  universeName: string;
  themes: string[];
  heroName: string;
  heroSpecies: string;
  heroTraits: string[];
} {
  const universeName = input.universeName.trim();
  const themes = input.themes.map((t) => t.trim()).filter(Boolean);
  const heroName = input.hero.name.trim();
  const heroSpecies = input.hero.species.trim();
  const heroTraits = input.hero.traits.map((t) => t.trim()).filter(Boolean);

  if (!universeName) throw new Error("Universe name is required");
  if (themes.length === 0) throw new Error("At least one theme is required");
  if (!heroName || !heroSpecies || heroTraits.length === 0) {
    throw new Error("Hero name, species, and at least one trait are required");
  }
  return { universeName, themes, heroName, heroSpecies, heroTraits };
}

/** Create a placeholder Universe row with status="queued" and the user's
 * pre-validated name/themes baked in. Settings + characters get filled
 * in by the build job. The placeholder gives the client a universeId
 * to navigate to and poll against immediately. */
export async function createUniversePlaceholder(input: {
  userId: string;
  universeName: string;
  themes: string[];
}) {
  return prisma.universe.create({
    data: {
      userId: input.userId,
      name: input.universeName,
      // Filled in by universe_build.
      settingDescription: "",
      themes: JSON.stringify(input.themes),
      avoidThemes: "",
      isPublic: false,
      status: "queued",
    },
  });
}

/** Process a universe_build job. Idempotent: if the Universe is already
 * past the "queued"/"building" gate OR characters already exist, exits
 * without doing work (mirrors the storyPipeline pattern — guards the
 * "worker crashed after createMany" case). */
export async function runUniverseBuildJob(
  jobId: string,
  payload: UniverseBuildJobPayload,
  universeId: string,
) {
  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
    include: { _count: { select: { characters: true } } },
  });
  if (!universe) {
    throw new Error(`Universe ${universeId} not found`);
  }
  if (universe.status !== "queued" && universe.status !== "building") {
    debug.universe(`universe_build: ${universeId} already past build (status=${universe.status}) — skipping`);
    return;
  }
  if (universe._count.characters > 0) {
    debug.universe(`universe_build: ${universeId} already has ${universe._count.characters} characters — skipping (likely a re-claim)`);
    await prisma.universe.update({
      where: { id: universeId },
      data: { status: "illustrating_assets" },
    });
    await createJob({
      kind: JOB_KINDS.universeImages,
      ownerId: universe.userId,
      universeId,
      payload: { universeId } satisfies UniverseImagesJobPayload as any,
    });
    return;
  }

  await prisma.universe.update({
    where: { id: universeId },
    data: { status: "building" },
  });
  await updateJobProgress(jobId, "preparing", 5);

  const input = payload.input;
  const heroPhotoBlock = photoToImageBlock(input.hero.photo);
  const heroName = input.hero.name.trim();
  const heroSpecies = input.hero.species.trim();
  const heroTraits = input.hero.traits.map((t) => t.trim()).filter(Boolean);

  let supportingMode: "auto" | "manual" = "auto";
  let manualSupporting: {
    name: string;
    species: string;
    traits: string[];
    photoBlock: ClaudeImageBlock | null;
  }[] = [];
  if (Array.isArray(input.supporting)) {
    supportingMode = "manual";
    manualSupporting = input.supporting
      .map((s) => ({
        name: s.name.trim(),
        species: s.species.trim(),
        traits: s.traits.map((t) => t.trim()).filter(Boolean),
        photoBlock: photoToImageBlock(s.photo),
      }))
      .filter((s) => s.name && s.species && s.traits.length > 0);
  }

  const heroPhotoNote = heroPhotoBlock ? "(photo provided below)" : "(no photo)";
  const themes: string[] = JSON.parse(universe.themes);

  const supportingRosterText =
    supportingMode === "auto"
      ? `Invent 3 supporting characters that fit this universe and complement the hero. Each should be a different species from the hero and from each other. Give each one: name, species, 2-4 personality traits, a relationship_archetype (their role in the hero's life), appearance, and outfit.`
      : `The user has supplied ${manualSupporting.length} supporting characters:\n${manualSupporting
          .map((s, i) => {
            const note = s.photoBlock ? "(photo provided below)" : "(no photo)";
            return `- Supporting ${i + 1}: name="${s.name}", species="${s.species}", traits=${JSON.stringify(s.traits)} ${note}`;
          })
          .join("\n")}\n\nFor each, generate appearance and outfit. Use the user-supplied name, species, and traits exactly. Add a relationship_archetype that fits.`;

  const introText = `Create a children's story universe and its character ensemble.

USER-PROVIDED:
- Universe name: ${universe.name}
- Themes: ${themes.join(", ")}
- Hero: ${heroName} (${heroSpecies}) — traits: ${heroTraits.join(", ")} ${heroPhotoNote}

${supportingRosterText}`;

  const jobText = `YOUR JOB:
1. Write a 3-4 sentence setting_description that paints this world vividly. The themes are the user's interests — weave them in.
2. For each character WITH a photo: derive "appearance" and "outfit" from what you see in their photo, with hex codes. Capture the actual colors, proportions, materials, and accessories. The illustrator must be able to draw the toy faithfully from your description alone, without the photo. If a feature isn't directly visible in the photo, infer it plausibly — never leave a field blank or say "not visible".
3. For each character WITHOUT a photo: invent "appearance" and "outfit" from the user's species and traits, with hex codes.
4. Every character must have a distinct silhouette, primary color, and size relative to the others.

VISUAL FIELD REQUIREMENTS (for every character):
- "appearance" — BODY ONLY (no clothing). Include BODY (shape, size, primary color with hex), HEAD (shape, color hex), EYES (count, shape, color hex), nose/mouth/snout, EARS, ARMS (with finger count), LEGS, WINGS (or "none"), TAIL (or "none"), ANTENNAE/HORNS (or "none"), MARKINGS (with hex codes). Every color must include a hex code.
- "outfit" — Format: "ALWAYS WEARS AND CARRIES (never remove any item):\\n- #hex item description". One line per item. If the toy in the photo isn't wearing anything separable from its body, return an empty string.

Return EXACTLY this JSON:
{
  "setting_description": "...",
  "hero": {
    "name": "${heroName}",
    "species_or_type": "${heroSpecies}",
    "personality_traits": ${JSON.stringify(heroTraits)},
    "appearance": "...",
    "outfit": "...",
    "relationship_archetype": ""
  },
  "supporting": [
    { "name": "...", "species_or_type": "...", "personality_traits": ["..."], "appearance": "...", "outfit": "...", "relationship_archetype": "..." }
  ]
}`;

  const content: ClaudeContentBlock[] = [{ type: "text", text: introText }];
  if (heroPhotoBlock) {
    content.push({ type: "text", text: `Photo for the hero (${heroName}):` });
    content.push(heroPhotoBlock);
  }
  manualSupporting.forEach((s, i) => {
    if (s.photoBlock) {
      content.push({
        type: "text",
        text: `Photo for supporting ${i + 1} (${s.name}, ${s.species}):`,
      });
      content.push(s.photoBlock);
    }
  });
  content.push({ type: "text", text: jobText });

  const photoCount =
    (heroPhotoBlock ? 1 : 0) + manualSupporting.filter((s) => s.photoBlock).length;
  debug.universe("Universe builder Claude call", {
    universe: universe.name,
    supportingMode,
    supportingCount: supportingMode === "auto" ? "auto-3" : manualSupporting.length,
    photos: photoCount,
  });

  await updateJobProgress(jobId, "claude", 30);

  const claudeResp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_SHORT,
    temperature: TEMPERATURE_CREATIVE,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const textBlock = claudeResp.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }
  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  const parsed = JSON.parse(raw) as {
    setting_description: string;
    hero: {
      name: string;
      species_or_type: string;
      personality_traits: string[];
      appearance: string;
      outfit: string;
      relationship_archetype: string;
    };
    supporting: {
      name: string;
      species_or_type: string;
      personality_traits: string[];
      appearance: string;
      outfit: string;
      relationship_archetype: string;
    }[];
  };

  await updateJobProgress(jobId, "saving", 80);

  // Persist the parsed setting + characters in one transaction. The
  // Universe row already exists (placeholder) so we update its
  // settingDescription only — name + themes were locked in at create.
  await prisma.$transaction(async (tx) => {
    await tx.universe.update({
      where: { id: universeId },
      data: { settingDescription: parsed.setting_description },
    });

    await tx.character.create({
      data: {
        universeId,
        name: parsed.hero.name,
        speciesOrType: parsed.hero.species_or_type,
        personalityTraits: JSON.stringify(parsed.hero.personality_traits),
        appearance: parsed.hero.appearance,
        outfit: parsed.hero.outfit || "",
        role: "main",
      },
    });

    const supportingToCreate = supportingMode === "auto"
      ? (parsed.supporting || []).map((s) => ({
          name: s.name,
          speciesOrType: s.species_or_type,
          personalityTraits: JSON.stringify(s.personality_traits || []),
          appearance: s.appearance,
          outfit: s.outfit || "",
          relationshipArchetype: s.relationship_archetype || "",
        }))
      : manualSupporting.map((u, i) => {
          const claudeOut = parsed.supporting?.[i];
          return {
            name: u.name,
            speciesOrType: u.species,
            personalityTraits: JSON.stringify(u.traits),
            appearance: claudeOut?.appearance || "",
            outfit: claudeOut?.outfit || "",
            relationshipArchetype: claudeOut?.relationship_archetype || "",
          };
        });

    for (const s of supportingToCreate) {
      await tx.character.create({
        data: { universeId, ...s, role: "supporting" },
      });
    }
  });

  // Hand off to image generation.
  await prisma.universe.update({
    where: { id: universeId },
    data: { status: "illustrating_assets" },
  });
  await createJob({
    kind: JOB_KINDS.universeImages,
    ownerId: universe.userId,
    universeId,
    payload: { universeId } satisfies UniverseImagesJobPayload as any,
  });
  debug.universe(`universe_build done; universe_images enqueued for ${universeId}`);
}

/** Process a universe_images job. Idempotent: generateAllCharacterSheets
 * already skips characters whose referenceImageUrl is set, and
 * generateStyleReference is a no-op if styleReferenceUrl exists. */
export async function runUniverseImagesJob(
  jobId: string,
  payload: UniverseImagesJobPayload,
) {
  const universe = await prisma.universe.findUnique({
    where: { id: payload.universeId },
    include: { characters: true },
  });
  if (!universe) {
    throw new Error(`Universe ${payload.universeId} not found`);
  }
  if (universe.status === "ready") {
    debug.universe(`universe_images: ${payload.universeId} already ready — skipping`);
    return;
  }
  if (universe.characters.length === 0) {
    throw new Error(`Universe ${payload.universeId} has no characters; can't illustrate`);
  }

  await prisma.universe.update({
    where: { id: payload.universeId },
    data: { status: "illustrating_assets" },
  });

  // Style reference comes first: character sheets are generated against
  // it, so out-of-order would break consistency.
  if (!universe.styleReferenceUrl) {
    await updateJobProgress(jobId, "style", 5);
    await generateStyleReference(payload.universeId);
  }

  await updateJobProgress(jobId, "characters", 25);
  // generateAllCharacterSheets is internally per-character and skips
  // any character that already has a referenceImageUrl, so this is
  // safe to re-run after a partial failure.
  await generateAllCharacterSheets(payload.universeId);

  // Verify we got at least one character sheet — Gemini occasionally
  // returns nothing usable for every attempt.
  const final = await prisma.character.findMany({
    where: { universeId: payload.universeId },
    select: { referenceImageUrl: true },
  });
  const sheetCount = final.filter((c) => c.referenceImageUrl).length;
  if (sheetCount === 0) {
    throw new Error(`No character sheets generated for universe ${payload.universeId}`);
  }

  await prisma.universe.update({
    where: { id: payload.universeId },
    data: { status: "ready" },
  });
  debug.universe(`universe_images: ${payload.universeId} done (${sheetCount}/${universe.characters.length} sheets)`);
}

/** Mark a universe job's failure on the Universe row so the polling
 * client sees a terminal state. The schema's documented vocabulary
 * is a single "failed" for either build or image failures. */
export async function markUniverseFailed(universeId: string) {
  await prisma.universe.update({
    where: { id: universeId },
    data: { status: "failed" },
  });
}
