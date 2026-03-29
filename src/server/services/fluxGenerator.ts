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

/**
 * Download an image from a URL and save locally.
 */
async function saveImageFromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = `${randomUUID()}.webp`;
  const filepath = path.join(IMAGES_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return `/images/${filename}`;
}

/**
 * Upload a local image file to Replicate's file hosting so it can be
 * used as input to models. Returns a URL that Replicate can access.
 */
async function uploadToReplicate(localPath: string): Promise<string> {
  const fullPath = localPath.startsWith("public/")
    ? localPath
    : path.join("public", localPath);

  if (!fs.existsSync(fullPath)) return "";

  const data = fs.readFileSync(fullPath);
  const ext = path.extname(fullPath).slice(1) || "png";
  const mime =
    ext === "webp"
      ? "image/webp"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : "image/png";

  const file = await replicate.files.create(
    new Blob([data], { type: mime }),
    { filename: path.basename(fullPath) }
  );

  return file.urls.get;
}

/**
 * Build a detailed style prompt for Flux from universe context and style guide.
 */
async function buildFluxPrompt(
  scenePrompt: string,
  universeId: string,
  characterIds: string[],
  mood: string,
  ageGroup: string
): Promise<{
  prompt: string;
  characterRefUrls: string[];
}> {
  const characters = await prisma.character.findMany({
    where: { universeId, id: { in: characterIds } },
  });

  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
  });

  // Build style guide (same one used by GPT-4o)
  const styleGuide = buildImageStyleGuide(
    mood,
    ageGroup,
    universe?.illustrationStyle
  );

  // Build character descriptions
  let charDesc = "";
  const characterRefUrls: string[] = [];

  for (const char of characters) {
    charDesc += `${char.name} (${char.speciesOrType}): ${char.appearance}`;
    if (char.specialDetail) {
      charDesc += `. ${char.specialDetail}`;
    }
    charDesc += ". ";

    // Upload character reference image to Replicate if available
    if (char.referenceImageUrl) {
      try {
        const url = await uploadToReplicate(char.referenceImageUrl);
        if (url) characterRefUrls.push(url);
      } catch (e) {
        console.error(`Failed to upload ref image for ${char.name}:`, e);
      }
    }
  }

  // Flux works best with focused prompts. Extract the key style directives
  // rather than sending the entire multi-page guide.
  const moodKey = mood.toLowerCase().split(" ")[0];
  const moodStyles: Record<string, string> = {
    gentle: "soft pastel colors, warm golden hour light, dreamy hazy atmosphere, low contrast",
    funny: "bright cheerful saturated colors, energetic playful composition, sunny even lighting",
    exciting: "bold rich saturated colors, dynamic composition, strong warm directional lighting",
    mysterious: "deep indigo and purple palette, magical glowing accents, atmospheric low light with warm point lights",
  };

  const ageStyles: Record<string, string> = {
    "2-3": "very simple background, minimal detail, character fills most of the frame, bold clear shapes, high contrast",
    "4-5": "moderate background detail with playful hidden details, bright bold colors, clear readable expressions",
    "6-8": "rich detailed environment, visual storytelling in the background, sophisticated palette, nuanced expressions and body language",
  };

  const prompt = [
    `children's storybook illustration, soft watercolor style with gentle paper texture, warm hand-drawn feel with sketchy brown outlines`,
    moodStyles[moodKey] || moodStyles["exciting"],
    ageStyles[ageGroup] || ageStyles["4-5"],
    `Characters: ${charDesc}`,
    `Scene: ${scenePrompt}`,
    `Rule of thirds composition. Characters looking or moving right. Large expressive eyes. No text or letters in the image. Leave open space for text placement.`,
    `Shadows use cool blues and purples, never black. Highlights use warm yellows and pinks. Consistent art style throughout.`,
  ].join(". ");

  return { prompt, characterRefUrls };
}

