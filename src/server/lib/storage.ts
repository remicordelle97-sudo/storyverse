import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { debug } from "./debug.js";

// Resolve storage backend at module load. Production refuses to start without
// R2 — local-disk storage is per-instance, so a multi-instance deploy would
// silently serve images that only exist on whichever box wrote them.
function resolveStorage(): { s3: S3Client | null; bucket: string; publicUrl: string; useCloud: boolean } {
  const bucket = process.env.R2_BUCKET || "";
  const publicUrl = process.env.R2_PUBLIC_URL || "";
  const accountId = process.env.R2_ACCOUNT_ID || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";

  const fullyConfigured = !!(accountId && accessKeyId && secretAccessKey && bucket && publicUrl);

  if (fullyConfigured) {
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    debug.image("Storage: Cloudflare R2");
    return { s3, bucket, publicUrl, useCloud: true };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "R2 storage is not fully configured (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL). Refusing to boot in production with local-disk fallback — images written on one instance would not be visible to others."
    );
  }

  console.warn(
    "[storage] R2 not configured; using local filesystem fallback. DO NOT deploy without setting R2_* env vars."
  );
  return { s3: null, bucket: "", publicUrl: "", useCloud: false };
}

const { s3, bucket: BUCKET, publicUrl: PUBLIC_URL, useCloud } = resolveStorage();

// Local fallback paths
const IMAGES_DIR = path.resolve("public/images");
if (!useCloud && !fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

/**
 * Save a base64-encoded image and return its public URL.
 */
export async function saveImage(base64Data: string, mimeType: string = "image/png"): Promise<string> {
  const ext = mimeType.includes("pdf")
    ? "pdf"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("jpeg")
        ? "jpg"
        : "png";
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
