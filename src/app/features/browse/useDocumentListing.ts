// Shared fetch logic for a paginated public document listing.
//
// Written by node G2.6. Both the Library (`/`, optionally `?tag=`) and the
// category browse route (`/category/*`) page through the exact same
// `GET /api/public/documents` shape, so the fetch, loading, and error
// handling live here once rather than being duplicated per route.
import { useEffect, useMemo, useState } from "react";
import { listDocuments, type DocumentSummary } from "../../lib/api-client";

export const PAGE_SIZE = 20;

export type ListingState =
  | { status: "loading" }
  | { status: "ready"; items: DocumentSummary[]; total: number; pageSize: number }
  | { status: "error"; message: string };

export interface ListingFilters {
  categoryId?: string;
  tag?: string;
  query?: string;
}

/**
 * Fetches one page for the given filters. Callers own `page` — usually
 * mirrored into the URL — so a listing page is always a plain GET with no
 * accumulated client-side state, and a reader can return to the exact page
 * they left (node G2.6 requirement 6: explicit pagination, not infinite
 * scroll).
 *
 * Loading state is DERIVED — the fetched result is tagged with the key it
 * answers, and "loading" is simply "the committed result's key does not
 * match the current one" — rather than set synchronously at the top of the
 * effect. The latter causes a cascading extra render on every filter/page
 * change; this mirrors the same derived-state shape the Reader route
 * already uses for its own load state (src/app/routes/reader.tsx).
 */
export function useDocumentListing(filters: ListingFilters, page: number): ListingState {
  const { categoryId, tag, query } = filters;
  const key = useMemo(() => JSON.stringify([categoryId, tag, query, page]), [categoryId, tag, query, page]);
  const [loaded, setLoaded] = useState<{ key: string; state: ListingState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDocuments({ page, pageSize: PAGE_SIZE, categoryId, tag, query })
      .then((result) => {
        if (!cancelled) {
          setLoaded({
            key,
            state: { status: "ready", items: result.items, total: result.total, pageSize: result.pageSize },
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoaded({
            key,
            state: {
              status: "error",
              message: error instanceof Error ? error.message : "The library could not be loaded.",
            },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, categoryId, tag, query, page]);

  return loaded !== null && loaded.key === key ? loaded.state : { status: "loading" };
}