/**
 * Generate a scene illustration using Flux via Replicate.
 *
 * Uses IP-Adapter for character reference images when available,
 * and Redux for style continuity from previous pages.
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
  const { prompt, characterRefUrls } = await buildFluxPrompt(
    scenePrompt,
    universeId,
    characterIds,
    mood,
    ageGroup
  );

  const loraModel = await getLoraModel(universeId);

  // Choose model and build input based on what's available
  let model: string;
  let input: Record<string, any>;
  const usedSeed = seed || Math.floor(Math.random() * 2147483647);

  if (loraModel) {
    // Best case: trained LoRA model for this universe
    model = loraModel;
    input = {
      prompt,
      num_inference_steps: quality === "low" ? 15 : quality === "medium" ? 25 : 35,
      guidance: 3.5,
      output_format: "webp",
      output_quality: quality === "low" ? 80 : 90,
      seed: usedSeed,
    };
  } else if (
    characterRefUrls.length > 0 &&
    quality !== "low"
  ) {
    // Use IP-Adapter with character reference images
    model = "xlabs-ai/flux-ip-adapter";
    input = {
      prompt,
      image: characterRefUrls[0], // primary character reference
      ip_adapter_strength: 0.6,
      steps: quality === "medium" ? 25 : 35,
      guidance: 3.5,
      output_format: "webp",
      output_quality: 90,
      seed: usedSeed,
    };
  } else if (quality === "low") {
    // Flux Schnell for fast testing
    model = "black-forest-labs/flux-schnell";
    input = {
      prompt,
      num_outputs: 1,
      aspect_ratio: "4:3",
      output_format: "webp",
      output_quality: 80,
      go_fast: true,
      num_inference_steps: 4,
      seed: usedSeed,
    };
  } else {
    // Flux 1.1 Pro for production quality (no character refs available)
    model = "black-forest-labs/flux-1.1-pro";
    input = {
      prompt,
      width: 1024,
      height: 768,
      prompt_upsampling: true,
      output_format: "webp",
      output_quality: 90,
      seed: usedSeed,
    };
  }

  // For non-LoRA, non-Schnell: if we have previous pages, try Redux for style continuity
  if (
    !loraModel &&
    quality !== "low" &&
    !input.image && // not already using IP-Adapter
    previousPageImageUrls.length > 0
  ) {
    const lastPageUrl = previousPageImageUrls[previousPageImageUrls.length - 1];
    try {
      const replicateUrl = await uploadToReplicate(lastPageUrl);
      if (replicateUrl) {
        model = "black-forest-labs/flux-redux-dev";
        input = {
          prompt,
          redux_image: replicateUrl,
          guidance: 3.5,
          num_inference_steps: quality === "medium" ? 25 : 35,
          output_format: "webp",
          output_quality: 90,
          seed: usedSeed,
        };
      }
    } catch (e) {
      console.error("Failed to upload previous page for Redux:", e);
      // Fall through to non-Redux generation
    }
  }

  console.log(`Flux generating with model: ${model}, seed: ${usedSeed}`);

  const output = await replicate.run(model as `${string}/${string}`, { input });

  // Handle different output formats from different models
  let outputUrl: string;
  if (typeof output === "string") {
    outputUrl = output;
  } else if (Array.isArray(output) && output.length > 0) {
    const item = output[0];
    outputUrl = typeof item === "string" ? item : (item as any)?.url || "";
  } else if (output && typeof output === "object" && "url" in output) {
    outputUrl = (output as any).url;
  } else {
    throw new Error(`Unexpected Flux output format: ${JSON.stringify(output).slice(0, 200)}`);
  }

  if (!outputUrl) throw new Error("No image URL in Flux output");

  const imageUrl = await saveImageFromUrl(outputUrl);
  return { imageUrl, seed: usedSeed };
}

/**
 * Get the LoRA model ID for a universe, if one has been trained.
 */
async function getLoraModel(universeId: string): Promise<string | null> {
  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
  });
  if (universe?.illustrationStyle?.startsWith("lora:")) {
    return universe.illustrationStyle.slice(5);
  }
  return null;
}

/**
 * Train a LoRA on character reference images for a universe.
 * Uploads images to Replicate, starts training, and stores the model ID.
 */
export async function trainUniverseLora(
  universeId: string,
  replicateOwner: string
): Promise<string> {
  const characters = await prisma.character.findMany({
    where: { universeId },
  });

  // Collect character reference images
  const imageFiles: { path: string; caption: string }[] = [];
  for (const char of characters) {
    if (char.referenceImageUrl) {
      const fullPath = path.join("public", char.referenceImageUrl);
      if (fs.existsSync(fullPath)) {
        imageFiles.push({
          path: fullPath,
          caption: `SVCHAR ${char.name}, ${char.speciesOrType}, ${char.appearance}`,
        });
      }
    }
  }

  if (imageFiles.length < 2) {
    throw new Error(
      `Need at least 2 character reference images to train a LoRA (have ${imageFiles.length})`
    );
  }

  // Upload each image to Replicate
  const uploadedUrls: string[] = [];
  for (const img of imageFiles) {
    const data = fs.readFileSync(img.path);
    const file = await replicate.files.create(
      new Blob([data], { type: "image/png" }),
      { filename: path.basename(img.path) }
    );
    uploadedUrls.push(file.urls.get);
  }

  // Create a model destination
  const modelName = `storyverse-${universeId.slice(0, 8)}`;
  const destination = `${replicateOwner}/${modelName}`;

  console.log(`Starting LoRA training: ${destination} with ${imageFiles.length} images`);

  // Fetch the latest version of the trainer model dynamically so we
  // never hardcode a stale version hash.
  const trainerModel = await replicate.models.get("ostris", "flux-dev-lora-trainer");
  const trainerVersion = trainerModel.latest_version?.id;
  if (!trainerVersion) {
    throw new Error("Could not resolve latest version of ostris/flux-dev-lora-trainer");
  }

  // Start training
  const training = await replicate.trainings.create(
    "ostris",
    "flux-dev-lora-trainer",
    trainerVersion,
    {
      destination: destination as `${string}/${string}`,
      input: {
        input_images: uploadedUrls[0], // Replicate expects a zip URL or single URL
        trigger_word: "SVCHAR",
        steps: 1000,
        lora_rank: 16,
        learning_rate: 0.0004,
      },
    }
  );

  console.log(`LoRA training started: ${training.id}, status: ${training.status}`);

  // Store the model ID in the universe
  await prisma.universe.update({
    where: { id: universeId },
    data: { illustrationStyle: `lora:${destination}` },
  });

  return destination;
}
