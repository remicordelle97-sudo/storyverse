import jwt from "jsonwebtoken";

// Resolve the signing secret at module load. In production we refuse to
// start without one rather than silently falling back to a known string —
// anyone reading the source could otherwise mint valid tokens.
function resolveJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (value && value.length >= 32) return value;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is missing or too short (min 32 chars). Set it in the production environment before booting."
    );
  }

  // Dev fallback — log loudly so it's not accidentally relied on.
  console.warn(
    "[jwt] JWT_SECRET not set or shorter than 32 chars; using a development fallback. DO NOT deploy without setting JWT_SECRET."
  );
  return "storyverse-dev-secret-change-in-production-only-for-local-development";
}

const JWT_SECRET = resolveJwtSecret();
const ACCESS_TOKEN_EXPIRY = "1h";
const REFRESH_TOKEN_EXPIRY = "7d";

export function signAccessToken(userId: string, familyId: string | null, impersonatedBy?: string): string {
  const payload: Record<string, any> = { userId, familyId };
  if (impersonatedBy) payload.impersonatedBy = impersonatedBy;
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: "refresh" }, JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

export function verifyToken(token: string): jwt.JwtPayload {
  return jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
}
