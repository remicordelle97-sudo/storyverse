import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";

const anthropic = new Anthropic();

interface GeneratedCharacter {
  name: string;
  species_or_type: string;
  personality_traits: string[];
  appearance: string;
  outfit: string;
  special_detail: string;
  relationship_to_hero: string;
}

interface GeneratedCharacters {
  characters: GeneratedCharacter[];
}

export async function generateSecondaryCharacters(
  universeId: string
): Promise<void> {
  const universe = await prisma.universe.findUniqueOrThrow({
    where: { id: universeId },
    include: {
      characters: true,
    },
  });

  const hero = universe.characters.find((c) => c.role === "main");
  if (!hero) {
    throw new Error("No hero found in universe");
  }

  debug.character("Generating secondary characters", {
    universe: universe.name,
    hero: hero.name,
  });

  let heroTraits: string[];
  try {
    heroTraits = JSON.parse(hero.personalityTraits);
  } catch {
    heroTraits = [hero.personalityTraits];
  }

  let themes: string[];
  try {
    themes = JSON.parse(universe.themes);
  } catch {
    themes = [universe.themes];
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    temperature: 0.85,
    system: `You create supporting characters for children's story universes. Each character should be distinct, memorable, and complement the hero.

CRITICAL: You must provide TWO separate visual fields:

1. "appearance" — the CHARACTER'S BODY only (no clothing, no accessories, no carried items). This is what the character looks like naked/bare. Include ALL of the following:
  BODY: Overall body shape and size (tall/short, thin/stocky/round), posture, primary body color
  HEAD: Shape (round, elongated, angular), size relative to body, color
  EYES: Count, shape, size, color, pupil style (round, slit, compound)
  NOSE/MOUTH/BEAK/SNOUT: Type, shape, color
  EARS: Count, shape, size, position (or "none")
  ARMS: Count, length, thickness, color, ending (hands/paws/claws, finger count)
  LEGS: Count, length, thickness, color, ending (feet/hooves/claws)
  WINGS: Count, size, shape, color, transparency, attachment point (or "none")
  TAIL: Length, thickness, shape, color (or "none")
  ANTENNAE/HORNS: Count, shape, length, tip details (or "none")
  MARKINGS: Stripes, spots, patches, scars, unique patterns, locations on body
  Be SPECIFIC with numbers: "2 large translucent teal wings" not "wings"

2. "outfit" — EVERYTHING the character wears, carries, or has on them. This is SEPARATE from their body. List each item with:
  - The item name
  - Its EXACT color as a hex code (e.g., "#2A7A6B teal")
  - Where on the body it sits
  - Any distinguishing details (buckles, patterns, patches, logos)
  Format as a bulleted list starting with "ALWAYS WEARS AND CARRIES (never remove any item):"
  Example:
  "ALWAYS WEARS AND CARRIES (never remove any item):
  - #E85C33 orange-red bandana tied around forehead
  - #2A7A6B teal sleeveless vest with #1D5C4F darker trim at edges
  - #4A4A3A dark olive shorts reaching just above the knees
  - Small #C9A84C gold circular pendant on a #5C3A1E brown cord around neck
  - #6B4226 brown leather satchel with a shoulder strap, worn on left side, with a small brass buckle"

Return ONLY valid JSON. No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Create 3 supporting characters for this story universe.

UNIVERSE: ${universe.name}
SETTING: ${universe.settingDescription}
THEMES: ${themes.join(", ")}
MOOD: ${universe.mood}

HERO: ${hero.name} (${hero.speciesOrType})
Hero personality: ${heroTraits.join(", ")}
Hero appearance: ${hero.appearance}
Hero special detail: ${hero.specialDetail}

RULES:
- Create a mix of characters with VARYING closeness to the hero:
  * One should be a close friend or companion (strong relationship)
  * One should be an acquaintance or neighbor (moderate relationship)
  * One should be someone the hero barely knows or has just met (low/no relationship yet)
- Each character should be a DIFFERENT species/type from the hero and from each other.
- Each character needs 2-4 distinct personality traits that make them feel real and specific.
- Each character should have a distinct personality that contrasts with or complements the hero in an interesting way.
- Give each character a fun, memorable quirk or special detail.
- Names should be fun and age-appropriate. Include the species in the name (e.g. "Zuri the Zebra", "Pip the Parrot").
- Appearances should be vivid and visual.

Return exactly this JSON:
{
  "characters": [
    {
      "name": "Full name like Zuri the Zebra",
      "species_or_type": "Zebra",
      "personality_traits": ["funny", "loyal", "cautious"],
      "appearance": "A small, slender zebra about half the height of a lion. Round head with 2 large bright hazel eyes with round pupils, a short flat snout with a dark nose, 3 whiskers on each side of the snout, and 2 tall pointed ears on top. 2 thin arms with 3-fingered dark gray hooves. 2 slightly longer legs with rounded dark gray hooves. Short bushy black tail. Black and white striped body with one distinctive zigzag stripe on the left shoulder. Short fluffy black mane that sticks up at the front",
      "outfit": "ALWAYS WEARS AND CARRIES (never remove any item):\n- #C4A882 tan canvas satchel bag worn across the chest on a #5C3A1E brown leather strap with a small brass buckle\n- #8B7355 woven grass bracelet on right wrist",
      "special_detail": "Has one stripe that zigzags differently from all the others",
      "relationship_to_hero": "Best friends since they were young. Zuri is the cautious voice when Leo gets too adventurous."
    }
  ]
}`,
      },
    ],
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error("Character generation was truncated — response exceeded token limit. This may indicate the appearance descriptions are too long.");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }

  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const parsed: GeneratedCharacters = JSON.parse(raw);

  if (!Array.isArray(parsed.characters)) {
    throw new Error("Invalid character generation response");
  }

  debug.character(`Claude returned ${parsed.characters.length} characters`);

  for (const char of parsed.characters) {
    debug.character(`Creating: ${char.name} (${char.species_or_type})`, {
      traits: char.personality_traits.join(", "),
      relationship: char.relationship_to_hero,
    });
    const created = await prisma.character.create({
      data: {
        universeId,
        name: char.name,
        speciesOrType: char.species_or_type,
        personalityTraits: JSON.stringify(char.personality_traits),
        appearance: char.appearance,
        outfit: char.outfit || "",
        specialDetail: char.special_detail || "",
        role: "supporting",
      },
    });

    if (char.relationship_to_hero) {
      await prisma.relationship.create({
        data: {
          characterAId: hero.id,
          characterBId: created.id,
          description: char.relationship_to_hero,
        },
      });
    }
  }
}
