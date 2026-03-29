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

  const prompt = `Create a CHARACTER MODEL SHEET for a children's book character. Show the character 12-15 times on a plain white background in a natural, organic grid layout.

${styleGuide}

CHARACTER: ${character.name}
SPECIES: ${character.speciesOrType}
APPEARANCE: ${character.appearance}
SPECIAL DETAIL: ${character.specialDetail}

Include a MIX of the following — some full body, some close-up, at whatever scale feels natural:

FULL BODY VIEWS:
- Standing front view
- Standing side view (profile)
- Standing back view
- Standing 3/4 view
- Running
- Sitting
- Reaching up

CLOSE-UP HEAD/UPPER BODY:
- Happy expression
- Sad expression
- Surprised expression
- Determined expression
- Laughing expression

CONSISTENCY RULES:
The character must be INSTANTLY recognizable as the same individual in every single view. Specifically:
- SAME body shape, proportions, and colors in every view
- SAME number and placement of ALL features: eyes (${character.appearance.match(/\d+\s*eye/i) ? "as specified" : "2"}), ears, arms, legs, wings, tail, antennae, horns — whatever this character has. The COUNT never changes.
- If the character has WINGS: they are visible in every view including front-facing (peeking from behind) and close-ups (visible above/behind the head). Wings never disappear.
- If the character has a TAIL: visible in every view. Peeks from behind in front view.
- If the character has ANTENNAE or HORNS: visible on top of head in every view including close-ups.
- ALL clothing and accessories appear in every view. Nothing is ever removed.
- The special detail "${character.specialDetail}" is visible in every view.
- In close-up views, the HEAD SHAPE must match the full-body views exactly — same snout/beak/muzzle shape, same eye shape and size. Do not simplify the head into a circle.
- Every body part is the same exact color in all views. No lighter or darker variations.

This is ONE character drawn many times. NOT multiple different characters.`;

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
