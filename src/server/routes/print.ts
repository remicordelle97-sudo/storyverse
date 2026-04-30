/**
 * Print-on-demand routes.
 *
 * Phase 1 (admin-only sandbox test) endpoints:
 *   POST /api/print/test-order      — admin smoke test, no payment.
 *   GET  /api/print/orders/:id      — admin order lookup.
 *   GET  /api/print/config          — admin config snapshot.
 *
 * Phase 2 (user-facing) endpoints:
 *   POST /api/print/quote           — get a Lulu cost quote.
 *   POST /api/print/checkout        — build PDFs, create draft order +
 *                                     Stripe Checkout session.
 *   GET  /api/print/orders          — current user's print orders.
 *   GET  /api/print/orders/:id      — current user's print order detail.
 *
 * Stripe webhook handling lives in routes/billing.ts (it shares the
 * raw-body verification with the subscription flow). The Lulu webhook
 * for print-job status transitions is mounted in index.ts because it
 * also needs the raw body for HMAC verification, before express.json().
 */

import { Router } from "express";
import Stripe from "stripe";
import prisma from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { debug } from "../lib/debug.js";
import {
  calculatePrintJobCost,
  getPrintJob,
  LULU_CONFIG,
  type ShippingAddress,
} from "../services/luluClient.js";
import { buildPrintPdfBytes, storePrintPdfBytes } from "../services/printPdfBuilder.js";
import { readImage } from "../lib/storage.js";
import {
  submitOrderToLulu,
  PRINT_ORDER_STATUS,
} from "../services/printSubmit.js";

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

const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? new Stripe(stripeKey) : null;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

function totalCustomerPriceCents(opts: {
  printCostCents: number;
  shippingCostCents: number;
}): number {
  // Markup on the print cost only; shipping is pass-through. Tax stays
  // with Lulu — they collect it at fulfillment.
  return Math.round(opts.printCostCents * PRINT_MARKUP) + opts.shippingCostCents;
}

/** Validate the incoming address shape before forwarding to Lulu. */
function validateShippingAddress(input: any): ShippingAddress {
  const required: (keyof ShippingAddress)[] = [
    "name",
    "street1",
    "city",
    "state_code",
    "country_code",
    "postcode",
    "phone_number",
  ];
  if (!input || typeof input !== "object") {
    throw new Error("shippingAddress is required");
  }
  for (const key of required) {
    const value = input[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`shippingAddress.${key} is required`);
    }
  }
  return {
    name: String(input.name).trim(),
    street1: String(input.street1).trim(),
    street2: input.street2 ? String(input.street2).trim() : undefined,
    city: String(input.city).trim(),
    state_code: String(input.state_code).trim(),
    country_code: String(input.country_code).trim().toUpperCase(),
    postcode: String(input.postcode).trim(),
    phone_number: String(input.phone_number).trim(),
  };
}

/**
 * Compute interior page count without building the PDF — needed for
 * the cost quote. Mirrors the padding logic in printPdfBuilder.ts:
 * one blank front page + one page per scene, padded up to a multiple
 * of 4 for saddle-stitch binding.
 */
function estimateInteriorPageCount(sceneCount: number): number {
  const raw = sceneCount + 1; // +1 for the blank front matter
  return Math.ceil(raw / 4) * 4;
}

router.get("/config", requireAdmin, (_req, res) => {
  res.json({
    baseUrl: LULU_CONFIG.baseUrl,
    isConfigured: LULU_CONFIG.isConfigured,
    defaultPodPackageId: LULU_CONFIG.defaultPodPackageId,
    markup: PRINT_MARKUP,
  });
});

