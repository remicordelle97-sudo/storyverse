/**
 * Lulu print-job webhook handler.
 *
 * Lulu fires a webhook each time a print job changes status (CREATED →
 * IN_PRODUCTION → SHIPPED, etc). Their dashboard lets you register a
 * URL + a shared secret; they sign the body with HMAC-SHA256 and send
 * the signature in the Lulu-HMAC-SHA256 header.
 *
 * This file is mounted in index.ts BEFORE express.json() so we get the
 * raw body for signature verification (same pattern as the Stripe
 * webhook in routes/billing.ts).
 *
 * Env: LULU_WEBHOOK_SECRET. If unset we 503 — we don't want to accept
 * unsigned status changes.
 */

import { Router, raw, type Request, type Response } from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import {
  mapLuluStatusToOrderStatus,
  PRINT_ORDER_STATUS,
} from "../services/printSubmit.js";

const router = Router();

const LULU_WEBHOOK_SECRET = process.env.LULU_WEBHOOK_SECRET || "";

/**
 * Verify the HMAC-SHA256 signature Lulu sends with each webhook.
 * timingSafeEqual avoids leaking the secret via response-time
 * comparison.
 */
function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", LULU_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const received = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== received.length) return false;
  return crypto.timingSafeEqual(expectedBuf, received);
}

interface LuluWebhookPayload {
  topic?: string;
  data?: {
    id?: number | string;
    status?: { name?: string };
    line_items?: Array<{
      id?: number;
      status?: { name?: string };
      tracking_urls?: string[];
    }>;
  };
}

router.post(
  "/",
  raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    if (!LULU_WEBHOOK_SECRET) {
      debug.error("LULU_WEBHOOK_SECRET not set — rejecting Lulu webhook");
      return res.status(503).json({ error: "Webhook not configured" });
    }
    const rawBody = req.body as Buffer;
    const sig =
      (req.headers["lulu-hmac-sha256"] as string | undefined) ||
      (req.headers["x-lulu-hmac-sha256"] as string | undefined);
    if (!verifySignature(rawBody, sig)) {
      debug.error("Lulu webhook signature failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    let payload: LuluWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as LuluWebhookPayload;
    } catch {
      return res.status(400).json({ error: "Malformed JSON" });
    }

    const luluJobId = payload.data?.id;
    const statusName = payload.data?.status?.name;
    if (!luluJobId) {
      debug.error("Lulu webhook payload missing data.id");
      return res.status(400).json({ error: "Missing data.id" });
    }

    const order = await prisma.printOrder.findFirst({
      where: { luluPrintJobId: String(luluJobId) },
    });
    if (!order) {
      // Could be an order that was deleted on our side, or for a job
      // we never created. Acknowledge so Lulu doesn't keep retrying.
      debug.story(`Lulu webhook for unknown job ${luluJobId} — ignoring`);
      return res.json({ received: true });
    }

    const mapped = mapLuluStatusToOrderStatus(statusName);
    // Pull the first available tracking URL, if Lulu shipped it.
    const trackingUrl =
      payload.data?.line_items?.flatMap((li) => li.tracking_urls || [])?.[0] || undefined;

    // Don't roll backwards across terminal states; once an order is
    // refunded/cancelled, late status events shouldn't re-flip it.
    const terminal: string[] = [
      PRINT_ORDER_STATUS.refunded,
      PRINT_ORDER_STATUS.cancelled,
    ];
    if (terminal.includes(order.status)) {
      debug.story(`Lulu webhook: order ${order.id} is ${order.status}, ignoring ${statusName}`);
      return res.json({ received: true });
    }

    const update: Record<string, unknown> = {};
    if (mapped) update.status = mapped;
    if (trackingUrl && !order.luluTrackingUrl) update.luluTrackingUrl = trackingUrl;

    if (Object.keys(update).length === 0) {
      debug.story(
        `Lulu webhook: no-op for order ${order.id} (lulu status ${statusName})`
      );
      return res.json({ received: true });
    }

    await prisma.printOrder.update({ where: { id: order.id }, data: update });
    debug.story("Lulu webhook applied", {
      orderId: order.id,
      luluJobId,
      luluStatus: statusName,
      newStatus: update.status,
      trackingUrl: update.luluTrackingUrl,
    });

    res.json({ received: true });
  }
);

export default router;
