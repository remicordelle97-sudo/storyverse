import OpenAI from "openai";
import prisma from "../lib/prisma.js";
import { buildImageStyleGuide } from "./imageStyleGuide.js";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const openai = new OpenAI();

const IMAGES_DIR = path.resolve("public/images");

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function saveBase64Image(base64Data: string, format: string = "png"): string {
  const filename = `${randomUUID()}.${format}`;
  const filepath = path.join(IMAGES_DIR, filename);
  const buffer = Buffer.from(base64Data, "base64");
  fs.writeFileSync(filepath, buffer);
  return `/images/${filename}`;
}

function readImageAsBase64(imageUrl: string): string | null {
  const imgPath = path.join("public", imageUrl);
  if (fs.existsSync(imgPath)) {
    return fs.readFileSync(imgPath).toString("base64");
  }
  return null;
}

/**
 * Build a complete, deterministic character description for image prompts.
 * This is injected server-side so we don't rely on Claude's wording.
 */
async function buildImageContext(
  universeId: string,
  characterIds: string[],
  mood: string,
  ageGroup: string
): Promise<{ prompt: string; referenceImages: string[] }> {
  const characters = await prisma.character.findMany({
    where: { universeId, id: { in: characterIds } },
  });

  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
  });

  const referenceImages: string[] = [];

  // Full style guide based on mood, age group, and illustration style
  let prompt = buildImageStyleGuide(
    mood,
    ageGroup,
    universe?.illustrationStyle
  );

  prompt += `=== CHARACTER SHEET ===\nDraw each character EXACTLY as described. Same proportions, colors, markings, and accessories in every image.\n\n`;

  for (const char of characters) {
    prompt += `${char.name}:\n`;
    prompt += `  Species: ${char.speciesOrType}\n`;
    prompt += `  Appearance: ${char.appearance}\n`;
    if (char.specialDetail) {
      prompt += `  Key detail (MUST be visible): ${char.specialDetail}\n`;
    }
    prompt += `\n`;

    if (char.referenceImageUrl) {
      const imgData = readImageAsBase64(char.referenceImageUrl);
      if (imgData) {
        referenceImages.push(imgData);
      }
    }
  }

  return { prompt, referenceImages };
}

/**
 * Generate a scene illustration with character references and optional
 * previous page image for scenery/style continuity.
 */