// POST /api/print/quote — user-facing cost quote.
// Body: { storyId, shippingAddress, quantity? }
// Doesn't write anything (no orphan rows) — just calls Lulu and
// returns the breakdown.
router.post("/quote", async (req, res) => {
  try {
    if (!LULU_CONFIG.isConfigured) {
      return res.status(503).json({ error: "Print is not configured." });
    }
    const { storyId, shippingAddress, quantity } = req.body || {};
    if (!storyId || typeof storyId !== "string") {
      return res.status(400).json({ error: "storyId is required" });
    }
    let address: ShippingAddress;
    try {
      address = validateShippingAddress(shippingAddress);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const qty = Math.max(1, Math.min(20, Number(quantity) || 1));

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: {
        scenes: { select: { id: true } },
        universe: { select: { userId: true } },
      },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });
    // Owners and admins can quote. Skip for public stories — printing
    // someone else's story isn't supported right now.
    const userId = req.userId as string;
    const requester = await prisma.user.findUnique({ where: { id: userId } });
    const isAdmin = requester?.role === "admin";
    if (!isAdmin && story.universe.userId !== userId && story.createdById !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (story.scenes.length === 0) {
      return res.status(400).json({ error: "This story doesn't have any pages yet." });
    }

    const podPackageId = LULU_CONFIG.defaultPodPackageId;
    if (!podPackageId) {
      return res.status(503).json({
        error:
          "LULU_DEFAULT_POD_PACKAGE_ID is not set. Pick a SKU at developers.lulu.com/price-calculator and set the env var.",
      });
    }

    const pageCount = estimateInteriorPageCount(story.scenes.length);
    const quote = await calculatePrintJobCost({
      pageCount,
      quantity: qty,
      shippingAddress: address,
    });
    const customerPriceCents = totalCustomerPriceCents({
      printCostCents: quote.printCostCents,
      shippingCostCents: quote.shippingCostCents,
    });

    res.json({
      pageCount,
      quantity: qty,
      printCostCents: quote.printCostCents,
      shippingCostCents: quote.shippingCostCents,
      taxCostCents: quote.taxCostCents,
      // What Lulu would charge us.
      luluTotalCostCents: quote.totalCostCents,
      // What the customer pays Stripe (markup on print + pass-through shipping).
      customerPriceCents,
      shippingLevel: quote.shippingLevel,
    });
  } catch (e: any) {
    debug.error(`Print quote failed: ${e?.message}`);
    res.status(500).json({ error: e?.message || "Failed to compute print quote" });
  }
});

// POST /api/print/checkout — user-facing Stripe Checkout flow.
// Body: { storyId, shippingAddress, quantity? }
// Builds the PDFs, creates a draft PrintOrder, then a Stripe Checkout
// session pointing back to our success page. The Stripe webhook
// (routes/billing.ts) flips the order to "paid" and calls
// submitOrderToLulu when the payment completes.
router.post("/checkout", async (req, res) => {
  try {
    if (!LULU_CONFIG.isConfigured) {
      return res.status(503).json({ error: "Print is not configured." });
    }
    if (!stripe) {
      return res.status(503).json({ error: "Billing is not configured." });
    }
    const { storyId, shippingAddress, quantity } = req.body || {};
    if (!storyId || typeof storyId !== "string") {
      return res.status(400).json({ error: "storyId is required" });
    }
    let address: ShippingAddress;
    try {
      address = validateShippingAddress(shippingAddress);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const qty = Math.max(1, Math.min(20, Number(quantity) || 1));

    const userId = req.userId as string;
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        universe: { select: { userId: true } },
      },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });

    const requester = await prisma.user.findUnique({ where: { id: userId } });
    const isAdmin = requester?.role === "admin";
    if (!isAdmin && story.universe.userId !== userId && story.createdById !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (story.scenes.length === 0) {
      return res.status(400).json({ error: "This story doesn't have any pages yet." });
    }

    const podPackageId = LULU_CONFIG.defaultPodPackageId;
    if (!podPackageId) {
      return res.status(503).json({
        error: "LULU_DEFAULT_POD_PACKAGE_ID is not set.",
      });
    }

    // Pre-fetch each scene's illustration (parallel) — same shape as
    // the admin endpoint so the PDF builder stays sync-call-friendly.
    const sceneImages = await Promise.all(
      story.scenes.map((s) => (s.imageUrl ? readImage(s.imageUrl) : Promise.resolve(null)))
    );

    const built = await buildPrintPdfBytes({
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

    // Run the (slow) PDF uploads in parallel with the (slow) Lulu
    // quote — they're independent. The quote is re-run here at the
    // exact page count we built, so it can't drift from the price the
    // user saw on /quote.
    const [pdfs, quote] = await Promise.all([
      storePrintPdfBytes(built),
      calculatePrintJobCost({
        pageCount: built.pageCount,
        quantity: qty,
        shippingAddress: address,
      }),
    ]);
    const customerPriceCents = totalCustomerPriceCents({
      printCostCents: quote.printCostCents,
      shippingCostCents: quote.shippingCostCents,
    });

    const order = await prisma.printOrder.create({
      data: {
        userId,
        storyId: story.id,
        status: PRINT_ORDER_STATUS.pending_payment,
        luluPrintCostCents: quote.printCostCents,
        luluShippingCostCents: quote.shippingCostCents,
        customerPriceCents,
        shippingAddress: JSON.stringify(address),
        coverPdfUrl: pdfs.coverPdfUrl,
        interiorPdfUrl: pdfs.interiorPdfUrl,
      },
    });

    // Reuse the user's Stripe customer if they're already a premium
    // subscriber, otherwise let Stripe Checkout create one inline.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: requester?.stripeCustomerId || undefined,
      customer_email: requester?.stripeCustomerId ? undefined : requester?.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Printed book: ${story.title}`,
              description: `Hardcover-quality print, shipped to ${address.city}, ${address.country_code}`,
            },
            unit_amount: customerPriceCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/print/orders/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/reading/${story.id}?checkout=cancelled`,
      metadata: {
        kind: "print",
        orderId: order.id,
        userId,
      },
    });

    await prisma.printOrder.update({
      where: { id: order.id },
      data: { stripeSessionId: session.id },
    });

    debug.story("Print checkout session created", {
      orderId: order.id,
      sessionId: session.id,
      customerPriceCents,
    });

    res.json({ url: session.url, orderId: order.id });
  } catch (e: any) {
    debug.error(`Print checkout failed: ${e?.message}`);
    res.status(500).json({ error: e?.message || "Failed to start checkout" });
  }
});

