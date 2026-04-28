// Shared cursor-pagination helpers for the read endpoints.
//
// All paginated lists return { items, nextCursor: string | null }.
// Pagination uses Prisma's `cursor + skip:1 + take: limit + 1` trick:
// pull one extra row to detect more-available without a separate
// count() query, then trim back to the requested page size.
//
// IMPORTANT: lists must order by `[ <timestamp>, id ]`, not timestamp
// alone. Two rows can share the same `createdAt` (timestamps are
// only millisecond-precise, and bulk-generated content easily ties).
// Without `id` as a secondary sort the cursor + skip:1 trick can
// either skip a row or repeat one as you page through, because
// Prisma's cursor positions on a primary key but the orderBy still
// controls the result order.

export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 100;

export function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(n, MAX_PAGE_LIMIT);
}

/** Wrap a Prisma findMany result in our pagination envelope. Pass
 * `limit + 1` rows; this returns the trimmed page plus a nextCursor
 * (the id of the last item on the current page) when there's more,
 * or null when the caller has reached the end. */
export function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    const items = rows.slice(0, limit);
    return { items, nextCursor: items[items.length - 1].id };
  }
  return { items: rows, nextCursor: null };
}
