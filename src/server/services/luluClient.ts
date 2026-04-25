/**
 * Lulu print-on-demand API client.
 *
 * Phase 1 (sandbox only): cost calculation + print job create/get +
 * shipping options. Auth uses OAuth2 client_credentials with a
 * cached access token.
 *
 * Currency convention: Lulu returns prices as decimal strings ("12.34")
 * in USD. We convert to cents at the boundary so everything inside the
 * app stays in integer cents, which is also what Stripe expects.
 */

import { debug } from "../lib/debug.js";

const LULU_API_BASE_URL =
  process.env.LULU_API_BASE_URL || "https://api.sandbox.lulu.com";
const LULU_CLIENT_KEY = process.env.LULU_CLIENT_KEY || "";
const LULU_CLIENT_SECRET = process.env.LULU_CLIENT_SECRET || "";
const LULU_DEFAULT_POD_PACKAGE_ID =
  process.env.LULU_DEFAULT_POD_PACKAGE_ID || "0850X0850FCSTDPB060UW444MXX";

// Token cache. Lulu access tokens last ~1h; refresh when within 60s
// of expiry to avoid mid-request invalidation.
let cachedToken: { value: string; expiresAt: number } | null = null;

function isLuluConfigured(): boolean {
  return Boolean(LULU_CLIENT_KEY && LULU_CLIENT_SECRET);
}

async function getAccessToken(): Promise<string> {
  if (!isLuluConfigured()) {
    throw new Error(
      "Lulu is not configured. Set LULU_CLIENT_KEY and LULU_CLIENT_SECRET."
    );
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const credentials = Buffer.from(
    `${LULU_CLIENT_KEY}:${LULU_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(
    `${LULU_API_BASE_URL}/auth/realms/glasstree/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lulu auth failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

async function luluFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${LULU_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...((init.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lulu ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

function dollarsToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// === Public surface ===========================================

export const LULU_CONFIG = {
  defaultPodPackageId: LULU_DEFAULT_POD_PACKAGE_ID,
  baseUrl: LULU_API_BASE_URL,
  isConfigured: isLuluConfigured,
};

export interface ShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state_code: string;
  country_code: string; // ISO 3166-1 alpha-2
  postcode: string;
  phone_number: string;
}

export interface CostBreakdown {
  // All in integer cents, USD.
  printCostCents: number;
  shippingCostCents: number;
  // Lulu also returns taxes; we surface them separately so the
  // markup logic only multiplies the print cost, not tax.
  taxCostCents: number;
  totalCostCents: number;
  // Cheapest shipping level Lulu found for this address; useful for
  // showing the user an ETA range later.
  shippingLevel: string;
}

interface LuluCostResponse {
  total_cost_excl_tax: string;
  total_tax: string;
  total_cost_incl_tax: string;
  shipping_cost?: { total_cost_incl_tax: string };
  line_item_costs?: Array<{ cost_excl_tax: string; total_tax: string; total_cost_incl_tax: string }>;
}

/**
 * Calculate the price Lulu would charge for printing N copies of a
 * given book at a given address. We default the shipping level to
 * MAIL (cheapest) for now — pluggable later.
 */
export async function calculatePrintJobCost(args: {
  pageCount: number;
  quantity: number;
  shippingAddress: ShippingAddress;
  podPackageId?: string;
  shippingLevel?: string;
}): Promise<CostBreakdown> {
  const podPackageId = args.podPackageId || LULU_DEFAULT_POD_PACKAGE_ID;
  const shippingLevel = args.shippingLevel || "MAIL";
  const body = {
    line_items: [
      {
        page_count: args.pageCount,
        pod_package_id: podPackageId,
        quantity: args.quantity,
      },
    ],
    shipping_address: args.shippingAddress,
    shipping_option: shippingLevel,
  };
  debug.story("Lulu cost calc", {
    podPackageId,
    pageCount: args.pageCount,
    quantity: args.quantity,
    country: args.shippingAddress.country_code,
  });
  const data = await luluFetch<LuluCostResponse>(
    "/print-job-cost-calculations/",
    { method: "POST", body: JSON.stringify(body) }
  );
  const printCostCents = (data.line_item_costs || []).reduce(
    (acc, li) => acc + dollarsToCents(li.cost_excl_tax),
    0
  );
  const shippingCostCents = dollarsToCents(
    data.shipping_cost?.total_cost_incl_tax
  );
  const taxCostCents = dollarsToCents(data.total_tax);
  const totalCostCents = dollarsToCents(data.total_cost_incl_tax);
  return {
    printCostCents,
    shippingCostCents,
    taxCostCents,
    totalCostCents,
    shippingLevel,
  };
}

export interface CreatePrintJobInput {
  externalId: string;
  contactEmail: string;
  shippingAddress: ShippingAddress;
  shippingLevel: string;
  coverPdfUrl: string;
  interiorPdfUrl: string;
  title: string;
  podPackageId?: string;
  quantity?: number;
}

export interface LuluPrintJob {
  id: number;
  status: { name: string; messages?: string[] };
  tracking_urls?: string[];
  line_items?: Array<{ tracking_urls?: string[] }>;
}

/**
 * Submit a print job to Lulu. The PDFs at coverPdfUrl/interiorPdfUrl
 * must be publicly fetchable for at least the lifetime of the job —
 * Lulu downloads them asynchronously after the request returns.
 */
export async function createPrintJob(
  input: CreatePrintJobInput
): Promise<LuluPrintJob> {
  const podPackageId = input.podPackageId || LULU_DEFAULT_POD_PACKAGE_ID;
  const quantity = input.quantity || 1;
  const body = {
    external_id: input.externalId,
    contact_email: input.contactEmail,
    line_items: [
      {
        external_id: `${input.externalId}-1`,
        printable_normalization: {
          cover: { source_url: input.coverPdfUrl },
          interior: { source_url: input.interiorPdfUrl },
          pod_package_id: podPackageId,
        },
        quantity,
        title: input.title,
      },
    ],
    shipping_address: input.shippingAddress,
    shipping_level: input.shippingLevel,
  };
  return luluFetch<LuluPrintJob>("/print-jobs/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getPrintJob(luluId: string | number): Promise<LuluPrintJob> {
  return luluFetch<LuluPrintJob>(`/print-jobs/${luluId}/`);
}
