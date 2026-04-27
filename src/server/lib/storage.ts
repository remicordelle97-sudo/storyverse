import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { debug } from "./debug.js";

// Resolve storage backend at module load. Production refuses to start without
// R2 — local-disk storage is per-instance, so a multi-instance deploy would
// silently serve images that only exist on whichever box wrote them.
function resolveStorage(): { s3: S3Client | null; bucket: string; publicUrl: string; useCloud: boolean } {
  // .trim() defends against trailing whitespace in env vars: R2_ACCESS_KEY_ID
  // is interpolated literally into the sigv4 Authorization header
  // ("AWS4-HMAC-SHA256 Credential=<id>/..."), so a stray newline produces
  // "Invalid character in header content [\"Authorization\"]" from Node's
  // https module — surfaces as intermittent failures during R2 uploads
  // since the page-level try/catch in geminiGenerator.ts re-labels it as
  // a generation failure.
  const bucket = (process.env.R2_BUCKET ?? "").trim();
  const publicUrl = (process.env.R2_PUBLIC_URL ?? "").trim();
  const accountId = (process.env.R2_ACCOUNT_ID ?? "").trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY ?? "").trim();

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

const SIGNED_UPLOAD_TTL_SECONDS = 15 * 60; // 15 min — comfortable for users picking a file

/**
 * Generate a presigned PUT URL the client can upload directly to. Used
 * for character photos that flow through the universe builder so we
 * don't have to round-trip ~5MB of base64 through the express body.
 *
 * The returned `key` is what the client puts in the universe payload
 * (instead of base64 bytes). The worker resolves that key back to
 * bytes via `readImageByKey` just-in-time when calling Claude.
 *
 * In dev (no R2), returns a sentinel so the upload path is gated
 * to production-style flows. The client could be taught to fall back
 * to inline base64 in dev, but for now we just require R2.
 */
export async function createSignedUploadUrl(
  ownerId: string,
  mimeType: string,
): Promise<{ uploadUrl: string; key: string; expiresInSeconds: number } | null> {
  if (!useCloud || !s3) return null;
  const ext =
    mimeType === "image/jpeg" ? "jpg" :
    mimeType === "image/png" ? "png" :
    mimeType === "image/webp" ? "webp" :
    mimeType === "image/gif" ? "gif" : null;
  if (!ext) return null;

  // Namespace by owner so a stray lifecycle-rule cleanup is easy to
  // scope, and so listing for a single user is cheap if we ever need
  // a "your uploaded photos" admin view.
  const key = `uploads/${ownerId}/${randomUUID()}.${ext}`;
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimeType,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: SIGNED_UPLOAD_TTL_SECONDS });
  return { uploadUrl, key, expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS };
}

/** Resolve an R2 key to its bytes. Used by the universe pipeline to
 * pull character photos at job-execution time instead of storing the
 * base64 in `GenerationJob.payload`. */
export async function readImageByKey(key: string): Promise<{ data: string; mimeType: string } | null> {
  if (!useCloud || !s3) return null;
  // Mild key validation — we control the keys we hand out, but defensively
  // reject paths that try to escape the uploads/ prefix or have nulls.
  if (!key || key.includes("..") || key.includes("\0")) return null;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!obj.Body) return null;
    const chunks: Buffer[] = [];
    // The SDK returns a streaming Body; aggregate it to one Buffer.
    for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    const mimeType = obj.ContentType || "image/png";
    return { data: buffer.toString("base64"), mimeType };
  } catch (e) {
    debug.error(`readImageByKey failed for ${key}: ${(e as Error).message}`);
    return null;
  }
}
