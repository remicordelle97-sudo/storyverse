import { Router } from "express";
import { createSignedUploadUrl } from "../lib/storage.js";
import { debug } from "../lib/debug.js";

const router = Router();

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// Anthropic vision caps individual images around 5MB after decoding.
// We accept up to 5MB on the wire too — base64 in the old path inflated
// it ~33%, but here we get the raw file so the cap can be the actual
// payload size.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// POST /api/uploads/photo-url
// Returns a presigned PUT URL that the browser uses to push a photo
// directly to R2, plus the resulting key the client should send back
// in the universe-build payload.
//
// This replaces the old flow where the client base64-encoded the file
// and shipped it inside the JSON request body — which inflated it
// ~33%, hit the 10MB express limit at 3 photos, and stored the bytes
// in `GenerationJob.payload` for the entire build duration.
router.post("/photo-url", async (req, res) => {
  try {
    const { mimeType, contentLength } = req.body || {};
    if (typeof mimeType !== "string" || !ALLOWED_MIME.has(mimeType)) {
      return res.status(400).json({
        error: "Photo must be JPG, PNG, WebP, or GIF.",
      });
    }
    if (typeof contentLength !== "number" || contentLength <= 0 || contentLength > MAX_PHOTO_BYTES) {
      return res.status(400).json({
        error: `Photo size out of range (must be 1–${Math.floor(MAX_PHOTO_BYTES / 1024 / 1024)}MB).`,
      });
    }

    const signed = await createSignedUploadUrl(req.userId as string, mimeType);
    if (!signed) {
      // Production refuses to boot without R2 (per src/server/lib/storage.ts),
      // so this branch only fires in dev with no R2 configured.
      return res.status(503).json({
        error: "Photo upload requires R2 storage; not configured in this environment.",
      });
    }

    res.json(signed);
  } catch (e: any) {
    debug.error(`Photo signed URL failed: ${e.message}`);
    res.status(500).json({ error: "Failed to create upload URL" });
  }
});

export default router;
