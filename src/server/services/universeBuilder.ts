import prisma from "../lib/prisma.js";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, TEMPERATURE_CREATIVE, MAX_TOKENS_SHORT } from "../lib/config.js";
import { debug } from "../lib/debug.js";
import { generateStyleReference, generateAllCharacterSheets } from "./geminiGenerator.js";

const anthropic = new Anthropic();

export interface UniverseBuilderInput {
  universeName: string;
  themes: string[];
  hero: { name: string; species: string; traits: string[] };
  supporting: "auto" | { name: string; species: string; traits: string[] }[];
}

export interface BuiltUniverse {
  id: string;
  name: string;
}

/**
 * Synchronous half: ask Claude to flesh out the setting description and
 * every character's appearance/outfit, then persist the universe + its
 * characters. Returns once the records exist so the caller can respond
 * to the client immediately.
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

  let supportingMode: "auto" | "manual" = "auto";
  let manualSupporting: { name: string; species: string; traits: string[] }[] = [];
  if (Array.isArray(input.supporting)) {
    supportingMode = "manual";
    manualSupporting = input.supporting
      .map((s) => ({
        name: s.name.trim(),
        species: s.species.trim(),
        traits: s.traits.map((t) => t.trim()).filter(Boolean),
      }))
      .filter((s) => s.name && s.species && s.traits.length > 0);
  }

  const supportingInstruction = supportingMode === "auto"
    ? `Invent 3 supporting characters that fit this universe and complement the hero. Each should be a different species from the hero and from each other. Give each one: name, species, 2-4 personality traits, a relationship_archetype (their role in the hero's life), appearance, and outfit.`
    : `Generate appearance and outfit fields for these supporting characters supplied by the user. Use their given name, species, and traits exactly. Add a relationship_archetype that fits.\n\n${manualSupporting.map((s, i) => `Supporting ${i + 1}: name="${s.name}", species="${s.species}", traits=${JSON.stringify(s.traits)}`).join("\n")}`;

  const userMessage = `Create a children's story universe and its character ensemble.

USER-PROVIDED:
- Universe name: ${universeName}
- Themes: ${themes.join(", ")}
- Hero name: ${heroName}
- Hero species: ${heroSpecies}
- Hero personality traits: ${heroTraits.join(", ")}

YOUR JOB:
1. Write a 3-4 sentence setting_description that paints this world vividly. The themes are the user's interests — weave them in.
2. Generate the hero's appearance and outfit from the user-supplied species and traits. Keep the user's name, species, and traits exactly as given.
3. ${supportingInstruction}

VISUAL FIELD REQUIREMENTS (for every character):
- "appearance" — BODY ONLY (no clothing). Include BODY (shape, size, primary color with hex), HEAD (shape, color hex), EYES (count, shape, color hex), nose/mouth/snout, EARS, ARMS (with finger count), LEGS, WINGS (or "none"), TAIL (or "none"), ANTENNAE/HORNS (or "none"), MARKINGS (with hex codes). Every color must include a hex code.
- "outfit" — Format: "ALWAYS WEARS AND CARRIES (never remove any item):\\n- #hex item description". One line per item.
- Every character must have a different SILHOUETTE, primary color, and size relative to each other.

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

  const claudeResp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_SHORT,
    temperature: TEMPERATURE_CREATIVE,
    system:
      "You design complete children's story universes — setting and an ensemble cast — with rich enough detail that every character looks identical across many illustrations. Return ONLY valid JSON, no markdown fences.",
    messages: [{ role: "user", content: userMessage }],
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
      illustrationStyle: "storybook",
      isPublic: false,
      isTemplate: false,
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
