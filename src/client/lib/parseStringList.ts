/**
 * Parse a stored "list of strings" field that's either a JSON array
 * (the canonical case — themes and personalityTraits are stored this
 * way by the server) or a CSV string (legacy / hand-edited rows).
 * Returns an empty array on anything else, never throws.
 *
 * Centralized so every page renders the same data the same way; the
 * client used to have three slightly-different inline implementations
 * that disagreed on edge cases (drop CSV vs. parse it; raw fallback
 * vs. empty).
 */
export function parseStringList(raw: unknown): string[] {
  if (!raw || typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    // fall through to CSV
  }

  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
