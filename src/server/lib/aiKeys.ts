// Centralised AI key resolution. Mirrors the prod-throw / dev-warn
// pattern in jwt.ts and storage.ts: production refuses to boot when a
// required key is missing rather than silently failing at first use.
//
// Also logs a one-time inventory of every env var that affects Google
// SDK auth resolution. Useful when production hits the
// "Invalid character in header content [\"authorization\"]" error,
// which is the @google/genai SDK falling back to Application Default
// Credentials and getting garbage. This happens when:
//   - GOOGLE_AI_KEY is unset OR
//   - GOOGLE_GENAI_USE_VERTEXAI=true is set (flips to Vertex mode) OR
//   - GOOGLE_APPLICATION_CREDENTIALS points at bad ADC creds OR
//   - GOOGLE_API_KEY / GEMINI_API_KEY (which the SDK also reads) shadow
//     our explicitly-passed apiKey

function presence(name: string): string {
  const v = process.env[name];
  if (v === undefined) return "MISSING";
  if (v === "") return "EMPTY";
  if (v !== v.trim()) return `present (length=${v.length}, HAS_WHITESPACE)`;
  return `present (length=${v.length})`;
}

function resolveKey(name: string): string {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  if (trimmed) return trimmed;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${name} is missing or empty. Refusing to boot in production — AI calls would silently fall back to broken auth paths.`,
    );
  }
  console.warn(
    `[aiKeys] ${name} not set; using empty string fallback. AI calls will fail.`,
  );
  return "";
}

// Run the diagnostic once on first import — it'll show in Railway boot
// logs and tell us at a glance whether the SDK is seeing a polluted env.
console.log("[aiKeys] Auth env inventory:");
for (const name of [
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
]) {
  console.log(`  ${name}: ${presence(name)}`);
}

export const ANTHROPIC_API_KEY = resolveKey("ANTHROPIC_API_KEY");
export const GOOGLE_AI_KEY = resolveKey("GOOGLE_AI_KEY");
