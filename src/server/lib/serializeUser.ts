import type { User } from "@prisma/client";

export interface SerializedUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
  plan: string;
  onboardedAt: Date | null;
  // True when User.shippingAddress is non-empty. The cart UI keys off
  // this to decide whether to ask for an address before checkout. The
  // raw address is only sent over /api/account so it doesn't leak
  // through cached /me responses.
  hasShippingAddress: boolean;
}

/**
 * Single source of truth for the user shape sent to the client.
 * Used by /api/auth/google, /api/auth/me, /api/auth/refresh
 * (when it returns a user), and admin impersonation. Adding a
 * client-visible field on the User model means updating this
 * function — every endpoint follows.
 */
export function serializeUser(user: User): SerializedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
    plan: user.plan,
    onboardedAt: user.onboardedAt,
    hasShippingAddress: Boolean(user.shippingAddress && user.shippingAddress.length > 0),
  };
}
