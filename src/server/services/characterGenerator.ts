import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma.js";

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
    max_tokens: 2000,
    temperature: 0.85,
    system: `You create supporting characters for children's story universes. Each character should be distinct, memorable, and complement the hero.

IMPORTANT: The "appearance" field must be detailed enough for an illustrator to draw the character consistently across many images. Include: body size/build, primary colors, distinguishing physical features (spots, stripes, scars, markings), eye color, and any clothing or accessories they always wear. Be specific, not vague.

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
      "appearance": "A small, slender zebra with bright hazel eyes, an expressive face, black and white stripes with one distinctive zigzag stripe on the left shoulder, and a short fluffy mane that sticks up at the front",
      "special_detail": "Has one stripe that zigzags differently from all the others",
      "relationship_to_hero": "Best friends since they were young. Zuri is the cautious voice when Leo gets too adventurous."
    }
  ]
}`,
      },
    ],
  });

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

  for (const char of parsed.characters) {
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
