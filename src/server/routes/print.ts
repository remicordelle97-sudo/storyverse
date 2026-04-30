/**
 * Print-on-demand routes — cart-based flow.
 *
 * User flow (Phase 2 cart UX):
 *   POST /api/print/cart               — add a story to cart (status=cart)
 *   GET  /api/print/cart               — list cart items + total quote
 *   DELETE /api/print/cart/:id         — remove cart item
 *   POST /api/print/cart/checkout      — build PDFs, assign batchId,
 *                                        create Stripe Checkout session
 *   GET  /api/print/orders             — list user's print batches
 *   GET  /api/print/orders/:batchId    — batch detail
 *
 * Admin smoke test (single-book, no payment):
 *   POST /api/print/test-order
 *   GET  /api/print/config
 *
 * Stripe webhook handling lives in routes/billing.ts; the Lulu webhook
 * for status callbacks lives in routes/luluWebhook.ts.
 */

import { Router } from "express";
import crypto from "crypto";
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
  submitBatchToLulu,
  PRINT_ORDER_STATUS,
} from "../services/printSubmit.js";
import {
  validateShippingAddress,
  parseStoredAddress,
} from "../lib/shippingAddress.js";

const router = Router();

const PRINT_MARKUP = 1.5;

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

/**
 * Compute interior page count without building the PDF — needed for
 * the cost quote. Mirrors the padding logic in printPdfBuilder.ts:
 * one blank front page + one page per scene, padded up to a multiple
 * of 4 for saddle-stitch binding.
 */
function estimateInteriorPageCount(sceneCount: number): number {
  const raw = sceneCount + 1;
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

// ─── Cart ──────────────────────────────────────────────────────

// POST /api/print/cart — add a story to the cart.
// Body: { storyId }. No PDFs built yet — that happens at checkout.
router.post("/cart", async (req, res) => {
  try {
    const { storyId } = req.body || {};
    if (!storyId || typeof storyId !== "string") {
      return res.status(400).json({ error: "storyId is required" });
    }
    const userId = req.userId as string;

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: {
        scenes: { select: { id: true } },
        universe: { select: { userId: true } },
      },
    });
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.universe.userId !== userId && story.createdById !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (story.status !== "published") {
      return res.status(400).json({
        error: "Wait for the story to finish illustrating before adding it to the print list.",
      });
    }
    if (story.scenes.length === 0) {
      return res.status(400).json({ error: "This story has no pages." });
    }

    // Don't let the same story land in the cart twice — duplicates are
    // confusing in the list and a single Lulu line_item already covers
    // the "I want N copies" case via quantity (Phase 3 will surface it).
    const existing = await prisma.printOrder.findFirst({
      where: { userId, storyId, status: PRINT_ORDER_STATUS.cart },
    });
    if (existing) {
      return res.json({ id: existing.id, alreadyInCart: true });
    }

    const cartItem = await prisma.printOrder.create({
      data: {
        userId,
        storyId,
        status: PRINT_ORDER_STATUS.cart,
      },
    });
    res.json({ id: cartItem.id, alreadyInCart: false });
  } catch (e: any) {
    debug.error(`Print cart-add failed: ${e?.message}`);
    res.status(500).json({ error: e?.message || "Failed to add to cart" });
  }
});

