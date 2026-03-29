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
 * Run a Replicate model with retry on rate limit (429).
 * Waits for the retry-after period and retries up to 3 times.
 */
async function runWithRetry(
  model: string,
  input: Record<string, any>,
  maxRetries: number = 3
): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await replicate.run(model as `${string}/${string}`, { input });
    } catch (e: any) {
      const isRateLimit = e?.response?.status === 429 || e?.status === 429;
      if (!isRateLimit || attempt === maxRetries) throw e;

      // Parse retry-after or default to 10 seconds
      const retryAfter = parseInt(e?.response?.headers?.get?.("retry-after") || "10", 10);
      const waitMs = (retryAfter + 1) * 1000;
      console.log(`Rate limited. Waiting ${retryAfter + 1}s before retry ${attempt + 1}/${maxRetries}...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
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
): Promise<{ prompt: string }> {
  const characters = await prisma.character.findMany({
    where: { universeId, id: { in: characterIds } },
  });

  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
  });

  // Build character descriptions from exact DB text
  let charDesc = "";
  for (const char of characters) {
    charDesc += `${char.name} (${char.speciesOrType}): ${char.appearance}`;
    if (char.specialDetail) {
      charDesc += `. ${char.specialDetail}`;
    }
    charDesc += ". ";
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

  return { prompt };
}

/**
 * Generate a scene illustration using Flux via Replicate.
 * Model priority: LoRA (if trained) > Flux Pro (default) > Flux Schnell (low quality)
 * Includes retry logic for rate limits.
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
  const { prompt } = await buildFluxPrompt(
    scenePrompt,
    universeId,
    characterIds,
    mood,
    ageGroup
  );

  const loraModel = await getLoraModel(universeId);

  // Choose model and build input
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
    // Flux 1.1 Pro for production quality
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

  console.log(`Flux generating with model: ${model}, seed: ${usedSeed}`);

  // Run with retry on rate limit (429)
  const output = await runWithRetry(model, input);

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
