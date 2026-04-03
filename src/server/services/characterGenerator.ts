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
  personal_want: string;
  signature_behavior: string;
  contrast_with_hero: string;
  story_function: string;
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
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    temperature: 0.85,
    system: `You design complete character ensembles for children's story universes. You generate both the hero and supporting cast together so they work as a group — contrasting species, complementary personalities, and distinct visual designs.

=== CHARACTER DEPTH (required for ALL characters) ===

- "dominant_trait": The ONE trait that defines this character above all others. Everything they do is colored by this trait. Not a list — one single word or short phrase. (e.g., "cautious to a fault", "uncontrollably curious", "stubbornly optimistic")

- "personal_want": A small, specific, ongoing desire this character has for THEMSELVES. This makes them feel like a real person with their own life. (e.g., "Desperately wants to taste every type of berry in the forest", "Is secretly building a tiny boat to sail across the pond someday")

- "signature_behavior": One specific, repeatable action or verbal habit that children can anticipate and join in on. This should appear in EVERY story featuring this character. (e.g., "Always counts things out loud — 'one, two, three, four — four acorns!'", "Sneezes whenever nervous", "Says 'well, technically...' before correcting someone")

For SUPPORTING characters only:
- "contrast_with_hero": How this character differs from the hero in a way that makes BOTH more interesting. What does this character bring out in the hero?
- "story_function": How this character typically pushes stories forward. What narrative role do they play?
- "relationship_archetype": What familiar relationship from a child's life does this character represent? (e.g., "the best friend who's always up for anything", "the cautious older sibling")

=== VISUAL FIELDS (required for ALL characters) ===

1. "appearance" — BODY ONLY (no clothing). A COMPLETE VISUAL SPECIFICATION detailed enough for an illustrator to draw the character identically across 50 different images. Include ALL of:
  BODY (shape, size, posture, primary color), HEAD (shape, size relative to body), EYES (count, shape, size, color, pupil style), NOSE/MOUTH/BEAK/SNOUT (type, shape, color), EARS (count, shape, size, position — or "none"), ARMS (count, length, thickness, color, what's at the end — hands/paws/claws, finger count), LEGS (count, length, thickness, color, feet/hooves/claws), WINGS (count, size, shape, color, transparency — or "none"), TAIL (length, shape, color — or "none"), ANTENNAE/HORNS (count, shape, length — or "none"), MARKINGS (stripes, spots, patterns, locations on body).
  Be SPECIFIC with numbers: "2 large translucent teal wings" not "wings".
  If the character has WHISKERS, specify: count per side, length, color.

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
- The FIRST character must be the hero "${heroName}" with role "main". Choose an appropriate species/type for them based on the universe.
- Create 3 supporting characters with role "supporting".
- ALL characters should be DIFFERENT species/types from each other.
- Design them as an ensemble — their species, personalities, and looks should contrast and complement each other.
- The supporting characters should have VARYING closeness to the hero:
  * One should be a close friend or companion (strong relationship)
  * One should be an acquaintance or neighbor (moderate relationship)
  * One should be someone the hero barely knows or has just met (low/no relationship yet)
- Each character needs 2-4 distinct personality traits.
- Names should be fun and age-appropriate. Include the species in the name (e.g., "Zuri the Zebra", "Pip the Parrot"). The hero's name is "${heroName}" — add their species to it.
- For the hero: leave contrast_with_hero, story_function, and relationship_archetype as empty strings.
- For supporting characters: fill in contrast_with_hero, story_function, and relationship_archetype.

Return exactly this JSON:
{
  "characters": [
    {
      "name": "${heroName} the [Species]",
      "species_or_type": "Species",
      "role": "main",
      "personality_traits": ["trait1", "trait2", "trait3"],
      "dominant_trait": "one defining trait",
      "personal_want": "a specific ongoing desire",
      "signature_behavior": "a repeatable action or verbal habit",
      "contrast_with_hero": "",
      "story_function": "",
      "relationship_archetype": "",
      "appearance": "Complete body-only visual specification...",
      "outfit": "ALWAYS WEARS AND CARRIES (never remove any item):\\n- #hex item...",
      "special_detail": "a fun memorable quirk"
    },
    {
      "name": "Full name like Zuri the Zebra",
      "species_or_type": "Zebra",
      "role": "supporting",
      "personality_traits": ["trait1", "trait2", "trait3"],
      "dominant_trait": "...",
      "personal_want": "...",
      "signature_behavior": "...",
      "contrast_with_hero": "...",
      "story_function": "...",
      "relationship_archetype": "...",
      "appearance": "...",
      "outfit": "...",
      "special_detail": "..."
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
      dominantTrait: heroData.dominant_trait,
    });
    await prisma.character.update({
      where: { id: heroPlaceholder.id },
      data: {
        name: heroData.name,
        speciesOrType: heroData.species_or_type,
        personalityTraits: JSON.stringify(heroData.personality_traits),
        appearance: heroData.appearance,
        outfit: heroData.outfit || "",
        specialDetail: heroData.special_detail || "",
        dominantTrait: heroData.dominant_trait || "",
        personalWant: heroData.personal_want || "",
        signatureBehavior: heroData.signature_behavior || "",
      },
    });
  }

  // Create supporting characters
  const supporting = parsed.characters.filter((c) => c.role === "supporting");
  for (const char of supporting) {
    debug.character(`Creating: ${char.name} (${char.species_or_type})`, {
      traits: char.personality_traits.join(", "),
      dominantTrait: char.dominant_trait,
    });
    await prisma.character.create({
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
  }
}
