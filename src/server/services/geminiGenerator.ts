import { GoogleGenAI } from "@google/genai";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { buildImageStyleGuide } from "./imageStyleGuide.js";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_KEY });

const IMAGES_DIR = path.resolve("public/images");

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function saveBase64Image(base64Data: string, mimeType: string = "image/png"): string {
  const ext = mimeType.includes("webp") ? "webp" : mimeType.includes("jpeg") ? "jpg" : "png";
  const filename = `${randomUUID()}.${ext}`;
  const filepath = path.join(IMAGES_DIR, filename);
  const buffer = Buffer.from(base64Data, "base64");
  fs.writeFileSync(filepath, buffer);
  return `/images/${filename}`;
}

function readImageAsBase64(imageUrl: string): { data: string; mimeType: string } | null {
  const imgPath = path.join("public", imageUrl);
  if (!fs.existsSync(imgPath)) return null;
  const data = fs.readFileSync(imgPath).toString("base64");
  const ext = path.extname(imgPath).slice(1);
  const mimeType = ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return { data, mimeType };
}

/**
 * Extract the generated image from a Gemini response.
 */
function extractImage(response: any): string | null {
  const candidates = response?.candidates;
  if (!candidates?.[0]?.content?.parts) return null;

  for (const part of candidates[0].content.parts) {
    if (part.inlineData?.data) {
      return saveBase64Image(part.inlineData.data, part.inlineData.mimeType || "image/png");
    }
  }
  return null;
}

/**
 * Build reference image parts for Gemini from character and location sheets.
 */
async function buildReferenceParts(
  universeId: string,
  characterIds?: string[]
): Promise<any[]> {
  const parts: any[] = [];

  // Character reference sheets
  const charWhere: any = { universeId, referenceImageUrl: { not: "" } };
  if (characterIds?.length) {
    charWhere.id = { in: characterIds };
  }
  const characters = await prisma.character.findMany({ where: charWhere });

  for (const char of characters) {
    const img = readImageAsBase64(char.referenceImageUrl);
    if (img) {
      parts.push({
        inlineData: { data: img.data, mimeType: img.mimeType },
      });
      parts.push({
        text: `Reference sheet for ${char.name} (${char.speciesOrType}). Body: ${char.appearance}. ${char.outfit ? `Outfit: ${char.outfit}` : ""} ${char.specialDetail ? `Key detail: ${char.specialDetail}` : ""}`,
      });
    }
  }

  // Location reference sheets
  const locations = await prisma.location.findMany({
    where: { universeId, referenceImageUrl: { not: "" } },
  });

  for (const loc of locations) {
    const img = readImageAsBase64(loc.referenceImageUrl);
    if (img) {
      parts.push({
        inlineData: { data: img.data, mimeType: img.mimeType },
      });
      parts.push({
        text: `Reference sheet for location "${loc.name}" (${loc.role}): ${loc.description}`,
      });
    }
  }

  return parts;
}

/**
 * Generate a character model sheet using Gemini.
 */
export async function generateCharacterSheet(
  characterId: string,
  previousSheetUrls: string[] = []
): Promise<string> {
  const character = await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    include: { universe: true },
  });

  const styleGuide = buildImageStyleGuide(
    character.universe.mood,
    "4-5",
    character.universe.illustrationStyle
  );

  debug.image(`Generating character sheet for "${character.name}" via Gemini`);
  const startTime = Date.now();

  const outfitSection = character.outfit
    ? `\nOUTFIT (character is ALWAYS wearing/carrying ALL of these):\n${character.outfit}`
    : "";

  const prompt = `Create a CHARACTER MODEL SHEET. Show this character 12-15 times on a plain white background in a natural grid layout. Mix of full body views and close-up head/upper body views.

${styleGuide}

CHARACTER: ${character.name}
SPECIES: ${character.speciesOrType}

BODY: ${character.appearance}
${outfitSection}
SPECIAL DETAIL: ${character.specialDetail}

Include:
- Full body: front, side, back, 3/4, running, sitting, reaching
- Close-up: happy, sad, surprised, determined, laughing

CONSISTENCY: The character must look identical in every view. Same proportions, colors, features. All clothing/accessories visible in every view. Wings, tails, antennae never disappear. Head shape stays the same in close-ups.

ONE character drawn many times. NOT multiple characters.`;

  // Build input parts
  const parts: any[] = [];

  // Pass previous sheets as style reference
  for (const sheetUrl of previousSheetUrls) {
    const img = readImageAsBase64(sheetUrl);
    if (img) {
      parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
    }
  }

  if (previousSheetUrls.length > 0) {
    parts.push({
      text: `The images above are character sheets from the same book. Match their exact art style, line quality, and color approach. The new character should look like it was drawn by the same illustrator.`,
    });
  }

  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-04-17",
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["Image", "Text"],
    },
  });

  const imageUrl = extractImage(response);
  if (!imageUrl) {
    throw new Error("No image generated by Gemini for character sheet");
  }

  await prisma.character.update({
    where: { id: characterId },
    data: { referenceImageUrl: imageUrl },
  });

  debug.image(`Character sheet for "${character.name}" done in ${Date.now() - startTime}ms: ${imageUrl}`);
  return imageUrl;
}

