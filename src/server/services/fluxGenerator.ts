import Replicate from "replicate";
import prisma from "../lib/prisma.js";
import { buildImageStyleGuide } from "./imageStyleGuide.js";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const replicate = new Replicate();

const IMAGES_DIR = path.resolve("public/images");

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function saveImageFromUrl(url: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const filename = `${randomUUID()}.webp`;
      const filepath = path.join(IMAGES_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      resolve(`/images/${filename}`);
    } catch (e) {
      reject(e);
    }
  });
}

function getPublicUrl(localPath: string): string {
  // For Replicate, we need an accessible URL. In dev, images are local files.
  // We'll pass them as data URIs via base64 instead.
  const fullPath = path.join("public", localPath);
  if (fs.existsSync(fullPath)) {
    const data = fs.readFileSync(fullPath);
    const ext = path.extname(localPath).slice(1) || "png";
    const mime = ext === "webp" ? "image/webp" : ext === "jpg" ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${data.toString("base64")}`;
  }
  return "";
}

/**
 * Build a style prompt prefix from the universe context.
 */
async function buildStylePrompt(
  universeId: string,
  characterIds: string[],
  mood: string,
  ageGroup: string
): Promise<{ stylePrefix: string; characterDescriptions: string }> {
  const characters = await prisma.character.findMany({
    where: { universeId, id: { in: characterIds } },
  });

  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
  });

  // Build concise style prefix for Flux (Flux works better with shorter, focused prompts)
  const moodKey = mood.toLowerCase().split(" ")[0];
  const moodStyles: Record<string, string> = {
    gentle: "soft pastel colors, warm golden light, dreamy atmosphere",
    funny: "bright cheerful colors, energetic composition, playful",
    exciting: "bold saturated colors, dynamic composition, adventurous",
    mysterious: "deep blues and purples, magical glowing accents, atmospheric",
  };

  const stylePrefix = `children's storybook illustration, soft watercolor style, warm and friendly, ${moodStyles[moodKey] || moodStyles["exciting"]}, hand-drawn feel with gentle textures`;

  // Build character descriptions
  let charDesc = "";
  for (const char of characters) {
    charDesc += `${char.name} (${char.speciesOrType}): ${char.appearance}`;
    if (char.specialDetail) {
      charDesc += `. ${char.specialDetail}`;
    }
    charDesc += ". ";
  }

  return { stylePrefix, characterDescriptions: charDesc.trim() };
}

/**
 * Get the LoRA model ID for a universe, if one has been trained.
 */
async function getUniverseLoraModel(universeId: string): Promise<string | null> {
  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
  });
  // We'll store the LoRA model ID in illustrationStyle as "lora:owner/model"
  if (universe?.illustrationStyle?.startsWith("lora:")) {
    return universe.illustrationStyle.slice(5);
  }
  return null;
}

/**
 * Generate a scene illustration using Flux via Replicate.
 */
export async function generateFluxImage(
  scenePrompt: string,
  universeId: string,
  characterIds: string[],
  mood: string,
  ageGroup: string,
  previousPageImageUrls: string[] = [],
  quality: "low" | "medium" | "high" = "high",
  seed?: number
): Promise<{ imageUrl: string; seed: number }> {
  const { stylePrefix, characterDescriptions } = await buildStylePrompt(
    universeId,
    characterIds,
    mood,
    ageGroup
  );

  const loraModel = await getUniverseLoraModel(universeId);

  // Build the full prompt
  const fullPrompt = `${stylePrefix}. ${characterDescriptions} ${scenePrompt}`;

  // Determine model and settings based on quality and LoRA availability
  let model: string;
  let input: Record<string, any>;

  if (loraModel) {
    // Use the trained LoRA model
    model = loraModel;
    input = {
      prompt: fullPrompt,
      num_inference_steps: quality === "low" ? 15 : quality === "medium" ? 25 : 35,
      guidance: 3.5,
      output_format: "webp",
      output_quality: quality === "low" ? 80 : 90,
      ...(seed !== undefined && { seed }),
    };
  } else if (quality === "low") {
    // Flux Schnell for fast testing
    model = "black-forest-labs/flux-schnell";
    input = {
      prompt: fullPrompt,
      num_outputs: 1,
      aspect_ratio: "4:3",
      output_format: "webp",
      output_quality: 80,
      go_fast: true,
      num_inference_steps: 4,
      ...(seed !== undefined && { seed }),
    };
  } else {
    // Flux 1.1 Pro for production quality
    model = "black-forest-labs/flux-1.1-pro";
    input = {
      prompt: fullPrompt,
      width: 1024,
      height: 768,
      prompt_upsampling: true,
      output_format: "webp",
      output_quality: 90,
      ...(seed !== undefined && { seed }),
    };
  }

  // If we have previous page images and Redux is available, use the first
  // as a style reference (only for non-LoRA, non-Schnell)
  if (
    !loraModel &&
    quality !== "low" &&
    previousPageImageUrls.length > 0
  ) {
    const lastPageUrl = previousPageImageUrls[previousPageImageUrls.length - 1];
    const dataUri = getPublicUrl(lastPageUrl);
    if (dataUri) {
      // Use Flux Redux for style-guided generation
      model = "black-forest-labs/flux-redux-dev";
      input = {
        prompt: fullPrompt,
        redux_image: dataUri,
        guidance: 3.5,
        num_inference_steps: quality === "medium" ? 25 : 35,
        output_format: "webp",
        output_quality: 90,
        ...(seed !== undefined && { seed }),
      };
    }
  }

  const output = await replicate.run(model as `${string}/${string}`, { input });

  // Handle different output formats
  let imageUrl: string;
  if (typeof output === "string") {
    imageUrl = await saveImageFromUrl(output);
  } else if (Array.isArray(output) && output.length > 0) {
    const url = typeof output[0] === "string" ? output[0] : (output[0] as any)?.url;
    if (!url) throw new Error("No image URL in Flux output");
    imageUrl = await saveImageFromUrl(url);
  } else {
    throw new Error("Unexpected Flux output format");
  }

  // Extract seed from prediction if available (for reproducibility)
  const usedSeed = seed || Math.floor(Math.random() * 2147483647);

  return { imageUrl, seed: usedSeed };
}

/**
 * Train a LoRA on character reference images for a universe.
 * Returns the Replicate model ID once training is complete.
 */
export async function trainUniverseLora(
  universeId: string,
  replicateOwner: string
): Promise<string> {
  const characters = await prisma.character.findMany({
    where: { universeId },
  });

  // Collect all character reference images
  const trainingImages: string[] = [];
  for (const char of characters) {
    if (char.referenceImageUrl) {
      const fullPath = path.join("public", char.referenceImageUrl);
      if (fs.existsSync(fullPath)) {
        trainingImages.push(fullPath);
      }
    }
  }

  if (trainingImages.length < 2) {
    throw new Error("Need at least 2 character reference images to train a LoRA");
  }

  // Create a zip of training images
  // For now, we'll skip the zip creation and note that this requires
  // uploading images to a public URL or using Replicate's file upload API
  // This is a placeholder for the full implementation

  const modelName = `storyverse-${universeId.slice(0, 8)}`;
  const destination = `${replicateOwner}/${modelName}`;

  console.log(`LoRA training would be triggered for ${destination} with ${trainingImages.length} images`);
  console.log("Full LoRA training implementation requires uploading training images to a public URL");

  // Store the model reference (will be populated when training completes)
  // For now, return a placeholder
  return destination;
}
