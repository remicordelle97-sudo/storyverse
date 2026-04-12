import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { CLAUDE_MODEL, TEMPERATURE_CREATIVE, MAX_TOKENS_SHORT } from "../lib/config.js";

const anthropic = new Anthropic();

interface GeneratedCharacter {
  name: string;
  species_or_type: string;
  personality_traits: string[];
  appearance: string;
  outfit: string;
  relationship_archetype: string;
  role: "main" | "supporting";
}

/**
 * Generate ALL characters for a universe — the hero and 3 supporting characters
 * as an ensemble in a single Claude call. The hero name must already be stored
 * on a placeholder character record with role="main" in the universe.
 */
export async function generateAllCharacters(
  universeId: string
): Promise<void> {
  const universe = await prisma.universe.findUniqueOrThrow({
    where: { id: universeId },
    include: { characters: true },
  });

  const heroPlaceholder = universe.characters.find((c) => c.role === "main");
  if (!heroPlaceholder) {
    throw new Error("No hero placeholder found in universe");
  }

  const heroName = heroPlaceholder.name;

  let themes: string[];
  try {
    themes = JSON.parse(universe.themes);
  } catch {
    themes = [universe.themes];
  }

  debug.character("Generating all characters (hero + supporting)", {
    universe: universe.name,
    heroName,
  });

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_SHORT,
    temperature: TEMPERATURE_CREATIVE,
    system: `You design complete character ensembles for children's story universes. You generate both the hero and supporting cast together so they work as a group — contrasting species, complementary personalities, and distinct visual designs.

For SUPPORTING characters only:
- "relationship_archetype": What familiar relationship from a child's life does this character represent? (e.g., "the best friend who's always up for anything", "the cautious older sibling")

=== VISUAL FIELDS (required for ALL characters) ===

1. "appearance" — BODY ONLY (no clothing). A COMPLETE VISUAL SPECIFICATION detailed enough for an illustrator to draw the character identically across 50 different images. Include ALL of:
  BODY (shape, size, posture, primary color with hex code), HEAD (shape, size relative to body, color with hex code), EYES (count, shape, size, color with hex code, pupil style), NOSE/MOUTH/BEAK/SNOUT (type, shape, color with hex code), EARS (count, shape, size, position — or "none"), ARMS (count, length, thickness, color with hex code, what's at the end — hands/paws/claws, finger count), LEGS (count, length, thickness, color with hex code, feet/hooves/claws), WINGS (count, size, shape, color with hex code, transparency — or "none"), TAIL (length, shape, color with hex code — or "none"), ANTENNAE/HORNS (count, shape, length — or "none"), MARKINGS (stripes, spots, patterns with hex codes, locations on body).
  Be SPECIFIC with numbers: "2 large translucent #40E0D0 teal wings" not "wings".
  Every color mentioned MUST include its hex code (e.g., "#D4920A warm amber eyes" not just "warm amber eyes").

2. "outfit" — Everything they wear/carry. Each item with hex color code, position, and details.
  Format: "ALWAYS WEARS AND CARRIES (never remove any item):" + bulleted list with hex codes.

Return ONLY valid JSON. No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Create a complete character ensemble for this story universe: 1 hero and 3 supporting characters.

UNIVERSE: ${universe.name}
SETTING: ${universe.settingDescription}
THEMES: ${themes.join(", ")}
HERO NAME: ${heroName}

RULES:
- The FIRST character must be the hero "${heroName}" with role "main". Choose a species/type for them based on the universe. Vary your choices — don't always pick the most common or default option. There are many possible species that fit any universe.
- Create 3 supporting characters with role "supporting".
- ALL characters should be DIFFERENT species/types from each other.
- Design them as an ensemble — their species, personalities, and looks should contrast and complement each other.
- The supporting characters should have VARYING closeness to the hero:
  * One should be a close friend or companion (strong relationship)
  * One should be an acquaintance or neighbor (moderate relationship)
  * One should be someone the hero barely knows or has just met (low/no relationship yet)
- Each character needs 2-4 distinct personality traits.
- Names should be fun and age-appropriate. Include the species in the name (e.g., "Zuri the Zebra", "Pip the Parrot"). The hero's name is "${heroName}" — add their species to it.
- For the hero: leave relationship_archetype as an empty string.
- For supporting characters: fill in relationship_archetype.

CRITICAL VISUAL DISTINCTNESS RULES:
- Every character MUST have a completely different SILHOUETTE. Vary body shapes dramatically: one tall and thin, one short and round, one angular, one soft/blobby. A child should be able to tell them apart from their shadow alone.
- Every character MUST have a different PRIMARY COLOR. No two characters should share a dominant body color. Use contrasting palettes (e.g., warm orange vs cool blue vs earthy green vs bright purple).
- Every character MUST have a different SIZE relative to the others. Vary heights and proportions significantly.
- Even if all characters are the same general type (e.g., all robots, all fairies), they must look NOTHING alike. Different head shapes, different body proportions, different limb styles, different features. Think how different R2-D2, C-3PO, Wall-E, and Baymax look — all robots, but instantly distinguishable.

Return exactly this JSON:
{
  "characters": [
    {
      "name": "${heroName} the [Species]",
      "species_or_type": "Species",
      "role": "main",
      "personality_traits": ["trait1", "trait2", "trait3"],
      "relationship_archetype": "",
      "appearance": "Complete body-only visual specification...",
      "outfit": "ALWAYS WEARS AND CARRIES (never remove any item):\\n- #hex item..."
    },
    {
      "name": "Full name like Zuri the Zebra",
      "species_or_type": "Zebra",
      "role": "supporting",
      "personality_traits": ["trait1", "trait2", "trait3"],
      "relationship_archetype": "...",
      "appearance": "...",
      "outfit": "..."
    }
  ]
}`,
      },
    ],
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error("Character generation was truncated — response exceeded token limit.");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const parsed: { characters: GeneratedCharacter[] } = JSON.parse(raw);

  if (!Array.isArray(parsed.characters)) {
    throw new Error("Invalid character generation response");
  }

  debug.character(`Claude returned ${parsed.characters.length} characters`);

  // Update the hero placeholder with full details
  const heroData = parsed.characters.find((c) => c.role === "main");
  if (heroData) {
    debug.character(`Updating hero: ${heroData.name} (${heroData.species_or_type})`, {
      traits: heroData.personality_traits.join(", "),
    });
    await prisma.character.update({
      where: { id: heroPlaceholder.id },
      data: {
        name: heroData.name,
        speciesOrType: heroData.species_or_type,
        personalityTraits: JSON.stringify(heroData.personality_traits),
        appearance: heroData.appearance,
        outfit: heroData.outfit || "",
      },
    });
  }

  // Create supporting characters
  const supporting = parsed.characters.filter((c) => c.role === "supporting");
  for (const char of supporting) {
    debug.character(`Creating: ${char.name} (${char.species_or_type})`, {
      traits: char.personality_traits.join(", "),
    });
    await prisma.character.create({
      data: {
        universeId,
        name: char.name,
        speciesOrType: char.species_or_type,
        personalityTraits: JSON.stringify(char.personality_traits),
        appearance: char.appearance,
        outfit: char.outfit || "",
        relationshipArchetype: char.relationship_archetype || "",
        role: "supporting",
      },
    });
  }
}
