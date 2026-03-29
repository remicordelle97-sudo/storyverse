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

  const prompt = `Create a CHARACTER MODEL SHEET for a children's book character. This is a reference sheet that an illustrator would use to draw this character consistently across many pages.

${styleGuide}

CHARACTER DETAILS:
Name: ${character.name}
Species: ${character.speciesOrType}
Appearance: ${character.appearance}
Special detail that must ALWAYS be visible: ${character.specialDetail}
Role: ${character.role}

LAYOUT — Show ALL of the following on a single sheet, arranged in a clear grid on a plain white background:

ROW 1 — TURNAROUND (4 views, same pose):
- Front view (facing camera)
- 3/4 view (turned slightly left)
- Side view (profile, facing right)
- Back view

ROW 2 — EXPRESSIONS (5 faces, head and shoulders only):
- Happy (big smile, bright eyes)
- Sad (drooping features, downcast eyes)
- Surprised (wide eyes, open mouth)
- Determined (focused eyes, set jaw)
- Laughing (eyes squeezed, mouth open)

ROW 3 — ACTION POSES (4 full body poses):
- Running/moving quickly
- Sitting down, relaxed
- Reaching up for something
- Interacting with a friend (gesturing, talking)

CRITICAL RULES:
- The character must look IDENTICAL in every pose and expression — same proportions, same colors, same markings, same accessories.
- The special detail (${character.specialDetail}) must be visible in every single view.
- Plain white background. No scenery, no props, no other characters.
- Label each view with small text underneath (e.g., "FRONT", "SIDE", "HAPPY", "RUNNING").
- Use clean, consistent line work throughout.
- This is ONE character shown many times, NOT multiple characters.`;

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
