import Anthropic from "@anthropic-ai/sdk";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";

const anthropic = new Anthropic();

/**
 * Generate 6 location concepts for a universe using Claude.
 */
export async function generateLocationConcepts(
  universeId: string
): Promise<void> {
  const universe = await prisma.universe.findUniqueOrThrow({
    where: { id: universeId },
    include: { characters: true },
  });

  let themes: string[];
  try {
    themes = JSON.parse(universe.themes);
  } catch {
    themes = [universe.themes];
  }

  const hero = universe.characters.find((c) => c.role === "main");

  debug.universe("Generating location concepts via Claude", {
    universe: universe.name,
    themes: themes.join(", "),
  });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    temperature: 0.85,
    system: "You design locations for children's story universes. Return ONLY valid JSON. No markdown fences.",
    messages: [
      {
        role: "user",
        content: `Create 6 distinct locations for this children's story universe.

UNIVERSE: ${universe.name}
SETTING: ${universe.settingDescription}
THEMES: ${themes.join(", ")}
HERO: ${hero?.name || "the hero"} (${hero?.speciesOrType || "adventurer"})

Create exactly 6 locations with these roles:
1. HOME BASE — Where the hero lives. Safe, cozy, familiar. Stories begin and end here.
2. GATHERING PLACE — Where characters meet and socialize. Central, welcoming.
3. ADVENTURE PATH — A route or trail between places. Used in journey stories.
4. DISCOVERY ZONE — Where surprises and new things are found. Exciting, wondrous.
5. CHALLENGE AREA — Where tension rises. Problems to solve. Slightly intimidating but not scary.
6. QUIET RETREAT — A peaceful, reflective spot. Used for calm moments and story endings.

For each location provide:
- A specific, evocative name (not generic)
- A vivid 2-3 sentence description with specific visual details (colors, textures, shapes, sounds)
- The role (home, gathering, path, discovery, challenge, retreat)
- The dominant mood/feeling
- The typical lighting (time of day, quality of light)
- Key landmarks (2-3 specific visual anchors that must appear every time this location is drawn)

Return exactly this JSON:
{
  "locations": [
    {
      "name": "Location name",
      "description": "Vivid 2-3 sentence description",
      "role": "home",
      "mood": "cozy and warm",
      "lighting": "warm afternoon sunlight filtering through leaves",
      "landmarks": "A giant hollow baobab tree with a round blue door, a small vegetable garden with orange flowers, a wooden swing hanging from the lowest branch"
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

  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.locations)) {
    throw new Error("Invalid location generation response");
  }

  debug.universe(`Claude generated ${parsed.locations.length} locations`);

  for (const loc of parsed.locations) {
    debug.universe(`Creating location: ${loc.name} (${loc.role})`);
    await prisma.location.create({
      data: {
        universeId,
        name: loc.name,
        description: loc.description,
        role: loc.role,
        mood: loc.mood || "",
        lighting: loc.lighting || "",
        landmarks: loc.landmarks || "",
      },
    });
  }
}
