/**
 * Submit a PrintOrder to Lulu.
 *
 * Shared by the admin /test-order endpoint (Phase 1, no payment) and
 * the Stripe webhook handler (Phase 2, after the user pays). Idempotent:
 * if the order already has a luluPrintJobId, returns it without
 * re-submitting. On failure flips the order to status="failed" and
 * stores the rejection reason for the support flow.
 */

import prisma from "../lib/prisma.js";
import { debug } from "../lib/debug.js";
import {
  createPrintJob,
  type ShippingAddress,
  type LuluPrintJob,
} from "./luluClient.js";

export const PRINT_ORDER_STATUS = {
  // Pre-payment lifecycle (Phase 2 user flow)
  pending_payment: "pending_payment",
  // Phase 1 admin path (no payment) starts here.
  draft: "draft",
  paid: "paid",
  // Lulu-side states
  submitted: "submitted",
  in_production: "in_production",
  shipped: "shipped",
  delivered: "delivered",
  // Terminal states
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
 * Submit an existing PrintOrder to Lulu. Expects coverPdfUrl,
 * interiorPdfUrl, and shippingAddress to already be populated (the
 * order was created by either the admin test endpoint or the
 * /api/print/checkout flow).
 */
export async function submitOrderToLulu(orderId: string): Promise<SubmitToLuluResult> {
  const order = await prisma.printOrder.findUnique({
    where: { id: orderId },
    include: {
      story: { select: { title: true } },
      user: { select: { email: true } },
    },
  });
  if (!order) throw new Error(`PrintOrder ${orderId} not found`);

  // Idempotency: if a previous submission already landed, just return
  // the existing Lulu id. The Stripe webhook can re-fire on retry, and
  // the admin path can be replayed by mistake.
  if (order.luluPrintJobId) {
    debug.story(`PrintOrder ${orderId} already submitted to Lulu (${order.luluPrintJobId})`);
    return {
      luluPrintJobId: Number(order.luluPrintJobId),
      luluStatusName: order.status,
    };
  }

  if (!order.coverPdfUrl || !order.interiorPdfUrl) {
    throw new Error(`PrintOrder ${orderId} is missing PDFs — cannot submit to Lulu`);
  }

  let address: ShippingAddress;
  try {
    address = JSON.parse(order.shippingAddress) as ShippingAddress;
  } catch {
    throw new Error(`PrintOrder ${orderId} has invalid shippingAddress JSON`);
  }

  let luluJob: LuluPrintJob;
  try {
    luluJob = await createPrintJob({
      externalId: order.id,
      contactEmail: order.user.email || "support@mystoryverse.app",
      shippingAddress: address,
      // We froze the cheapest level at quote time — keep using it.
      shippingLevel: "MAIL",
      coverPdfUrl: externalizePdfUrl(order.coverPdfUrl),
      interiorPdfUrl: externalizePdfUrl(order.interiorPdfUrl),
      title: order.story.title,
    });
  } catch (e: any) {
    await prisma.printOrder.update({
      where: { id: order.id },
      data: {
        status: PRINT_ORDER_STATUS.failed,
        rejectionReason: (e?.message || "createPrintJob failed").slice(0, 500),
      },
    });
    throw e;
  }

  await prisma.printOrder.update({
    where: { id: order.id },
    data: {
      status: PRINT_ORDER_STATUS.submitted,
      luluPrintJobId: String(luluJob.id),
    },
  });

  debug.story("PrintOrder submitted to Lulu", {
    orderId: order.id,
    luluJobId: luluJob.id,
    status: luluJob.status?.name,
  });

  return { luluPrintJobId: luluJob.id, luluStatusName: luluJob.status?.name };
}

/**
 * Map a Lulu print-job status name to our internal PrintOrder.status
 * vocabulary. Lulu uses SHOUTY_SNAKE_CASE; we use lowercase. Returns
 * null for statuses that shouldn't move our state (anything pre-CREATED
 * or unrecognized — we leave the existing status alone).
 *
 * Lulu's full status taxonomy:
 *   CREATED, UNPAID, PAYMENT_IN_PROGRESS, PRODUCTION_DELAYED,
 *   PRODUCTION_READY, IN_PRODUCTION, SHIPPED, REJECTED, CANCELED, ERROR.
 * Lulu pays themselves at job creation (we have a credit account), so
 * UNPAID/PAYMENT_IN_PROGRESS shouldn't appear in practice.
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
