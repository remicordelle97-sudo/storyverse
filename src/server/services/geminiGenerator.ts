import { GoogleGenAI } from "@google/genai";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import { ART_STYLE, ART_STYLE_REMINDER, buildImageStyleGuide } from "./imageStyleGuide.js";
import { MOODS } from "../lib/config.js";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_KEY });

const IMAGE_MODEL = "gemini-3-pro-image-preview";
const IMAGE_SIZE = "1K";

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
  const result = extractImageWithData(response);
  return result ? result.url : null;
}

function extractImageWithData(response: any): { url: string; data: string; mimeType: string } | null {
  const candidates = response?.candidates;
  if (!candidates?.[0]?.content?.parts) return null;

  for (const part of candidates[0].content.parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      const url = saveBase64Image(part.inlineData.data, mimeType);
      return { url, data: part.inlineData.data, mimeType };
    }
  }
  return null;
}


/**
 * Generate a style reference image for a universe — a simple scene with
 * no characters that establishes the visual style for all illustrations.
 * Stored on the Universe record and passed to character sheets, location
 * sheets, and story page generation as a visual anchor.
 */
export async function generateStyleReference(
  universeId: string
): Promise<string> {
  const universe = await prisma.universe.findUniqueOrThrow({
    where: { id: universeId },
  });

  debug.image(`Generating style reference for universe "${universe.name}"`);
  const startTime = Date.now();

  const prompt = `${ART_STYLE}

Generate a single illustration of a scene from this world. This image will be used as the STYLE REFERENCE for an entire children's picture book — every illustration in the book must match this exact visual style.

UNIVERSE: ${universe.name}
SETTING: ${universe.settingDescription}
${universe.scaleAndGeography ? `GEOGRAPHY: ${universe.scaleAndGeography}` : ""}

RULES:
- Show a simple, atmospheric landscape or environment from this world
- Do NOT include any characters, people, or animals
- Focus on establishing the ART STYLE: brushwork, color palette, texture, lighting, level of detail
- This should feel like the opening establishing shot of a picture book — warm, inviting, setting the mood
- Make it rich enough in style detail that an artist could match it exactly`;

  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: ["Image", "Text"],
      imageConfig: {
        imageSize: IMAGE_SIZE,
      },
    },
  });

  const imageUrl = extractImage(response);
  if (!imageUrl) {
    throw new Error("No image generated for style reference");
  }

  await prisma.universe.update({
    where: { id: universeId },
    data: { styleReferenceUrl: imageUrl },
  });

  debug.image(`Style reference generated in ${Date.now() - startTime}ms: ${imageUrl}`);
  return imageUrl;
}

/**
 * Load the style reference image for a universe as base64 inline data.
 * Returns null if no style reference exists.
 */
function loadStyleReference(universe: any): { data: string; mimeType: string } | null {
  if (!universe.styleReferenceUrl) return null;
  return readImageAsBase64(universe.styleReferenceUrl);
}

/**
 * Generate a single character model sheet using Gemini (for regeneration).
 */
