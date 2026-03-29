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
  previousPageImageUrl?: string,
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

  // Previous page image for scenery/style continuity
  if (previousPageImageUrl) {
    const prevImgData = readImageAsBase64(previousPageImageUrl);
    if (prevImgData) {
      content.push({
        type: "input_image",
        image_url: `data:image/png;base64,${prevImgData}`,
      });
      content.push({
        type: "input_text",
        text: "The image above is the previous page's illustration. Match its art style, color palette, lighting, and character appearances exactly. The new scene should feel like the next page of the same book.",
      });
    }
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
 * Generate a character reference sheet image.
 */
export async function generateCharacterReference(
  characterId: string
): Promise<string> {
  const character = await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    include: { universe: true },
  });

  const style = character.universe.illustrationStyle || "storybook";

  const prompt = `Create a character reference sheet for a children's ${style} illustration. Show the character from the front, clearly and fully visible against a simple white background.

CHARACTER: ${character.name}
SPECIES: ${character.speciesOrType}
APPEARANCE: ${character.appearance}
SPECIAL DETAIL: ${character.specialDetail}

Draw ONLY this one character, centered in the frame. No background scenery. Clean, clear design that an illustrator could use as a reference for drawing this character consistently across many different scenes.`;

  const response = await openai.responses.create({
    model: "gpt-4o",
    input: prompt,
    tools: [
      {
        type: "image_generation",
        quality: "high",
        size: "1024x1024",
        output_format: "png",
        background: "transparent" as any,
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

  return imageUrl;
}
