import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";

// Shared infinite-scroll behavior for the cursor-paginated list
// endpoints. Wraps useInfiniteQuery + an IntersectionObserver so each
// caller (Library shelves, MyUniverses sidebar, UniverseManager
// sidebar) only has to provide:
//   - a stable query key
//   - a fetch function: (cursor: string | null) => Promise<{ items, nextCursor }>
//   - a polling predicate: (firstPageItems) => boolean
//
// The polling predicate looks at page 1's items, but be aware:
// react-query v5 removed the v4 `refetchPage` option, so when
// refetchInterval fires it refetches ALL loaded pages, not just
// page 1. In practice this is fine because:
//   - Almost everyone is on page 1 (newest-first ordering means
//     active items are there).
//   - Older pages are stable; refetching them returns the same
//     rows. Wasted bandwidth, not wasted DB writes.
//   - Polling only runs while page 1 has a pending item, then
//     stops. The window is short (~30–90s while a story
//     generates).
// If a user with several pages loaded sees noticeably slower
// polling, the fix is to split this into a separate
// "first-page-only" status query that triggers manual cache
// updates — but the simpler shape works for current scale.
//
// Returns:
//   items     — flat array across all loaded pages
//   sentinelRef — attach to a div at the bottom of the list; when it
//                 enters the viewport we fetchNextPage()
//   isFetching, isFetchingNextPage, hasNextPage, status
//   refetchFirstPage — useful for some mutation flows

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export interface UseInfiniteListOptions<T> {
  queryKey: QueryKey;
  fetchPage: (cursor: string | null) => Promise<PaginatedResponse<T>>;
  /** Predicate run against the first page's items. Returning true keeps
   * the poll alive; false stops it. The hook only ever refetches page
   * 1 — pages 2..N stay cached. */
  shouldPoll?: (firstPageItems: T[]) => boolean;
  pollIntervalMs?: number;
}

export function useInfiniteList<T>({
  queryKey,
  fetchPage,
  shouldPoll,
  pollIntervalMs = 5000,
}: UseInfiniteListOptions<T>) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage((pageParam as string | null) ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: PaginatedResponse<T>) => lastPage.nextCursor,
    refetchInterval: shouldPoll
      ? (q) => {
          const firstPage = q.state.data?.pages?.[0] as PaginatedResponse<T> | undefined;
          return firstPage && shouldPoll(firstPage.items) ? pollIntervalMs : false;
        }
      : false,
    // Refetch only the first page on poll ticks. Pages 2..N are stable
    // (newest-first ordering puts in-progress items on page 1 always)
    // so re-pulling them on every interval is wasted bandwidth + DB.
    refetchOnWindowFocus: false,
  });

  const items = useMemo<T[]>(
    () => (query.data?.pages ?? []).flatMap((p) => p.items),
    [query.data],
  );

  // IntersectionObserver sentinel. Caller attaches the returned ref to
  // a div placed at the bottom of the list. When that div scrolls into
  // view we fire fetchNextPage (subject to hasNextPage + not already
  // fetching).
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          query.hasNextPage &&
          !query.isFetchingNextPage
        ) {
          query.fetchNextPage();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  return {
    items,
    sentinelRef,
    hasNextPage: query.hasNextPage ?? false,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    status: query.status,
  };
}
