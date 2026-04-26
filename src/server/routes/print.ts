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
import { buildPrintPdfBytes, storePrintPdfBytes } from "../services/printPdfBuilder.js";
import { readImage } from "../lib/storage.js";

const router = Router();

const PRINT_MARKUP = 1.5;

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

// Print-order lifecycle. Phase 1 only writes draft/submitted/failed;
// Phase 2 grows this with paid/in_production/shipped/delivered/refunded.
const ORDER_STATUS = {
  draft: "draft",
  submitted: "submitted",
  failed: "failed",
} as const;

function totalCustomerPriceCents(opts: {
  printCostCents: number;
  shippingCostCents: number;
}): number {
  // Markup on the print cost only; shipping is pass-through. Tax stays
  // with Lulu — they collect it at fulfillment.
  return Math.round(opts.printCostCents * PRINT_MARKUP) + opts.shippingCostCents;
}

router.get("/config", requireAdmin, (_req, res) => {
  res.json({
    baseUrl: LULU_CONFIG.baseUrl,
    isConfigured: LULU_CONFIG.isConfigured,
    defaultPodPackageId: LULU_CONFIG.defaultPodPackageId,
    markup: PRINT_MARKUP,
  });
});

// POST /api/print/test-order — admin end-to-end sandbox test
// Body: { storyId, shippingAddress?, email?, dryRun? }
//   - shippingAddress defaults to SAMPLE_LULU_ADDRESS
//   - dryRun=true skips the Lulu createPrintJob call (only quotes)
router.post("/test-order", requireAdmin, async (req, res) => {
  try {
    if (!LULU_CONFIG.isConfigured) {
      return res.status(503).json({
        error: "Lulu is not configured. Set LULU_CLIENT_KEY/LULU_CLIENT_SECRET.",
      });
    }

    const { storyId, shippingAddress, email, dryRun } = req.body || {};
    if (!storyId || typeof storyId !== "string") {
      return res.status(400).json({ error: "storyId is required" });
    }

    // Admin-only endpoint — story is fetched directly without an
    // ownership check so admins can test against any user's story.
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });

    const address: ShippingAddress = shippingAddress || SAMPLE_LULU_ADDRESS;
    const contactEmail = (email as string) || "test@example.com";
    const podPackageId = LULU_CONFIG.defaultPodPackageId;
    if (!podPackageId) {
      return res.status(503).json({
        error:
          "LULU_DEFAULT_POD_PACKAGE_ID is not set. Pick a SKU at developers.lulu.com/price-calculator and set the env var.",
      });
    }

    // Pre-fetch each scene's illustration so the (sync) PDF builder
    // can embed them. Running in parallel keeps this fast even for
    // 10-scene stories.
    const sceneImages = await Promise.all(
      story.scenes.map((s) => (s.imageUrl ? readImage(s.imageUrl) : Promise.resolve(null)))
    );

    // Build PDFs synchronously, then run the (slow) uploads in parallel
    // with the (slow) Lulu cost quote — they're independent.
    const built = buildPrintPdfBytes({
      story: {
        id: story.id,
        title: story.title,
        scenes: story.scenes.map((s, i) => ({
          sceneNumber: s.sceneNumber,
          content: s.content,
          image: sceneImages[i] || undefined,
        })),
      },
      podPackageId,
    });
    const [pdfs, quote] = await Promise.all([
      storePrintPdfBytes(built),
      calculatePrintJobCost({
        pageCount: built.pageCount,
        quantity: 1,
        shippingAddress: address,
      }),
    ]);
    const customerPriceCents = totalCustomerPriceCents({
      printCostCents: quote.printCostCents,
      shippingCostCents: quote.shippingCostCents,
    });

    // Persist as draft first; only flip to submitted after Lulu accepts.
    const order = await prisma.printOrder.create({
      data: {
        userId: req.userId as string,
        storyId: story.id,
        status: ORDER_STATUS.draft,
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

    let luluJobId: number | null = null;
    let luluStatusName: string | undefined;
    try {
      // If R2 isn't configured, the storage helper returns a relative
      // /images/... path. Lulu can't fetch a relative path — absolutize
      // it via APP_URL so it points at the public Express static mount.
      const externalize = (url: string): string => {
        if (/^https?:\/\//.test(url)) return url;
        const base = (process.env.APP_URL || "").replace(/\/$/, "");
        if (!base) {
          throw new Error(
            "APP_URL is not set, and PDF storage is local. Configure R2 or set APP_URL so Lulu can fetch the printable files."
          );
        }
        return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
      };
      const luluJob = await createPrintJob({
        externalId: order.id,
        contactEmail,
        shippingAddress: address,
        shippingLevel: quote.shippingLevel,
        coverPdfUrl: externalize(pdfs.coverPdfUrl),
        interiorPdfUrl: externalize(pdfs.interiorPdfUrl),
        title: story.title,
      });
      luluJobId = luluJob.id;
      luluStatusName = luluJob.status?.name;
      await prisma.printOrder.update({
        where: { id: order.id },
        data: {
          status: ORDER_STATUS.submitted,
          luluPrintJobId: String(luluJob.id),
        },
      });
    } catch (e: any) {
      await prisma.printOrder.update({
        where: { id: order.id },
        data: {
          status: ORDER_STATUS.failed,
          rejectionReason: (e?.message || "createPrintJob failed").slice(0, 500),
        },
      });
      throw e;
    }

    debug.story("Lulu sandbox print job created", {
      orderId: order.id,
      luluJobId,
      status: luluStatusName,
    });

    res.json({
      orderId: order.id,
      luluJobId,
      luluStatus: luluStatusName,
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

// GET /api/print/orders/:id — admin status check
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

export default router;
