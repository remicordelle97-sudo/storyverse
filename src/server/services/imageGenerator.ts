import OpenAI from "openai";
import prisma from "../lib/prisma.js";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const openai = new OpenAI();

const IMAGES_DIR = path.resolve("public/images");

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

/**
 * Save a base64 image to disk and return the public URL path.
 */
function saveBase64Image(base64Data: string, format: string = "png"): string {
  const filename = `${randomUUID()}.${format}`;
  const filepath = path.join(IMAGES_DIR, filename);
  const buffer = Buffer.from(base64Data, "base64");
  fs.writeFileSync(filepath, buffer);
  return `/images/${filename}`;
}

/**
 * Build a character reference description for the prompt.
 */
async function buildCharacterReference(
  universeId: string,
  characterIds: string[]
): Promise<{ text: string; referenceImages: string[] }> {
  const characters = await prisma.character.findMany({
    where: { universeId, id: { in: characterIds } },
  });

  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
  });

  const style = universe?.illustrationStyle || "storybook";

  let text = `ART STYLE: Children's ${style} illustration, warm and friendly, consistent character designs throughout.\n\n`;
  text += `CHARACTER REFERENCE SHEET (characters must look exactly like this in every image):\n`;

  const referenceImages: string[] = [];

  for (const char of characters) {
    text += `- ${char.name}: ${char.appearance}`;
    if (char.specialDetail) {
      text += `. ${char.specialDetail}`;
    }
    text += `\n`;

    if (char.referenceImageUrl) {
      // Read the saved reference image as base64
      const imgPath = path.join("public", char.referenceImageUrl);
      if (fs.existsSync(imgPath)) {
        const imgData = fs.readFileSync(imgPath).toString("base64");
        referenceImages.push(imgData);
      }
    }
  }

  return { text, referenceImages };
}

/**
 * Generate a scene illustration using GPT-4o with optional character reference images.
 */
export async function generateImage(
  prompt: string,
  universeId?: string,
  characterIds?: string[]
): Promise<string> {
  let textPrompt = prompt;
  let referenceImages: string[] = [];

  if (universeId && characterIds?.length) {
    const ref = await buildCharacterReference(universeId, characterIds);
    textPrompt = `${ref.text}\nSCENE: ${prompt}\n\nDraw the characters EXACTLY as described in the character reference sheet. Maintain perfect visual consistency.`;
    referenceImages = ref.referenceImages;
  } else {
    textPrompt = `Children's storybook illustration, warm and friendly style: ${prompt}`;
  }

  // Build input content with optional reference images
  const content: any[] = [];

  for (const imgBase64 of referenceImages) {
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${imgBase64}`,
    });
  }

  content.push({
    type: "input_text",
    text: textPrompt,
  });

  const response = await openai.responses.create({
    model: "gpt-4o",
    input: [{ role: "user", content }],
    tools: [
      {
        type: "image_generation",
        quality: "high",
        size: "1024x1024",
        output_format: "png",
      },
    ],
  });

  // Find the image output
  const imageOutput = response.output.find(
    (item: any) => item.type === "image_generation_call"
  );

  if (!imageOutput || !("result" in imageOutput)) {
    throw new Error("No image generated");
  }

  // Save to disk and return the URL path
  return saveBase64Image(imageOutput.result as string, "png");
}

/**
 * Generate a character reference sheet image and save it to the character record.
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

Draw ONLY this one character. No background scenery. Clean, clear design that could be used as a reference for drawing this character consistently in many different scenes.`;

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

  // Save the reference image URL to the character record
  await prisma.character.update({
    where: { id: characterId },
    data: { referenceImageUrl: imageUrl },
  });

  return imageUrl;
}
