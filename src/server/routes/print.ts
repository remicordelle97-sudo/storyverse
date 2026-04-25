/**
 * Print-on-demand routes (Phase 1, sandbox-only).
 *
 * Surfaces a single admin-only endpoint that takes a story + a fake
 * shipping address, builds the cover + interior PDFs, gets a Lulu
 * cost quote, and submits a sandbox print job. Used to validate the
 * Lulu integration end-to-end before any user-facing flow lands.
 *
 * Phase 2 will add user-facing /quote and /checkout endpoints with
 * Stripe payment + a real address form.
 */

import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { debug } from "../lib/debug.js";
import {
  calculatePrintJobCost,
  createPrintJob,
  getPrintJob,
  LULU_CONFIG,
  type ShippingAddress,
} from "../services/luluClient.js";
import { buildAndStorePrintPdfs } from "../services/printPdfBuilder.js";

const router = Router();

const PRINT_MARKUP = 1.5;

function totalCustomerPriceCents(opts: {
  printCostCents: number;
  shippingCostCents: number;
}): number {
  // Markup on the print cost only; shipping is pass-through. Tax is
  // not charged to the customer separately in Phase 1 — Lulu collects
  // it at fulfillment.
  return Math.round(opts.printCostCents * PRINT_MARKUP) + opts.shippingCostCents;
}

// === GET /api/print/config — admin sanity check =====================
router.get("/config", requireAdmin, (_req, res) => {
  res.json({
    baseUrl: LULU_CONFIG.baseUrl,
    isConfigured: LULU_CONFIG.isConfigured(),
    defaultPodPackageId: LULU_CONFIG.defaultPodPackageId,
    markup: PRINT_MARKUP,
  });
});

// === POST /api/print/test-order — admin end-to-end sandbox test =====
// Body: { storyId, shippingAddress?, email?, dryRun? }
//   - shippingAddress defaults to a known Lulu sandbox address.
//   - dryRun=true skips the Lulu createPrintJob call (only quotes).
router.post("/test-order", requireAdmin, async (req, res) => {
  try {
    if (!LULU_CONFIG.isConfigured()) {
      return res.status(503).json({
        error: "Lulu is not configured. Set LULU_CLIENT_KEY/LULU_CLIENT_SECRET.",
      });
    }

    const { storyId, shippingAddress, email, dryRun } = req.body || {};
    if (!storyId || typeof storyId !== "string") {
      return res.status(400).json({ error: "storyId is required" });
    }

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });

    // 1. Build PDFs and upload them somewhere Lulu can fetch from.
    const pdfs = await buildAndStorePrintPdfs({
      story: {
        id: story.id,
        title: story.title,
        scenes: story.scenes.map((s) => ({
          sceneNumber: s.sceneNumber,
          content: s.content,
        })),
      },
    });

    const address: ShippingAddress = shippingAddress || SAMPLE_LULU_ADDRESS;
    const contactEmail = (email as string) || "test@example.com";

    // 2. Cost quote.
    const quote = await calculatePrintJobCost({
      pageCount: pdfs.pageCount,
      quantity: 1,
      shippingAddress: address,
    });
    const customerPriceCents = totalCustomerPriceCents({
      printCostCents: quote.printCostCents,
      shippingCostCents: quote.shippingCostCents,
    });

    // 3. Persist a draft order so we can see it in the DB regardless
    // of whether dryRun skips the Lulu submission.
    const order = await prisma.printOrder.create({
      data: {
        userId: req.userId as string,
        storyId: story.id,
        status: dryRun ? "draft" : "submitted",
        luluPrintCostCents: quote.printCostCents,
        luluShippingCostCents: quote.shippingCostCents,
        customerPriceCents,
        shippingAddress: JSON.stringify(address),
        coverPdfUrl: pdfs.coverPdfUrl,
        interiorPdfUrl: pdfs.interiorPdfUrl,
      },
    });

    if (dryRun) {
      debug.story("Lulu dry-run order created", { orderId: order.id });
      return res.json({
        orderId: order.id,
        quote,
        customerPriceCents,
        pdfs,
        dryRun: true,
      });
    }

    // 4. Submit to Lulu sandbox.
    const luluJob = await createPrintJob({
      externalId: order.id,
      contactEmail,
      shippingAddress: address,
      shippingLevel: quote.shippingLevel,
      coverPdfUrl: pdfs.coverPdfUrl,
      interiorPdfUrl: pdfs.interiorPdfUrl,
      title: story.title,
    });

    const updated = await prisma.printOrder.update({
      where: { id: order.id },
      data: {
        luluPrintJobId: String(luluJob.id),
      },
    });

    debug.story("Lulu sandbox print job created", {
      orderId: updated.id,
      luluJobId: luluJob.id,
      status: luluJob.status?.name,
    });

    res.json({
      orderId: updated.id,
      luluJobId: luluJob.id,
      luluStatus: luluJob.status?.name,
      quote,
      customerPriceCents,
      pdfs,
    });
  } catch (e: any) {
    const msg = e?.message || "Test order failed";
    debug.error(`Lulu test order failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// === GET /api/print/orders/:id — admin status check =================
router.get("/orders/:id", requireAdmin, async (req, res) => {
  try {
    const order = await prisma.printOrder.findUnique({
      where: { id: req.params.id as string },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });

    let luluStatus: { name?: string; messages?: string[] } | null = null;
    if (order.luluPrintJobId) {
      try {
        const job = await getPrintJob(order.luluPrintJobId);
        luluStatus = job.status || null;
      } catch (e: any) {
        luluStatus = { name: "lookup_failed", messages: [e?.message || ""] };
      }
    }
    res.json({ order, luluStatus });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to fetch order" });
  }
});

// Lulu's documented sandbox-friendly US address. Don't rely on it for
// production submissions (it's not validated against the address-
// verification provider in some regions).
const SAMPLE_LULU_ADDRESS: ShippingAddress = {
  name: "Lulu Sandbox",
  street1: "1010 Sync Street",
  city: "Raleigh",
  state_code: "NC",
  country_code: "US",
  postcode: "27601",
  phone_number: "919-555-0100",
};

export default router;