export async function generateCharacterSheet(
  characterId: string
): Promise<string> {
  const character = await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    include: { universe: true },
  });

  debug.image(`Generating character sheet for "${character.name}" via Gemini`);
  const startTime = Date.now();

  const prompt = buildCharacterSheetPrompt(character);
  const parts: any[] = [{ text: prompt }];

  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["Image", "Text"],
      imageConfig: {
        imageSize: IMAGE_SIZE,
      },
    },
  });

  debug.image("Gemini response:", {
    candidates: response?.candidates?.length || 0,
    parts: response?.candidates?.[0]?.content?.parts?.length || 0,
    partTypes: response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ? "text" : p.inlineData ? `image(${p.inlineData.mimeType})` : "unknown").join(", ") || "none",
    finishReason: response?.candidates?.[0]?.finishReason || "unknown",
    text: response?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text?.slice(0, 200) || "none",
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
 * Generate ALL character sheets for a universe. Each character gets its
 * own independent Gemini call to prevent visual blending between characters.
 * Style consistency is maintained via identical style guide text in each prompt.
 */
export async function generateAllCharacterSheets(
  universeId: string
): Promise<void> {
  const characters = await prisma.character.findMany({
    where: { universeId },
    include: { universe: true },
    orderBy: { role: "asc" }, // main first
  });

  if (characters.length === 0) return;

  // Load style reference if available
  const universe = characters[0].universe;
  const styleRef = loadStyleReference(universe);

  debug.image(`Generating ${characters.length} character sheets (separate sessions, styleRef=${!!styleRef})`);

  for (let i = 0; i < characters.length; i++) {
    const character = characters[i];

    if (character.referenceImageUrl) {
      debug.image(`"${character.name}" already has sheet, skipping`);
      continue;
    }

    debug.image(`Sheet ${i + 1}/${characters.length}: generating for "${character.name}"`);
    const startTime = Date.now();

    const promptText = buildCharacterSheetPrompt(character);

    // Build parts: style reference image (if available) + prompt text
    const parts: any[] = [];
    if (styleRef) {
      parts.push({
        text: `[STYLE REFERENCE — match this exact art style, brushwork, color palette, and texture. Do NOT copy the scene content, only the visual style.]`,
      });
      parts.push({
        inlineData: { data: styleRef.data, mimeType: styleRef.mimeType },
      });
    }
    parts.push({ text: promptText });

    try {
      const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: ["Image", "Text"],
          imageConfig: {
            imageSize: IMAGE_SIZE,
          },
        },
      });

      const imageUrl = extractImage(response);
      if (!imageUrl) {
        debug.error(`No image in Gemini response for "${character.name}"`);
        continue;
      }

      await prisma.character.update({
        where: { id: character.id },
        data: { referenceImageUrl: imageUrl },
      });

      debug.image(`Sheet for "${character.name}" done in ${Date.now() - startTime}ms: ${imageUrl}`);
    } catch (e: any) {
      debug.error(`Sheet failed for "${character.name}": ${e.message}`);
    }
  }

  debug.image("All character sheets generated");
}

/**
 * Build the prompt text for a character model sheet.
 */