export async function generateImage(
  scenePrompt: string,
  universeId: string,
  characterIds: string[],
  mood: string,
  ageGroup: string,
  previousPageImageUrls: string[] = [],
  quality: "low" | "medium" | "high" = "high"
): Promise<string> {
  const context = await buildImageContext(universeId, characterIds, mood, ageGroup);

  const fullPrompt = `${context.prompt}SCENE TO ILLUSTRATE:\n${scenePrompt}\n\nIMPORTANT: Characters must match their descriptions and reference images exactly. Maintain the same art style, color palette, and proportions as the reference images.`;

  // Build input content: reference images first, then previous page, then prompt
  const content: any[] = [];

  // Character reference images
  for (const imgBase64 of context.referenceImages) {
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${imgBase64}`,
    });
  }

  // Previous page images for scenery/style/character continuity (last 3 max)
  const recentPages = previousPageImageUrls.slice(-3);
  if (recentPages.length > 0) {
    for (const pageUrl of recentPages) {
      const imgData = readImageAsBase64(pageUrl);
      if (imgData) {
        content.push({
          type: "input_image",
          image_url: `data:image/png;base64,${imgData}`,
        });
      }
    }
    content.push({
      type: "input_text",
      text: `The ${recentPages.length} image(s) above are illustrations from the previous pages of this same book. You MUST match them exactly in: art style, color palette, lighting direction, character appearances and proportions, and scenery/environment details. If the scene takes place in the same location as a previous page, the environment must look the same (same trees, same buildings, same colors, same sky). The new illustration should feel like the next page of the same book by the same illustrator.`,
    });
  }

  content.push({
    type: "input_text",
    text: fullPrompt,
  });

  const response = await openai.responses.create({
    model: "gpt-4o",
    input: [{ role: "user", content }],
    tools: [
      {
        type: "image_generation",
        quality,
        size: "1024x1024",
        output_format: "png",
      },
    ],
  });

  const imageOutput = response.output.find(
    (item: any) => item.type === "image_generation_call"
  );

  if (!imageOutput || !("result" in imageOutput)) {
    throw new Error("No image generated");
  }

  return saveBase64Image(imageOutput.result as string, "png");
}

/**
 * Generate a multi-pose character reference sheet.
 *
 * Creates a single large image with the character shown from multiple
 * angles, expressions, and poses — like a professional animation model sheet.
 *
 * @param characterId - The character to generate a sheet for
 * @param previousSheetUrls - Reference sheets of already-generated characters
 *   (passed as input images so GPT-4o matches the art style)
 */
export async function generateCharacterReference(
  characterId: string,
  previousSheetUrls: string[] = []
): Promise<string> {
  const character = await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    include: { universe: true },
  });

  const { debug } = await import("../lib/debug.js");
  const { buildImageStyleGuide } = await import("./imageStyleGuide.js");

  const styleGuide = buildImageStyleGuide(
    character.universe.mood,
    "4-5", // Use middle age group for character design
    character.universe.illustrationStyle
  );

  // Build a detailed feature checklist from the character's description
  const featureChecklist = [
    character.appearance,
    character.specialDetail,
  ]
    .filter(Boolean)
    .join(". ");

  const prompt = `Create a CHARACTER MODEL SHEET for a children's book character.

${styleGuide}

CHARACTER: ${character.name}
SPECIES: ${character.speciesOrType}
APPEARANCE: ${character.appearance}
SPECIAL DETAIL: ${character.specialDetail}

=== MANDATORY FEATURE CHECKLIST ===
The following features MUST be visible in ALL 13 views. Before finalizing each view, verify every item on this list is present:
${featureChecklist.split(/[.,;]/).filter(s => s.trim().length > 3).map(s => `  CHECK: ${s.trim()}`).join("\n")}

=== LAYOUT: Exactly 3 rows, exactly 13 views total ===

ROW 1 — TURNAROUND — exactly 4 views, all the same size, neutral standing pose:
  View 1: FRONT — facing the camera directly, arms at sides
  View 2: THREE-QUARTER — body turned 45 degrees to the left
  View 3: SIDE — full profile facing right
  View 4: BACK — facing away from camera
  Labels underneath: "FRONT" "3/4" "SIDE" "BACK"

ROW 2 — EMOTIONS — exactly 5 views, same size as Row 1, full body head-to-toe:
  View 5: HAPPY — smiling, open posture, arms slightly out
  View 6: SAD — shoulders slumped, head down, arms hanging
  View 7: SURPRISED — leaning back, hands up, eyes wide
  View 8: DETERMINED — leaning forward, fists clenched, brow focused
  View 9: LAUGHING — body bent forward, hands on belly
  Labels underneath: "HAPPY" "SAD" "SURPRISED" "DETERMINED" "LAUGHING"

ROW 3 — ACTIONS — exactly 4 views, same size as Row 1, full body:
  View 10: RUNNING — mid-stride, one foot off ground, arms pumping
  View 11: SITTING — seated on the ground, legs crossed or extended
  View 12: REACHING — standing on tiptoes, one arm stretched up high
  View 13: TALKING — turned slightly toward an invisible friend, one hand gesturing
  Labels underneath: "RUNNING" "SITTING" "REACHING" "TALKING"

=== STRICT RULES ===

LAYOUT RULES:
- Exactly 3 rows. Exactly 13 views total (4 + 5 + 4).
- All views are FULL BODY — head to feet. Same scale. Same size.
- NO merging rows. Row 1 is turnaround ONLY. Row 2 is emotions ONLY. Row 3 is actions ONLY.
- NO skipping views. All 13 must be present. NO duplicates.
- Each view has a text label underneath it. Labels must match the ones specified above exactly.
- Clear visual separation between the 3 rows (a thin line or extra spacing).

FEATURE RULES:
- The character must look IDENTICAL in all 13 views. Same body shape, same proportions, same colors.
- If the character has WINGS, they must be visible in all 13 views — including from the front (where wings peek out from behind the body). Wings do not disappear when the character sits or runs.
- If the character has a TAIL, it must be visible in all 13 views.
- If the character has ANTENNAE, HORNS, EARS, or any HEAD FEATURES, they appear in all 13 views.
- If the character wears CLOTHING or ACCESSORIES (cloaks, scarves, backpacks, goggles, hats), they appear in all 13 views. Clothing does not disappear in action poses.
- The special detail "${character.specialDetail}" must be clearly visible in all 13 views.

BACKGROUND: Plain white. No scenery. No props. No other characters (except in View 13 "TALKING" which may show a simple silhouette outline of a friend, but NOT a fully drawn second character).

This is ONE character drawn 13 times in different poses. NOT 13 different characters.`;

  // Build input content with optional previous character sheets
  const content: any[] = [];

  // Pass previous character sheets so GPT-4o matches the art style
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
      text: `The ${previousSheetUrls.length} image(s) above are character model sheets for OTHER characters in the same book. You MUST match their exact art style, line quality, color approach, and proportions. The new character should look like it was drawn by the same illustrator.`,
    });
  }

  content.push({
    type: "input_text",
    text: prompt,
  });

  debug.image(`Generating multi-pose model sheet for "${character.name}" (with ${previousSheetUrls.length} previous sheets as style reference)`);

  const response = await openai.responses.create({
    model: "gpt-4o",
    input: [{ role: "user", content }],
    tools: [
      {
        type: "image_generation",
        quality: "high",
        size: "1536x1024" as any, // Wide format for the grid layout
        output_format: "png",
      },
    ],
  });

  const imageOutput = response.output.find(
    (item: any) => item.type === "image_generation_call"
  );

  if (!imageOutput || !("result" in imageOutput)) {
    throw new Error("No reference image generated");
  }

  const imageUrl = saveBase64Image(imageOutput.result as string, "png");

  await prisma.character.update({
    where: { id: characterId },
    data: { referenceImageUrl: imageUrl },
  });

  debug.image(`Model sheet saved for "${character.name}": ${imageUrl}`);

  return imageUrl;
}
