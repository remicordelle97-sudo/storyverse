import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";

const anthropic = new Anthropic();

interface GeneratedCharacter {
  name: string;
  species_or_type: string;
  personality_traits: string[];
  appearance: string;
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

CRITICAL: The "appearance" field must be a COMPLETE VISUAL SPECIFICATION — detailed enough for an illustrator to draw the character identically across 50 different images without any ambiguity. You must include ALL of the following:

BODY: Overall body shape and size (tall/short, thin/stocky/round), posture, primary body color
HEAD: Shape (round, elongated, angular), size relative to body, color
EYES: Count (how many), shape, size, color, pupil style (round, slit, compound)
NOSE/MOUTH/BEAK/SNOUT: Type and shape. If a beak: short/long, color. If a snout: pointed/flat, length
EARS: Count, shape (pointed, round, floppy, none), size, position on head
LIMBS - ARMS: Count (how many), length, thickness, color, what's at the end (hands with how many fingers, paws, claws, pincers)
LIMBS - LEGS: Count (how many), length, thickness, color, what's at the end (feet, hooves, claws, pads)
WINGS: If any — count, size relative to body, shape, color, transparency, attachment point (upper back, shoulders)
TAIL: If any — length, thickness, shape (bushy, thin, curled), color
ANTENNAE/HORNS: If any — count, shape, length, color, anything on the tips
MARKINGS: Stripes, spots, patches, scars, unique patterns and their exact locations on the body
CLOTHING: What they always wear — garment type, color, fit. This never changes between images
ACCESSORIES: Items they always carry or wear — bags, hats, scarves, goggles, jewelry

Be SPECIFIC with numbers: "2 large translucent teal wings" not just "wings". "4 short stubby legs with round orange feet" not just "legs".

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
      "appearance": "A small, slender zebra about half the height of a lion. Round head with 2 large bright hazel eyes with round pupils, a short flat snout with a dark nose, and 2 tall pointed ears on top. 2 thin arms with 3-fingered dark gray hooves. 2 slightly longer legs with rounded dark gray hooves. Short bushy black tail. Black and white striped body with one distinctive zigzag stripe on the left shoulder. Short fluffy black mane that sticks up at the front. Wears a small tan satchel bag across the chest on a brown strap",
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
