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
  dominant_trait: string;
  contrast_with_hero: string;
  personal_want: string;
  story_function: string;
  signature_behavior: string;
  relationship_archetype: string;
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
    max_tokens: 6000,
    temperature: 0.85,
    system: `You create supporting characters for children's story universes. Each character should be distinct, memorable, and complement the hero.

=== CHARACTER DEPTH ===
Great secondary characters need more than a name and a look. For EACH character, you must provide:

- "dominant_trait": The ONE trait that defines this character above all others. Everything they do is colored by this trait. Not a list — one single word or short phrase. (e.g., "cautious to a fault", "uncontrollably curious", "stubbornly optimistic")

- "contrast_with_hero": How this character differs from the hero in a way that makes BOTH more interesting. What does this character bring out in the hero? (e.g., "Where the hero charges ahead, this character hesitates — forcing the hero to explain their reasoning and sometimes realize they're wrong")

- "personal_want": A small, specific, ongoing desire this character has for THEMSELVES — not related to the hero. This makes them feel like a real person with their own life. (e.g., "Desperately wants to taste every type of berry in the forest", "Is secretly building a tiny boat to sail across the pond someday")

- "story_function": How this character typically pushes stories forward. What narrative role do they play? (e.g., "The one who accidentally causes problems through over-enthusiasm", "The voice of caution who turns out to be right half the time", "Asks the obvious question no one else thought to ask")

- "signature_behavior": One specific, repeatable action or verbal habit that children can anticipate and join in on. This should appear in EVERY story featuring this character. (e.g., "Always counts things out loud — 'one, two, three, four — four acorns!'", "Sneezes whenever nervous", "Says 'well, technically...' before correcting someone")

- "relationship_archetype": What familiar relationship from a child's life does this character represent? (e.g., "the best friend who's always up for anything", "the cautious older sibling", "the funny classmate who gets distracted easily", "the patient grandparent figure")

=== VISUAL FIELDS ===

1. "appearance" — BODY ONLY (no clothing). Include:
  BODY, HEAD, EYES (count, shape, color), NOSE/MOUTH/BEAK, EARS, ARMS (count, fingers), LEGS (count, feet), WINGS, TAIL, ANTENNAE/HORNS, MARKINGS.
  Be SPECIFIC with numbers: "2 large translucent teal wings" not "wings"

2. "outfit" — Everything they wear/carry. Each item with hex color code, position, and details.
  Format: "ALWAYS WEARS AND CARRIES (never remove any item):" + bulleted list

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
      "dominant_trait": "cautious to a fault",
      "contrast_with_hero": "Where Leo charges ahead without thinking, Zuri stops to count the risks — which forces Leo to slow down and sometimes saves them both",
      "personal_want": "Secretly wants to cross the wide river alone someday, but is too afraid to try",
      "story_function": "The voice of caution who is right just often enough that Leo has learned to listen — but wrong just often enough that Leo still has to be brave",
      "signature_behavior": "Counts everything out loud when nervous — 'one, two, three rocks... four, five, six rocks... that is too many rocks'",
      "relationship_archetype": "the cautious best friend who worries enough for both of them",
      "appearance": "A small, slender zebra about half the height of a lion...",
      "outfit": "ALWAYS WEARS AND CARRIES (never remove any item):\n- #C4A882 tan canvas satchel bag...",
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
        dominantTrait: char.dominant_trait || "",
        contrastWithHero: char.contrast_with_hero || "",
        personalWant: char.personal_want || "",
        storyFunction: char.story_function || "",
        signatureBehavior: char.signature_behavior || "",
        relationshipArchetype: char.relationship_archetype || "",
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