/**
 * Generate a location reference sheet using Gemini.
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

  debug.image(`Generating location sheet for "${location.name}" via Gemini`);
  const startTime = Date.now();

  const prompt = `Create a LOCATION REFERENCE SHEET. Show this location 8-10 times on a plain white background.

${styleGuide}

LOCATION: ${location.name}
ROLE: ${location.role}
DESCRIPTION: ${location.description}
MOOD: ${location.mood}
LIGHTING: ${location.lighting}
KEY LANDMARKS (must appear every time): ${location.landmarks}

Include:
- Wide panoramic view
- Medium view at character scale
- Close-up of key landmark
- Morning light version
- Afternoon/golden hour version
- Night/dusk version
- View from approaching
- View from inside/center looking out

CONSISTENCY: Same landmarks, geography, and colors across all views. No characters. Environment only.

ONE location shown from many angles and times of day. NOT multiple locations.`;

  const parts: any[] = [];

  for (const sheetUrl of previousSheetUrls) {
    const img = readImageAsBase64(sheetUrl);
    if (img) {
      parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
    }
  }

  if (previousSheetUrls.length > 0) {
    parts.push({
      text: `The images above are reference sheets from the same book. Match their exact art style.`,
    });
  }

  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-04-17",
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["Image", "Text"],
    },
  });

  const imageUrl = extractImage(response);
  if (!imageUrl) {
    throw new Error("No image generated by Gemini for location sheet");
  }

  await prisma.location.update({
    where: { id: locationId },
    data: { referenceImageUrl: imageUrl },
  });

  debug.image(`Location sheet for "${location.name}" done in ${Date.now() - startTime}ms: ${imageUrl}`);
  return imageUrl;
}

/**
 * Generate a scene illustration using Gemini with reference images
 * and previous page context for consistency.
 */
export async function generateSceneImage(
  scenePrompt: string,
  universeId: string,
  characterIds: string[],
  mood: string,
  ageGroup: string,
  previousPageImageUrls: string[] = []
): Promise<string> {
  const styleGuide = buildImageStyleGuide(mood, ageGroup);

  // Build character descriptions
  const characters = await prisma.character.findMany({
    where: { universeId, id: { in: characterIds } },
  });

  let charDesc = "";
  for (const char of characters) {
    charDesc += `${char.name} (${char.speciesOrType}): ${char.appearance}`;
    if (char.outfit) charDesc += `. Outfit: ${char.outfit}`;
    if (char.specialDetail) charDesc += `. ${char.specialDetail}`;
    charDesc += "\n";
  }

  // Build location descriptions
  const locations = await prisma.location.findMany({ where: { universeId } });
  let locDesc = "";
  for (const loc of locations) {
    locDesc += `${loc.name}: ${loc.description}`;
    if (loc.landmarks) locDesc += ` Landmarks: ${loc.landmarks}`;
    locDesc += "\n";
  }

  const prompt = `${styleGuide}

CHARACTERS:\n${charDesc}
${locDesc ? `LOCATIONS:\n${locDesc}` : ""}
SCENE: ${scenePrompt}

Draw the characters EXACTLY as shown in the reference sheets. Match the art style, proportions, colors, and outfits precisely. All clothing and accessories must be present.`;

  // Build parts: reference sheets + previous pages + prompt
  const parts: any[] = [];

  // Character and location reference sheets
  const refParts = await buildReferenceParts(universeId, characterIds);
  parts.push(...refParts);

  // Previous pages for continuity (last 3)
  const recentPages = previousPageImageUrls.slice(-3);
  for (const pageUrl of recentPages) {
    const img = readImageAsBase64(pageUrl);
    if (img) {
      parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
    }
  }

  if (recentPages.length > 0) {
    parts.push({
      text: `The previous ${recentPages.length} image(s) are illustrations from earlier pages of this same story. Match their art style, color palette, lighting, character appearances, and scenery exactly. The new illustration should feel like the next page of the same book.`,
    });
  }

  parts.push({ text: prompt });

  debug.image(`Gemini scene: ${parts.filter(p => p.inlineData).length} reference images, prompt ${prompt.length} chars`);
  const startTime = Date.now();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-04-17",
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["Image", "Text"],
      imageConfig: {
        aspectRatio: "4:3",
      },
    },
  });

  const imageUrl = extractImage(response);
  if (!imageUrl) {
    throw new Error("No scene image generated by Gemini");
  }

  debug.image(`Gemini scene done in ${Date.now() - startTime}ms: ${imageUrl}`);
  return imageUrl;
}
