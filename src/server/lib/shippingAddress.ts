/**
 * Shared shipping-address shape + validator.
 *
 * Used by /api/account (saving the user's profile address), the cart
 * /quote and /checkout endpoints (forwarding to Lulu), and the admin
 * test-order route. Lulu's expected shape is documented at
 * https://api.lulu.com — we mirror its field names directly.
 */

import type { ShippingAddress } from "../services/luluClient.js";

const REQUIRED_FIELDS: (keyof ShippingAddress)[] = [
  "name",
  "street1",
  "city",
  "state_code",
  "country_code",
  "postcode",
  "phone_number",
];

/**
 * Validate + canonicalise the incoming address shape. Throws on the
 * first problem so callers can surface a 400 with a single error
 * string. Mirror the client-side validation in components/AddressForm
 * — when one tightens, so should the other.
 */
export function validateShippingAddress(input: any): ShippingAddress {
  if (!input || typeof input !== "object") {
    throw new Error("shippingAddress is required");
  }
  for (const key of REQUIRED_FIELDS) {
    const value = input[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`shippingAddress.${key} is required`);
    }
  }
  const country = String(input.country_code).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("shippingAddress.country_code must be a 2-letter ISO code");
  }
  return {
    name: String(input.name).trim(),
    street1: String(input.street1).trim(),
    street2: input.street2 ? String(input.street2).trim() : undefined,
    city: String(input.city).trim(),
    state_code: String(input.state_code).trim(),
    country_code: country,
    postcode: String(input.postcode).trim(),
    phone_number: String(input.phone_number).trim(),
  };
}

/** Best-effort parse of the JSON-encoded address from a User row. */
export function parseStoredAddress(stored: string): ShippingAddress | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return validateShippingAddress(parsed);
  } catch {
    return null;
  }
}
