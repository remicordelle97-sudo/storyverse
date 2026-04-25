import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { debug } from "./debug.js";

const BUCKET = process.env.R2_BUCKET || "";
const PUBLIC_URL = process.env.R2_PUBLIC_URL || ""; // e.g. https://images.storyverse.com or https://pub-xxx.r2.dev

const s3 = (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
  ? new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

const useCloud = !!(s3 && BUCKET && PUBLIC_URL);

if (useCloud) {
  debug.image("Storage: Cloudflare R2");
} else {
  debug.image("Storage: local filesystem (R2 not configured)");
}

// Local fallback paths
const IMAGES_DIR = path.resolve("public/images");
if (!useCloud && !fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

/**
 * Save a base64-encoded image and return its public URL.
 */
export async function saveImage(base64Data: string, mimeType: string = "image/png"): Promise<string> {
  const ext = mimeType.includes("webp") ? "webp" : mimeType.includes("jpeg") ? "jpg" : "png";
  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(base64Data, "base64");

  if (useCloud) {
    const key = `images/${filename}`;
    await s3!.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }));
    return `${PUBLIC_URL}/${key}`;
  }

  // Local fallback
  const filepath = path.join(IMAGES_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return `/images/${filename}`;
}

/**
 * Read an image as base64. Supports both cloud URLs and local paths.
 */
export async function readImage(imageUrl: string): Promise<{ data: string; mimeType: string } | null> {
  if (!imageUrl) return null;

  // Cloud URL — fetch from R2
  if (imageUrl.startsWith("http")) {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const mimeType = res.headers.get("content-type") || "image/png";
      return { data: buffer.toString("base64"), mimeType };
    } catch {
      return null;
    }
  }

  // Local path
  const imgPath = path.join("public", imageUrl);
  if (!fs.existsSync(imgPath)) return null;
  const data = fs.readFileSync(imgPath).toString("base64");
  const ext = path.extname(imgPath).slice(1);
  const mimeType = ext === "webp" ? "image/webp" : ext === "jpg" ? "image/jpeg" : "image/png";
  return { data, mimeType };
}
