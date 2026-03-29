import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { buildImageStyleGuide } from "./imageStyleGuide.js";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const anthropic = new Anthropic();
const openai = new OpenAI();

const IMAGES_DIR = path.resolve("public/images");

function saveBase64Image(base64Data: string, format: string = "png"): string {
  const filename = `${randomUUID()}.${format}`;
  const filepath = path.join(IMAGES_DIR, filename);
  const buffer = Buffer.from(base64Data, "base64");
  fs.writeFileSync(filepath, buffer);
  return `/images/${filename}`;
}

interface GeneratedLocation {
  name: string;
  description: string;
  role: string;
  mood: string;
  lighting: string;
  landmarks: string;
}

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
MOOD: ${universe.mood}
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

/**
 * Generate a location reference sheet using GPT-4o.
 * Shows the location from multiple angles, times of day, and with key landmarks.
 */
export async function generateLocationSheet(
  locationId: string,
  previousSheetUrls: string[] = []
): Promise<string> {
  const location = await prisma.location.findUniqueOrThrow({
    where: { id: locationId },
    include: { universe: true },
  });

  const styleGuide = buildImageStyleGuide(
    location.universe.mood,
    "4-5",
    location.universe.illustrationStyle
  );

  debug.image(`Generating location sheet for "${location.name}" (${location.role})`);
  const startTime = Date.now();

  const prompt = `Create a LOCATION REFERENCE SHEET for a children's book environment. This is a reference sheet that an illustrator would use to draw this location consistently across many pages.

${styleGuide}

LOCATION DETAILS:
Name: ${location.name}
Role in stories: ${location.role}
Description: ${location.description}
Mood/feeling: ${location.mood}
Typical lighting: ${location.lighting}
Key landmarks (MUST appear every time): ${location.landmarks}

LAYOUT — Show ALL of the following on a single sheet, arranged in a clear grid:

ROW 1 — ESTABLISHING SHOTS (3 views):
- Wide panoramic view showing the full location and its surroundings
- Medium view at character scale showing where characters would stand and interact
- Close-up detail of the most important landmark feature

ROW 2 — LIGHTING VARIATIONS (3 views, same angle):
- Morning (cool blue-pink light, misty, long shadows)
- Afternoon (warm golden light, bright and clear)
- Night/sunset (warm oranges and deep blues, atmospheric, possibly with stars or lanterns)

ROW 3 — ANGLES (3 views):
- Approaching from a distance (what a character sees arriving)
- Looking outward from inside/center of the location
- Slightly elevated view showing the layout and spatial relationships

CRITICAL RULES:
- The key landmarks (${location.landmarks}) must be visible and recognizable in EVERY view.
- Maintain consistent geography — if the river is on the left in one view, it's on the left in all views from the same direction.
- The overall color palette and mood must be consistent across all views.
- No characters in any view. Environment only.
- Label each view with small text underneath.
- This is ONE location shown from many perspectives, NOT multiple locations.`;

  const content: any[] = [];

  // Pass previous location/character sheets for style consistency
  for (const sheetUrl of previousSheetUrls) {
    const imgPath = path.join("public", sheetUrl);
    if (fs.existsSync(imgPath)) {
      const imgData = fs.readFileSync(imgPath).toString("base64");
      content.push({
        type: "input_image",
        image_url: `data:image/png;base64,${imgData}`,
      });
    }
  }

  if (previousSheetUrls.length > 0) {
    content.push({
      type: "input_text",
      text: `The ${previousSheetUrls.length} image(s) above are reference sheets from the same book (characters and/or other locations). Match their exact art style, color approach, line quality, and texture. The new location should look like it belongs in the same world.`,
    });
  }

  content.push({
    type: "input_text",
    text: prompt,
  });

  const response = await openai.responses.create({
    model: "gpt-4o",
    input: [{ role: "user", content }],
    tools: [
      {
        type: "image_generation",
        quality: "high",
        size: "1536x1024" as any,
        output_format: "png",
      },
    ],
  });

  const imageOutput = response.output.find(
    (item: any) => item.type === "image_generation_call"
  );

  if (!imageOutput || !("result" in imageOutput)) {
    throw new Error("No location sheet generated");
  }

  const imageUrl = saveBase64Image(imageOutput.result as string, "png");

  await prisma.location.update({
    where: { id: locationId },
    data: { referenceImageUrl: imageUrl },
  });

  debug.image(`Location sheet for "${location.name}" done in ${Date.now() - startTime}ms`);

  return imageUrl;
}