// GET /api/print/orders — list current user's print orders.
router.get("/orders", async (req, res) => {
  try {
    const orders = await prisma.printOrder.findMany({
      where: { userId: req.userId as string },
      orderBy: { createdAt: "desc" },
      include: { story: { select: { id: true, title: true } } },
    });
    res.json({
      items: orders.map((o) => ({
        id: o.id,
        status: o.status,
        storyId: o.storyId,
        storyTitle: o.story?.title || "(deleted)",
        customerPriceCents: o.customerPriceCents,
        luluTrackingUrl: o.luluTrackingUrl,
        rejectionReason: o.rejectionReason,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
    });
  } catch (e: any) {
    debug.error(`Failed to list print orders: ${e?.message}`);
    res.status(500).json({ error: "Failed to list orders" });
  }
});

// POST /api/print/test-order — admin end-to-end sandbox test
// Body: { storyId, shippingAddress?, dryRun? }
router.post("/test-order", requireAdmin, async (req, res) => {
  try {
    if (!LULU_CONFIG.isConfigured) {
      return res.status(503).json({
        error: "Lulu is not configured. Set LULU_CLIENT_KEY/LULU_CLIENT_SECRET.",
      });
    }

    const { storyId, shippingAddress, dryRun } = req.body || {};
    if (!storyId || typeof storyId !== "string") {
      return res.status(400).json({ error: "storyId is required" });
    }

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });

    const address: ShippingAddress = shippingAddress
      ? validateShippingAddress(shippingAddress)
      : SAMPLE_LULU_ADDRESS;
    const podPackageId = LULU_CONFIG.defaultPodPackageId;
    if (!podPackageId) {
      return res.status(503).json({
        error:
          "LULU_DEFAULT_POD_PACKAGE_ID is not set. Pick a SKU at developers.lulu.com/price-calculator and set the env var.",
      });
    }

    const sceneImages = await Promise.all(
      story.scenes.map((s) => (s.imageUrl ? readImage(s.imageUrl) : Promise.resolve(null)))
    );

    const built = await buildPrintPdfBytes({
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

    const order = await prisma.printOrder.create({
      data: {
        userId: req.userId as string,
        storyId: story.id,
        status: PRINT_ORDER_STATUS.draft,
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

    const submission = await submitOrderToLulu(order.id);

    res.json({
      orderId: order.id,
      luluJobId: submission.luluPrintJobId,
      luluStatus: submission.luluStatusName,
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

// GET /api/print/orders/:id — order detail (user-scoped, admin can see any).
router.get("/orders/:id", async (req, res) => {
  try {
    const userId = req.userId as string;
    const requester = await prisma.user.findUnique({ where: { id: userId } });
    const isAdmin = requester?.role === "admin";

    const order = await prisma.printOrder.findUnique({
      where: { id: req.params.id as string },
      include: { story: { select: { id: true, title: true } } },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!isAdmin && order.userId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    let luluStatus: any = null;
    let luluLineItems: any = null;
    if (order.luluPrintJobId) {
      try {
        const job = await getPrintJob(order.luluPrintJobId);
        luluStatus = job.status || null;
        luluLineItems = job.line_items?.map((li) => ({
          id: li.id,
          status: li.status,
          tracking_urls: li.tracking_urls,
        })) ?? null;
      } catch (e: any) {
        luluStatus = { name: "lookup_failed", messages: [e?.message || ""] };
      }
    }
    res.json({
      order: {
        id: order.id,
        status: order.status,
        storyId: order.storyId,
        storyTitle: order.story?.title || "(deleted)",
        customerPriceCents: order.customerPriceCents,
        luluPrintCostCents: isAdmin ? order.luluPrintCostCents : undefined,
        luluShippingCostCents: order.luluShippingCostCents,
        luluPrintJobId: order.luluPrintJobId,
        luluTrackingUrl: order.luluTrackingUrl,
        rejectionReason: order.rejectionReason,
        coverPdfUrl: isAdmin ? order.coverPdfUrl : undefined,
        interiorPdfUrl: isAdmin ? order.interiorPdfUrl : undefined,
        shippingAddress: order.shippingAddress,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      luluStatus,
      luluLineItems: isAdmin ? luluLineItems : undefined,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to fetch order" });
  }
});

export default router;