// GET /api/print/cart — return cart items + a combined Lulu quote
// using the user's saved shipping address.
router.get("/cart", async (req, res) => {
  try {
    const userId = req.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    const address = parseStoredAddress(user.shippingAddress);

    const items = await prisma.printOrder.findMany({
      where: { userId, status: PRINT_ORDER_STATUS.cart },
      include: {
        story: {
          select: {
            id: true,
            title: true,
            status: true,
            scenes: { select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const cartLines = items.map((item) => ({
      id: item.id,
      storyId: item.storyId,
      storyTitle: item.story.title,
      sceneCount: item.story.scenes.length,
      pageCount: estimateInteriorPageCount(item.story.scenes.length),
    }));

    let quote: {
      printCostCents: number;
      shippingCostCents: number;
      taxCostCents: number;
      customerPriceCents: number;
      shippingLevel: string;
      perItem: { id: string; printCostCents: number }[];
    } | null = null;

    // No address yet, no items, or Lulu unconfigured → skip the quote
    // call and let the cart page render the empty/setup state. We
    // still return the cart contents so the page can prompt for an
    // address.
    if (address && cartLines.length > 0 && LULU_CONFIG.isConfigured) {
      const podPackageId = LULU_CONFIG.defaultPodPackageId;
      if (!podPackageId) {
        return res.status(503).json({ error: "LULU_DEFAULT_POD_PACKAGE_ID is not set." });
      }
      const luluResp = await calculatePrintJobCost({
        pageCount: cartLines[0].pageCount, // unused when line_items provided
        quantity: 1,
        shippingAddress: address,
        lineItems: cartLines.map((l) => ({
          page_count: l.pageCount,
          pod_package_id: podPackageId,
          quantity: 1,
        })),
      });
      const customerPriceCents =
        Math.round(luluResp.printCostCents * PRINT_MARKUP) + luluResp.shippingCostCents;
      // Per-item attribution for display: each item's share of the
      // markup'd print cost. Shipping is one flat fee for the batch
      // and isn't broken out per item in the UI.
      const perItem = cartLines.map((l, i) => ({
        id: l.id,
        // Per-item cost: each book proportional to its page count.
        // Lulu doesn't break down per-line-item costs in the same shape
        // across products, so we approximate with page-count weighting.
        printCostCents: Math.round(
          (luluResp.printCostCents * l.pageCount) /
            cartLines.reduce((acc, it) => acc + it.pageCount, 0)
        ),
      }));
      quote = {
        printCostCents: luluResp.printCostCents,
        shippingCostCents: luluResp.shippingCostCents,
        taxCostCents: luluResp.taxCostCents,
        customerPriceCents,
        shippingLevel: luluResp.shippingLevel,
        perItem,
      };
    }

    res.json({
      items: cartLines,
      address,
      quote,
      hasAddress: Boolean(address),
      luluConfigured: LULU_CONFIG.isConfigured,
    });
  } catch (e: any) {
    debug.error(`Print cart fetch failed: ${e?.message}`);
    res.status(500).json({ error: e?.message || "Failed to load cart" });
  }
});

// DELETE /api/print/cart/:id — remove an item from the cart.
router.delete("/cart/:id", async (req, res) => {
  try {
    const userId = req.userId as string;
    const id = req.params.id as string;
    const item = await prisma.printOrder.findUnique({ where: { id } });
    if (!item || item.userId !== userId) {
      return res.status(404).json({ error: "Cart item not found" });
    }
    if (item.status !== PRINT_ORDER_STATUS.cart) {
      return res.status(400).json({ error: "Item is no longer in cart" });
    }
    await prisma.printOrder.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to remove cart item" });
  }
});

// POST /api/print/cart/checkout — turn the user's cart into a
// pending_payment batch and start a Stripe Checkout session.
router.post("/cart/checkout", async (req, res) => {
  try {
    if (!LULU_CONFIG.isConfigured) {
      return res.status(503).json({ error: "Print is not configured." });
    }
    if (!stripe) {
      return res.status(503).json({ error: "Billing is not configured." });
    }
    const userId = req.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });
    const address = parseStoredAddress(user.shippingAddress);
    if (!address) {
      return res
        .status(400)
        .json({ error: "Add a shipping address in your account before checking out." });
    }

    const items = await prisma.printOrder.findMany({
      where: { userId, status: PRINT_ORDER_STATUS.cart },
      include: {
        story: {
          select: {
            id: true,
            title: true,
            status: true,
            scenes: { orderBy: { sceneNumber: "asc" } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    if (items.length === 0) {
      return res.status(400).json({ error: "Your print list is empty." });
    }

    const podPackageId = LULU_CONFIG.defaultPodPackageId;
    if (!podPackageId) {
      return res.status(503).json({ error: "LULU_DEFAULT_POD_PACKAGE_ID is not set." });
    }

    // Build PDFs for every cart item in parallel. The PDF builder is
    // already async-safe and the font loader is single-flighted, so
    // this just kicks off N image-fetches and N PDF assemblies.
    const builds = await Promise.all(
      items.map(async (item) => {
        const sceneImages = await Promise.all(
          item.story.scenes.map((s) =>
            s.imageUrl ? readImage(s.imageUrl) : Promise.resolve(null)
          )
        );
        const built = await buildPrintPdfBytes({
          story: {
            id: item.story.id,
            title: item.story.title,
            scenes: item.story.scenes.map((s, i) => ({
              sceneNumber: s.sceneNumber,
              content: s.content,
              image: sceneImages[i] || undefined,
            })),
          },
          podPackageId,
        });
        const pdfs = await storePrintPdfBytes(built);
        return { itemId: item.id, pageCount: built.pageCount, pdfs };
      })
    );

    // Single combined Lulu quote — the Stripe customer pays one total.
    const quote = await calculatePrintJobCost({
      pageCount: builds[0].pageCount, // ignored when lineItems is provided
      quantity: 1,
      shippingAddress: address,
      lineItems: builds.map((b) => ({
        page_count: b.pageCount,
        pod_package_id: podPackageId,
        quantity: 1,
      })),
    });
    const customerTotalCents =
      Math.round(quote.printCostCents * PRINT_MARKUP) + quote.shippingCostCents;

    // Promote the cart rows into a batch. printBatchId groups every
    // PrintOrder for the user's checkout into one Lulu print-job and
    // one Stripe payment. customerPriceCents per row holds that book's
    // share of the markup'd print cost (no shipping); luluShippingCostCents
    // is duplicated across rows so a single-row read can recover it.
    const totalPageCount = builds.reduce((acc, b) => acc + b.pageCount, 0);
    const batchId = crypto.randomUUID();
    await Promise.all(
      builds.map((b) => {
        const itemPrintShareCents = Math.round(
          (quote.printCostCents * b.pageCount) / totalPageCount
        );
        return prisma.printOrder.update({
          where: { id: b.itemId },
          data: {
            printBatchId: batchId,
            status: PRINT_ORDER_STATUS.pending_payment,
            shippingAddress: JSON.stringify(address),
            coverPdfUrl: b.pdfs.coverPdfUrl,
            interiorPdfUrl: b.pdfs.interiorPdfUrl,
            luluPrintCostCents: itemPrintShareCents,
            luluShippingCostCents: quote.shippingCostCents,
            customerPriceCents: Math.round(itemPrintShareCents * PRINT_MARKUP),
          },
        });
      })
    );

    // One Stripe line item — printing N books shows up as a single
    // "Printed books" charge with the batch total. Per-book breakdown
    // is on our /print/cart and /orders pages, not Stripe's UI.
    const description =
      items.length === 1
        ? items[0].story.title
        : `${items.length} books — including "${items[0].story.title}"`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: items.length === 1 ? `Printed book: ${items[0].story.title}` : "Printed books",
              description,
            },
            unit_amount: customerTotalCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/print/orders/${batchId}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/print/cart?checkout=cancelled`,
      metadata: {
        kind: "print",
        batchId,
        userId,
      },
    });

    await prisma.printOrder.updateMany({
      where: { printBatchId: batchId },
      data: { stripeSessionId: session.id },
    });

    debug.story("Print batch checkout session created", {
      batchId,
      sessionId: session.id,
      itemCount: items.length,
      customerTotalCents,
    });

    res.json({ url: session.url, batchId });
  } catch (e: any) {
    debug.error(`Print checkout failed: ${e?.message}`);
    res.status(500).json({ error: e?.message || "Failed to start checkout" });
  }
});

// ─── Orders ────────────────────────────────────────────────────

// GET /api/print/orders — current user's print batches.
// Groups PrintOrder rows by printBatchId. Legacy single-book orders
// (printBatchId is null, predates the cart flow) each form their own
// batch keyed by the order id so the UI shape is uniform.
router.get("/orders", async (req, res) => {
  try {
    const userId = req.userId as string;
    const orders = await prisma.printOrder.findMany({
      where: {
        userId,
        // The cart isn't an "order" — exclude.
        NOT: { status: PRINT_ORDER_STATUS.cart },
      },
      include: { story: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
    });

    const batches = new Map<
      string,
      {
        batchId: string;
        status: string;
        items: { id: string; storyId: string; storyTitle: string }[];
        customerTotalCents: number;
        luluTrackingUrl: string | null;
        rejectionReason: string;
        createdAt: Date;
      }
    >();
    for (const o of orders) {
      const key = o.printBatchId || o.id;
      const existing = batches.get(key);
      if (existing) {
        existing.items.push({
          id: o.id,
          storyId: o.storyId,
          storyTitle: o.story?.title || "(deleted)",
        });
        existing.customerTotalCents += o.customerPriceCents || 0;
        // tracking + rejection: pick the first non-empty across rows
        if (!existing.luluTrackingUrl && o.luluTrackingUrl) {
          existing.luluTrackingUrl = o.luluTrackingUrl;
        }
        if (!existing.rejectionReason && o.rejectionReason) {
          existing.rejectionReason = o.rejectionReason;
        }
      } else {
        batches.set(key, {
          batchId: key,
          status: o.status,
          items: [
            { id: o.id, storyId: o.storyId, storyTitle: o.story?.title || "(deleted)" },
          ],
          // Add shipping once; same value duplicated across rows.
          customerTotalCents: (o.customerPriceCents || 0) + (o.luluShippingCostCents || 0),
          luluTrackingUrl: o.luluTrackingUrl,
          rejectionReason: o.rejectionReason,
          createdAt: o.createdAt,
        });
      }
    }
    // Re-sort by most recent createdAt across each batch.
    const items = Array.from(batches.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    res.json({ items });
  } catch (e: any) {
    debug.error(`Failed to list print orders: ${e?.message}`);
    res.status(500).json({ error: "Failed to list orders" });
  }
});

// GET /api/print/orders/:batchId — batch detail. Accepts either a real
// printBatchId or a legacy single-row id (for orders that predate the
// cart flow).
router.get("/orders/:batchId", async (req, res) => {
  try {
    const userId = req.userId as string;
    const requester = await prisma.user.findUnique({ where: { id: userId } });
    const isAdmin = requester?.role === "admin";
    const key = req.params.batchId as string;

    // Find rows by printBatchId first; if none match, fall back to the
    // single-row legacy path where the URL param is a row id.
    let rows = await prisma.printOrder.findMany({
      where: { printBatchId: key },
      include: { story: { select: { id: true, title: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) {
      const legacy = await prisma.printOrder.findUnique({
        where: { id: key },
        include: { story: { select: { id: true, title: true } } },
      });
      if (legacy) rows = [legacy];
    }
    if (rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    const ownerId = rows[0].userId;
    if (!isAdmin && ownerId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const lead = rows[0];
    let address: ShippingAddress | null = null;
    try {
      address = JSON.parse(lead.shippingAddress) as ShippingAddress;
    } catch {
      address = null;
    }

    let luluStatus: any = null;
    let luluLineItems: any = null;
    if (lead.luluPrintJobId) {
      try {
        const job = await getPrintJob(lead.luluPrintJobId);
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

    const customerSubtotalCents = rows.reduce(
      (acc, r) => acc + (r.customerPriceCents || 0),
      0
    );
    const shippingCents = lead.luluShippingCostCents || 0;
    const customerTotalCents = customerSubtotalCents + shippingCents;

    res.json({
      batchId: lead.printBatchId || lead.id,
      status: lead.status,
      items: rows.map((r) => ({
        id: r.id,
        storyId: r.storyId,
        storyTitle: r.story?.title || "(deleted)",
        customerPriceCents: r.customerPriceCents,
      })),
      customerSubtotalCents,
      shippingCents,
      customerTotalCents,
      shippingAddress: address,
      luluTrackingUrl: lead.luluTrackingUrl,
      rejectionReason: lead.rejectionReason,
      luluPrintJobId: isAdmin ? lead.luluPrintJobId : undefined,
      luluStatus,
      luluLineItems: isAdmin ? luluLineItems : undefined,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to fetch order" });
  }
});

// ─── Admin sandbox test ────────────────────────────────────────

// POST /api/print/test-order — admin end-to-end sandbox test (single book).
router.post("/test-order", requireAdmin, async (req, res) => {
  try {
    if (!LULU_CONFIG.isConfigured) {
      return res.status(503).json({ error: "Lulu is not configured." });
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
      return res.status(503).json({ error: "LULU_DEFAULT_POD_PACKAGE_ID is not set." });
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
    const customerPriceCents =
      Math.round(quote.printCostCents * PRINT_MARKUP) + quote.shippingCostCents;

    // Admin test orders run as a single-row batch.
    const batchId = crypto.randomUUID();
    const order = await prisma.printOrder.create({
      data: {
        userId: req.userId as string,
        storyId: story.id,
        printBatchId: batchId,
        status: dryRun ? PRINT_ORDER_STATUS.draft : PRINT_ORDER_STATUS.draft,
        luluPrintCostCents: quote.printCostCents,
        luluShippingCostCents: quote.shippingCostCents,
        customerPriceCents: Math.round(quote.printCostCents * PRINT_MARKUP),
        shippingAddress: JSON.stringify(address),
        coverPdfUrl: pdfs.coverPdfUrl,
        interiorPdfUrl: pdfs.interiorPdfUrl,
      },
    });

    if (dryRun) {
      debug.story("Lulu dry-run order created", { orderId: order.id });
      return res.json({
        orderId: order.id,
        batchId,
        quote,
        customerPriceCents,
        pdfs,
        dryRun: true,
      });
    }

    const submission = await submitBatchToLulu(batchId);

    res.json({
      orderId: order.id,
      batchId,
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

export default router;