function buildCharacterSheetPrompt(character: any): string {
  const outfitSection = character.outfit
    ? `\nOUTFIT (character is ALWAYS wearing/carrying ALL of these):\n${character.outfit}`
    : "";

  return `IMPORTANT: You MUST match the art style of the STYLE REFERENCE IMAGE provided. Match its EXACT brushwork, texture, color treatment, and level of softness. The character studies below must look like they belong in the same book as the style reference.

${ART_STYLE}

Create 6-8 soft pastel studies of this character on a warm cream background. Each study should be loose and painterly — matching the dreamy, atmospheric quality of the style reference. These should look like they were drawn with the same chalk pastels, same hand, same level of softness.

This character is a ${character.speciesOrType}.

CHARACTER: ${character.name}
SPECIES: ${character.speciesOrType}

BODY:
${character.appearance}
${outfitSection}
${character.specialDetail ? `SPECIAL DETAIL: ${character.specialDetail}` : ""}

Show a mix of:
- 3-4 full body views (different poses: standing, walking, sitting)
- 2-3 face close-ups (different expressions: happy, surprised, worried)

Keep the character recognizable across all studies — same colors, same proportions, same outfit. But every study should feel SOFT and PAINTERLY, matching the style reference. NOT sharp. NOT outlined. NOT cartoon.`;
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

  const randomMood = MOODS[Math.floor(Math.random() * MOODS.length)];
  const styleGuide = buildImageStyleGuide(
    randomMood,
    location.universe.illustrationStyle
  );

  debug.image(`Generating location sheet for "${location.name}" via Gemini`);
  const startTime = Date.now();

  const prompt = `${ART_STYLE}

Create a LOCATION REFERENCE SHEET. Show this location 8-10 times on a plain white background.

LOCATION: ${location.name}
ROLE: ${location.role}
DESCRIPTION: ${location.description}
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

  // Style reference first
  const styleRef = loadStyleReference(location.universe);
  if (styleRef) {
    parts.push({
      text: `[STYLE REFERENCE — match this exact art style, brushwork, color palette, and texture. Do NOT copy the scene content, only the visual style.]`,
    });
    parts.push({
      inlineData: { data: styleRef.data, mimeType: styleRef.mimeType },
    });
  }

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
    model: IMAGE_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["Image", "Text"],
      imageConfig: {
        imageSize: IMAGE_SIZE,
      },
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
 * Generate ALL scene illustrations for a story using a single multi-turn
 * chat session. Gemini maintains character, scenery, and style consistency
 * across all pages because they're generated in the same conversation.
 *
 * Flow:
 * 1. First message: all character/location reference sheets + style guide
 * 2. Each subsequent message: one page's scene prompt → one illustration
 */
export async function generateStoryImages(
  universeId: string,
  characterIds: string[],
  mood: string,
  pages: { page_number: number; image_prompt: string; characters_in_scene?: string[]; location?: string }[],
  onProgress?: (pageNum: number, total: number, imageUrl: string) => void,
  characterAnchors?: Record<string, string>
): Promise<Map<number, string>> {
  const styleGuide = buildImageStyleGuide(mood);
  const results = new Map<number, string>();

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

  // Pre-load all character reference images for per-page injection
  const charWhere: any = { universeId, referenceImageUrl: { not: "" } };
  if (characterIds?.length) {
    charWhere.id = { in: characterIds };
  }
  const refCharacters = await prisma.character.findMany({ where: charWhere });

  const characterRefs = new Map<string, { name: string; data: string; mimeType: string }>();
  for (const char of refCharacters) {
    const img = readImageAsBase64(char.referenceImageUrl);
    if (img) {
      characterRefs.set(char.name.toLowerCase(), {
        name: char.name,
        data: img.data,
        mimeType: img.mimeType,
      });
    }
  }

  // Load style reference for the universe
  const universe = await prisma.universe.findUniqueOrThrow({ where: { id: universeId } });
  const styleRef = loadStyleReference(universe);

  // Build setup message — style guide + style reference image
  const setupParts: any[] = [];

  if (styleRef) {
    setupParts.push({
      text: `[STYLE REFERENCE IMAGE — every illustration you generate MUST match this exact art style, brushwork, color palette, texture, and level of detail. This is the visual standard for the entire book.]`,
    });
    setupParts.push({
      inlineData: { data: styleRef.data, mimeType: styleRef.mimeType },
    });
  }

  setupParts.push({
    text: `You are illustrating a children's picture book. I will give you scene descriptions one at a time. For each one, generate ONE illustration — a full scene with characters, background, and atmosphere.

IMPORTANT — Read the following style guide carefully. Every illustration you generate MUST follow these rules exactly.${styleRef ? " The STYLE REFERENCE IMAGE above is the visual anchor — match its exact style." : ""}

${styleGuide}
CRITICAL: Maintain PERFECT visual consistency across ALL pages:
- Characters must look IDENTICAL on every page (same body, same colors, same outfit, same proportions)
- Locations must look the same when revisited (same landmarks, same colors, same geography)
- Art style, color palette, and lighting approach must stay consistent throughout

CHARACTERS:\n${charDesc}
${locDesc ? `LOCATIONS:\n${locDesc}` : ""}

MANDATORY WORKFLOW — follow these steps for EVERY page:
1. REVIEW: Before drawing, scroll back to the CHARACTER REFERENCE IMAGES below and study each character that appears in the scene. Note their exact body shape, colors, outfit, and accessories.
2. DRAW: Generate the illustration, matching each character precisely to their reference image.
3. VERIFY: Check the CHARACTER IDENTITY CHECK provided with the page prompt to confirm all visual details are correct.

Below are CHARACTER REFERENCE IMAGES. You MUST refer back to these images for EVERY page — they are the single source of truth for what each character looks like. As the conversation grows longer, do NOT rely on memory or earlier generated images. Always return to these reference images.
- Do NOT copy the style, pose, layout, background, or artistic technique from the reference images
- Do NOT reproduce the grid/multi-pose layout of reference sheets — generate SINGLE scene illustrations
- The reference images may be in a different art style — IGNORE their style and follow the style guide above instead`,
  });

  // Attach all character reference images to the setup message
  for (const [, ref] of characterRefs) {
    setupParts.push({
      text: `[CHARACTER REFERENCE — ${ref.name}]`,
    });
    setupParts.push({
      inlineData: { data: ref.data, mimeType: ref.mimeType },
    });
  }

  debug.image(`Starting story generation: ${pages.length} pages, ${characterRefs.size} character refs, styleRef=${!!styleRef}`);

  // Single multi-turn chat session for the whole story
  const chat = ai.chats.create({
    model: IMAGE_MODEL,
    config: {
      responseModalities: ["Image", "Text"],
      imageConfig: {
        aspectRatio: "4:3",
        imageSize: IMAGE_SIZE,
      },
    },
  });

  // Send setup message with style ref + all character refs
  try {
    await chat.sendMessage({ message: setupParts });
    debug.image("Setup message sent");
  } catch (e: any) {
    debug.error(`Setup message failed: ${e.message}`);
  }

  // Generate each page as a text-only message in the same chat
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page.image_prompt) continue;

    const startTime = Date.now();

    const sceneCharacters = page.characters_in_scene || [];
    const characterNames = sceneCharacters.length > 0
      ? sceneCharacters.join(" and ")
      : "";

    debug.image(`Page ${i + 1}/${pages.length}: generating...`, {
      characters: characterNames || "none",
      prompt: page.image_prompt.slice(0, 100),
    });

    const refReminder = characterNames
      ? `\n\nBEFORE DRAWING: Refer back to the CHARACTER REFERENCE IMAGES in the setup message for ${characterNames}. Draw each character exactly as they appear in their reference sheet.`
      : "";

    const pageParts: any[] = [{
      text: `${ART_STYLE_REMINDER}${refReminder}\n\nPage ${page.page_number}: ${page.image_prompt}\n\nGenerate a SINGLE scene illustration.\n\nEDGES: The painting MUST have soft, irregular edges that fade and bleed into white paper. Do NOT create a sharp rectangular border or clean-cut frame around the image.`,
    }];

    try {
      let imageUrl: string | null = null;

      // Attempt 1
      const response1 = await chat.sendMessage({ message: pageParts });
      imageUrl = extractImage(response1);

      if (!imageUrl) {
        const candidate = response1?.candidates?.[0];
        const finishReason = candidate?.finishReason || "no candidate";
        const textParts = candidate?.content?.parts
          ?.filter((p: any) => p.text)
          ?.map((p: any) => p.text)
          ?.join(" ") || "no content";
        debug.error(`Page ${i + 1}/${pages.length}: no image (attempt 1/3). finishReason=${finishReason}, text="${textParts.slice(0, 200)}"`);

        // Attempt 2: retry same prompt
        debug.image(`Page ${i + 1}/${pages.length}: retrying (attempt 2/3, same prompt)...`);
        const response2 = await chat.sendMessage({ message: pageParts });
        imageUrl = extractImage(response2);

        if (imageUrl) {
          debug.image(`Page ${i + 1}/${pages.length}: succeeded on attempt 2/3`);
        } else {
          debug.error(`Page ${i + 1}/${pages.length}: no image (attempt 2/3)`);

          // Attempt 3: simplified prompt
          debug.image(`Page ${i + 1}/${pages.length}: retrying (attempt 3/3, simplified prompt)...`);
          const response3 = await chat.sendMessage({ message: [{ text: `Page ${page.page_number}: ${page.image_prompt}\n\n${ART_STYLE_REMINDER}` }] });
          imageUrl = extractImage(response3);

          if (imageUrl) {
            debug.image(`Page ${i + 1}/${pages.length}: succeeded on attempt 3/3 (simplified)`);
          } else {
            debug.error(`Page ${i + 1}/${pages.length}: FAILED — no image after 3 attempts`);
          }
        }
      }

      if (imageUrl) {
        results.set(page.page_number, imageUrl);
        debug.image(`Page ${i + 1}/${pages.length}: done in ${Date.now() - startTime}ms`, { imageUrl });
        onProgress?.(page.page_number, pages.length, imageUrl);
      } else {
        debug.error(`Page ${i + 1}/${pages.length}: failed after 3 attempts`);
      }
    } catch (e: any) {
      debug.error(`Page ${i + 1}/${pages.length}: failed: ${e.message}`);
    }
  }

  debug.image(`Story chat complete: ${results.size}/${pages.length} images generated`);
  return results;
}
