/**
 * Submit a PrintOrder batch to Lulu.
 *
 * A "batch" is one or more PrintOrder rows that share a `printBatchId`.
 * The cart-checkout flow groups every book in a single Stripe payment
 * into one batch and one Lulu print-job (with multiple line_items),
 * so a single luluPrintJobId covers every order in the batch.
 *
 * Idempotent: if the batch already has a luluPrintJobId, return it
 * without re-submitting. On Lulu rejection, every row in the batch is
 * marked failed with the same rejection reason.
 */

import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import {
  createPrintJob,
  type ShippingAddress,
  type LuluPrintJob,
} from "./luluClient.js";

export const PRINT_ORDER_STATUS = {
  // Pre-checkout: book has been added to the cart.
  cart: "cart",
  // Stripe Checkout session created, awaiting webhook.
  pending_payment: "pending_payment",
  // Phase-1 admin smoke-test path (no payment).
  draft: "draft",
  // Stripe webhook fired; about to call Lulu.
  paid: "paid",
  // Lulu accepted the print job.
  submitted: "submitted",
  in_production: "in_production",
  shipped: "shipped",
  delivered: "delivered",
  // Terminal states.
  cancelled: "cancelled",
  failed: "failed",
  refunded: "refunded",
} as const;

export type PrintOrderStatus = (typeof PRINT_ORDER_STATUS)[keyof typeof PRINT_ORDER_STATUS];

/**
 * If R2 isn't configured, the storage helper returns a relative
 * /images/... path. Lulu can't fetch a relative path — absolutize it
 * via APP_URL so it points at the public Express static mount.
 */
function externalizePdfUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  if (!base) {
    throw new Error(
      "APP_URL is not set, and PDF storage is local. Configure R2 or set APP_URL so Lulu can fetch the printable files."
    );
  }
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

export interface SubmitToLuluResult {
  luluPrintJobId: number;
  luluStatusName: string | undefined;
}

/**
 * Submit every PrintOrder row for the given batchId as a single Lulu
 * print-job with N line items. Expects every row to have its
 * coverPdfUrl, interiorPdfUrl, and shippingAddress populated (the
 * cart-checkout endpoint and the admin test path both ensure this
 * before flipping to pending_payment / draft).
 */
export async function submitBatchToLulu(batchId: string): Promise<SubmitToLuluResult> {
  const rows = await prisma.printOrder.findMany({
    where: { printBatchId: batchId },
    include: {
      story: { select: { title: true } },
      user: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) {
    throw new Error(`PrintOrder batch ${batchId} not found`);
  }

  // Idempotency: any row carrying a luluPrintJobId means we already
  // submitted this batch (Stripe webhook retry, etc).
  const alreadySubmitted = rows.find((r) => r.luluPrintJobId);
  if (alreadySubmitted) {
    debug.story(`PrintOrder batch ${batchId} already submitted (Lulu ${alreadySubmitted.luluPrintJobId})`);
    return {
      luluPrintJobId: Number(alreadySubmitted.luluPrintJobId),
      luluStatusName: alreadySubmitted.status,
    };
  }

  for (const r of rows) {
    if (!r.coverPdfUrl || !r.interiorPdfUrl) {
      throw new Error(`PrintOrder ${r.id} (batch ${batchId}) is missing PDFs`);
    }
  }

  let address: ShippingAddress;
  try {
    address = JSON.parse(rows[0].shippingAddress) as ShippingAddress;
  } catch {
    throw new Error(`PrintOrder batch ${batchId} has invalid shippingAddress JSON`);
  }
  const contactEmail = rows[0].user.email || "support@mystoryverse.app";

  let luluJob: LuluPrintJob;
  try {
    luluJob = await createPrintJob({
      externalId: batchId,
      contactEmail,
      shippingAddress: address,
      // Cheapest level frozen at quote time.
      shippingLevel: "MAIL",
      lineItems: rows.map((r, i) => ({
        externalId: `${batchId}-${i + 1}`,
        title: r.story.title,
        coverPdfUrl: externalizePdfUrl(r.coverPdfUrl),
        interiorPdfUrl: externalizePdfUrl(r.interiorPdfUrl),
        quantity: 1,
      })),
    });
  } catch (e: any) {
    const reason = (e?.message || "createPrintJob failed").slice(0, 500);
    await prisma.printOrder.updateMany({
      where: { printBatchId: batchId },
      data: { status: PRINT_ORDER_STATUS.failed, rejectionReason: reason },
    });
    throw e;
  }

  await prisma.printOrder.updateMany({
    where: { printBatchId: batchId },
    data: {
      status: PRINT_ORDER_STATUS.submitted,
      luluPrintJobId: String(luluJob.id),
    },
  });

  debug.story("PrintOrder batch submitted to Lulu", {
    batchId,
    rowCount: rows.length,
    luluJobId: luluJob.id,
    status: luluJob.status?.name,
  });

  return { luluPrintJobId: luluJob.id, luluStatusName: luluJob.status?.name };
}

/**
 * Map a Lulu print-job status name to our internal PrintOrder.status
 * vocabulary. Lulu uses SHOUTY_SNAKE_CASE; we use lowercase. Returns
 * null for statuses that shouldn't move our state.
 *
 * Lulu's status taxonomy:
 *   CREATED, UNPAID, PAYMENT_IN_PROGRESS, PRODUCTION_DELAYED,
 *   PRODUCTION_READY, IN_PRODUCTION, SHIPPED, REJECTED, CANCELED, ERROR.
 * We pay Lulu out of credit, so UNPAID/PAYMENT_IN_PROGRESS shouldn't
 * happen in practice.
 */
export function mapLuluStatusToOrderStatus(
  luluStatus: string | undefined
): PrintOrderStatus | null {
  if (!luluStatus) return null;
  switch (luluStatus.toUpperCase()) {
    case "CREATED":
    case "UNPAID":
    case "PAYMENT_IN_PROGRESS":
    case "PRODUCTION_READY":
      return PRINT_ORDER_STATUS.submitted;
    case "PRODUCTION_DELAYED":
    case "IN_PRODUCTION":
      return PRINT_ORDER_STATUS.in_production;
    case "SHIPPED":
      return PRINT_ORDER_STATUS.shipped;
    case "REJECTED":
    case "ERROR":
      return PRINT_ORDER_STATUS.failed;
    case "CANCELED":
      return PRINT_ORDER_STATUS.cancelled;
    default:
      return null;
  }
}
