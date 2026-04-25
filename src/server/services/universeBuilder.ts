import prisma from "../lib/prisma.js";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, TEMPERATURE_CREATIVE, MAX_TOKENS_SHORT } from "../lib/config.js";
import { debug } from "../lib/debug.js";
import { generateStyleReference, generateAllCharacterSheets } from "./geminiGenerator.js";

const anthropic = new Anthropic();

export interface CharacterPhoto {
  mimeType: string; // e.g. "image/jpeg"
  data: string;     // raw base64, no "data:..." prefix
}

// The Anthropic SDK requires media_type to be one of these literals.
type AnthropicImageMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
const ALLOWED_PHOTO_MIME: AnthropicImageMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
function isAllowedMime(m: string): m is AnthropicImageMimeType {
  return (ALLOWED_PHOTO_MIME as string[]).includes(m);
}
// Anthropic vision caps individual images around 5MB after decoding.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface UniverseBuilderInput {
  universeName: string;
  themes: string[];
  hero: { name: string; species: string; traits: string[]; photo?: CharacterPhoto };
  supporting:
    | "auto"
    | { name: string; species: string; traits: string[]; photo?: CharacterPhoto }[];
}

export interface BuiltUniverse {
  id: string;
  name: string;
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

/**
 * Validate and convert an in-memory photo to an Anthropic image content
 * block. Returns null if the photo is missing/invalid (caller falls
 * back to text-based generation for that character).
 */
function photoToImageBlock(photo?: CharacterPhoto): ClaudeImageBlock | null {
  if (!photo || !photo.data || !photo.mimeType) return null;
  if (!isAllowedMime(photo.mimeType)) return null;
  // base64 length × 3/4 ≈ decoded bytes
  const approxBytes = Math.floor((photo.data.length * 3) / 4);
  if (approxBytes > MAX_PHOTO_BYTES) return null;
  return {
    type: "image",
    source: { type: "base64", media_type: photo.mimeType, data: photo.data },
  };
}

const SYSTEM_PROMPT = `You design complete children's story universes — setting and an ensemble cast — with rich enough detail that every character looks identical across many illustrations.

For any character where the user has uploaded a photo (likely a real-world toy or stuffed animal), treat that photo as the SOURCE OF TRUTH for that character's visual details: shape, colors, distinguishing features, accessories. Use the user-supplied name, species, and traits as personality and behavioral context. If the photo contradicts the species label (e.g., the user typed "rabbit" but the photo shows a teddy bear), describe what you actually see.

When deriving fields from a photo: if a feature isn't directly visible (e.g., the back of the body, the underside, or one side of the head), infer it plausibly from what you can see and from common characteristics of this kind of toy/animal. Never say "not visible" or omit a field — the illustrator needs a complete spec to draw the character from any angle.

For characters with no photo, invent appearance and outfit from species + traits as usual. Every character must have a distinct silhouette, primary color, and size relative to the others.

Return ONLY valid JSON, no markdown fences.`;

/**
 * Synchronous half: ask Claude to flesh out the setting description and
 * every character's appearance/outfit, then persist the universe + its
 * characters. Returns once the records exist so the caller can respond
 * to the client immediately.
 *
 * If the user has uploaded photos for any character, those photos are
 * passed inline as base64 vision inputs in the same Claude call. They
 * are used in memory only — never written to disk or storage.
 *
 * The caller is expected to invoke startUniverseImageGeneration(id) on
 * the returned universe to kick off the background Gemini work.
 */
export async function buildCustomUniverse(
  userId: string,
  input: UniverseBuilderInput
): Promise<BuiltUniverse> {
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

  const heroPhotoBlock = photoToImageBlock(input.hero.photo);

  let supportingMode: "auto" | "manual" = "auto";
  let manualSupporting: { name: string; species: string; traits: string[]; photoBlock: ClaudeImageBlock | null }[] = [];
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

  const supportingRosterText = supportingMode === "auto"
    ? `Invent 3 supporting characters that fit this universe and complement the hero. Each should be a different species from the hero and from each other. Give each one: name, species, 2-4 personality traits, a relationship_archetype (their role in the hero's life), appearance, and outfit.`
    : `The user has supplied ${manualSupporting.length} supporting characters:\n${manualSupporting
        .map((s, i) => {
          const note = s.photoBlock ? "(photo provided below)" : "(no photo)";
          return `- Supporting ${i + 1}: name="${s.name}", species="${s.species}", traits=${JSON.stringify(s.traits)} ${note}`;
        })
        .join("\n")}\n\nFor each, generate appearance and outfit. Use the user-supplied name, species, and traits exactly. Add a relationship_archetype that fits.`;

  const introText = `Create a children's story universe and its character ensemble.

USER-PROVIDED:
- Universe name: ${universeName}
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

  // Build the content array: intro text → labeled image blocks for any
  // character with a photo → the JOB instructions.
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
    universe: universeName,
    supportingMode,
    supportingCount: supportingMode === "auto" ? "auto-3" : manualSupporting.length,
    photos: photoCount,
  });

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
    hero: { name: string; species_or_type: string; personality_traits: string[]; appearance: string; outfit: string; relationship_archetype: string };
    supporting: { name: string; species_or_type: string; personality_traits: string[]; appearance: string; outfit: string; relationship_archetype: string }[];
  };

  const universe = await prisma.universe.create({
    data: {
      userId,
      name: universeName,
      settingDescription: parsed.setting_description,
      themes: JSON.stringify(themes),
      avoidThemes: "",
      isPublic: false,
    },
  });

  await prisma.character.create({
    data: {
      universeId: universe.id,
      name: parsed.hero.name,
      speciesOrType: parsed.hero.species_or_type,
      personalityTraits: JSON.stringify(parsed.hero.personality_traits),
      appearance: parsed.hero.appearance,
      outfit: parsed.hero.outfit || "",
      role: "main",
    },
  });

  // For supporting characters: in auto mode use Claude's full output. In
  // manual mode keep the user-supplied name/species/traits and only take
  // appearance/outfit/archetype from Claude — Claude can't drift off
  // what the user typed.
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
    await prisma.character.create({
      data: {
        universeId: universe.id,
        ...s,
        role: "supporting",
      },
    });
  }

  return { id: universe.id, name: universe.name };
}

/**
 * Fire-and-forget background image generation: style reference followed
 * by every character's reference sheet. Errors are swallowed so they
 * don't crash the calling request — the universe is still usable
 * without images, and the library will keep showing "Generating..."
 * placeholders.
 */
export function startUniverseImageGeneration(universeId: string, universeName: string) {
  (async () => {
    try {
      await generateStyleReference(universeId);
      await generateAllCharacterSheets(universeId);
      debug.universe(`Image generation complete for "${universeName}"`);
    } catch (e: any) {
      debug.error(`Image generation failed for "${universeName}": ${e?.message || e}`);
    }
  })();
}
