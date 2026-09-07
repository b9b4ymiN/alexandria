// The public Library listing.
//
// Written by node G1.10. Node G2.6 added: the nested category tree as a
// sidebar/drawer that navigates to shareable `/category/*` routes instead
// of filtering in place, a `?tag=` filtered view fed by the same tag chips
// that appear on every Document Card and on the Reader header, and explicit
// Prev/Next pagination in place of the old accumulating "Load more" button
// — so a listing page is always a plain, bookmarkable GET (requirement 6).
//
// Node G4.2 replaces the vestigial G1.10 search input (it updated no URL
// and never debounced) with `SearchBox`, syncs the committed query to `?q=`
// — the canonical parameter node G4.1's API accepts (`?query=` remains a
// read-only back-compat alias so an old link still resolves) — and adds the
// two edge-case empty states G1.10 didn't need: a no-match state that offers
// to clear the query, and a "page beyond the last" state for a page number
// only reachable by editing the URL by hand.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  listPublicCategories,
  listPublicTags,
  type CategoryTreeNode,
  type TagSummary,
} from "../lib/api-client";
import { DocumentCard } from "../components/DocumentCard";
import { Pagination } from "../components/Pagination";
import { CategorySidebar } from "../features/browse/CategorySidebar";
import { TagExplorer } from "../features/browse/TagExplorer";
import { useDocumentListing } from "../features/browse/useDocumentListing";
import { SearchBox } from "../features/search/SearchBox";

type CategoryState =
  | { status: "loading" }
  | { status: "ready"; tree: CategoryTreeNode[] }
  | { status: "error" };

type TagState = { status: "loading" | "error" } | { status: "ready"; tags: TagSummary[] };

export function Library() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tagParam = searchParams.get("tag");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  // `q` is the canonical URL parameter this route writes; `query` is read
  // here only so a link generated before this node still resolves.
  const q = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim();

  const [categoryState, setCategoryState] = useState<CategoryState>({ status: "loading" });
  const [tagState, setTagState] = useState<TagState>({ status: "loading" });

  // The tree and the tag list are each fetched exactly once per page load
  // (requirement 7) — never once per card and never once per chip.
  useEffect(() => {
    let cancelled = false;
    listPublicCategories()
      .then(({ categories }) => {
        if (!cancelled) setCategoryState({ status: "ready", tree: categories });
      })
      .catch(() => {
        if (!cancelled) setCategoryState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listPublicTags()
      .then((tags) => {
        if (!cancelled) setTagState({ status: "ready", tags });
      })
      .catch(() => {
        if (!cancelled) setTagState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const listing = useDocumentListing({ tag: tagParam ?? undefined, query: q === "" ? undefined : q }, page);
  const totalPages = listing.status === "ready" ? Math.max(1, Math.ceil(listing.total / listing.pageSize)) : 1;

  function goToPage(nextPage: number) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextPage <= 1) next.delete("page");
      else next.set("page", String(nextPage));
      return next;
    });
  }

  // Requirement 1: the committed query lives in `?q=`, shareable and
  // restorable. Every commit resets to page 1 — a query change makes the
  // previous page number meaningless (edge case: it could now be well
  // beyond the new result count).
  function updateQuery(nextRaw: string) {
    const next = nextRaw.trim();
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      if (next === "") params.delete("q");
      else params.set("q", next);
      params.delete("query");
      params.delete("page");
      return params;
    });
  }

  function clearTag() {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("tag");
      next.delete("page");
      return next;
    });
  }

  const totalDocuments =
    categoryState.status === "ready"
      ? categoryState.tree.reduce((sum, node) => sum + node.descendantDocumentCount, 0)
      : 0;
  const visibleDocuments = listing.status === "ready" ? listing.items : [];
  const resultTitle =
    tagParam !== null ? `Tagged “${tagParam}”` : q !== "" ? `Matches for “${q}”` : "Recently updated";

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#f7f5ef] text-[#071e4a]">
      <header className="app-safe-top sticky top-0 z-30 border-b-2 border-[#f26b21] bg-[#071e4a] text-[#f7f5ef] shadow-[0_8px_22px_rgba(7,30,74,0.14)]">
        <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-4 px-4 py-2 sm:min-h-16 sm:px-8 lg:px-12">
          <h1 className="text-lg font-black tracking-[-0.025em] sm:text-xl">
            <a href="/" className="flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#71d6be]">
              <img src="/icons/alexandria-192.png" alt="" className="h-8 w-8" />
              <span className="alexandria-wordmark">Alexandria</span>
            </a>
          </h1>
          <nav aria-label="Library navigation" className="flex items-center gap-1 text-sm font-bold sm:gap-3">
            <a href="#library-results" className="inline-flex min-h-11 items-center px-2 py-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#71d6be]">
              Browse
            </a>
            <a href="/admin/" className="inline-flex min-h-11 items-center px-2 py-2 text-[#bcefe1] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#71d6be]">
              Admin
            </a>
          </nav>
        </div>
      </header>

      <main className="app-safe-bottom mx-auto max-w-7xl px-4 py-5 sm:px-8 sm:py-10 lg:px-12">
        <section className="border-b border-[#071e4a]/30 pb-5 sm:pb-8">
          <div className="max-w-3xl">
            <p className="max-w-2xl text-4xl font-black leading-[0.96] tracking-[-0.04em] text-[#071e4a] text-balance sm:text-5xl lg:text-6xl">
              Find a clear route into the collection.
            </p>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[#27416c] sm:mt-4 sm:text-base sm:leading-7">
              A public reading library for original documents. Open anything without signing in.
            </p>
          </div>

          <SearchBox
            id="library-search"
            label="Search the library"
            value={q}
            onChange={updateQuery}
            placeholder="Search the collection"
          />
        </section>

        <div className="grid gap-6 py-5 sm:py-8 lg:grid-cols-[minmax(13rem,0.72fr)_minmax(0,2fr)] lg:gap-12 lg:py-10">
          {categoryState.status === "error" ? (
            <div>
              <p role="status" className="border-b-2 border-[#071e4a] px-1 py-3 text-sm leading-6 text-[#27416c]">
                Routes are temporarily unavailable.
              </p>
            </div>
          ) : (
            <CategorySidebar
              categories={categoryState.status === "ready" ? categoryState.tree : []}
              activeCategoryId={null}
              totalCount={totalDocuments}
            />
          )}

          <section id="library-results" aria-labelledby="library-results-title">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-[#071e4a] pb-3">
              <h2 id="library-results-title" className="text-2xl font-black leading-tight tracking-[-0.03em] sm:text-3xl">
                {resultTitle}
              </h2>
              {listing.status === "ready" && (
                <p className="text-sm font-medium text-[#526889]">
                  {visibleDocuments.length} of {listing.total} shown
                </p>
              )}
            </div>

            {tagParam !== null && (
              <div className="mt-3 flex items-center gap-2">
                <span className="border border-[#071e4a] bg-[#d9f4eb] px-2 py-1 text-xs font-semibold text-[#071e4a]">{tagParam}</span>
                <button
                  type="button"
                  onClick={clearTag}
                  className="text-xs font-bold text-[#27416c] underline hover:text-[#071e4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
                >
                  Clear tag filter
                </button>
              </div>
            )}

            <div aria-live="polite">
              {listing.status === "loading" && <LibrarySkeleton />}

              {listing.status === "error" && (
                <p className="border-b border-[#071e4a]/20 py-10 text-sm leading-6 text-[#27416c]" role="alert">
                  {listing.message}
                </p>
              )}

              {listing.status === "ready" && listing.total === 0 && q === "" && tagParam === null && (
                <p className="border-b border-[#071e4a]/20 py-12 text-sm leading-6 text-[#27416c]" data-testid="library-empty">
                  Nothing has been published yet.
                </p>
              )}

              {/* Distinct from the empty-library state above (requirement 4): the
                  library has documents, this filter just does not match any of
                  them, so the next action is "try something else" rather than
                  "come back later". A query specifically gets a one-click way
                  back to the unfiltered view (edge case). */}
              {listing.status === "ready" && listing.total === 0 && (q !== "" || tagParam !== null) && (
                <div className="border-b border-[#071e4a]/20 py-12 text-sm leading-6 text-[#27416c]" data-testid="library-no-match">
                  <p>{tagParam !== null ? "No documents carry this tag." : "No documents match this search."}</p>
                  {q !== "" && (
                    <button
                      type="button"
                      onClick={() => updateQuery("")}
                      className="mt-2 font-bold text-[#071e4a] underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              )}

              {/* A page number beyond the last one (only reachable by editing the
                  URL by hand, since Pagination below never exposes it) has
                  `total > 0` but an empty `items` — a different shape from either
                  empty state above, and still needs a working way back
                  (edge case). */}
              {listing.status === "ready" && listing.items.length === 0 && listing.total > 0 && (
                <div className="border-b border-[#071e4a]/20 py-12 text-sm leading-6 text-[#27416c]" data-testid="library-page-beyond-range">
                  <p>This page has nothing to show.</p>
                  <button
                    type="button"
                    onClick={() => goToPage(1)}
                    className="mt-2 font-bold text-[#071e4a] underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
                  >
                    Back to the first page
                  </button>
                </div>
              )}

              {listing.status === "ready" && visibleDocuments.map((document) => <DocumentCard key={document.slug} document={document} />)}

              {listing.status === "ready" && <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} />}
            </div>
          </section>
        </div>

        {tagState.status === "ready" && tagState.tags.length > 0 && <TagExplorer tags={tagState.tags} activeTag={tagParam} />}

        <aside className="grid gap-3 border-b-2 border-[#071e4a] py-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d9f4eb] text-[#071e4a]" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5">
              <path d="m5 12 4.2 4.2L19 6.5" />
            </svg>
          </div>
          <div>
            <h2 className="font-black tracking-[-0.02em]">Keep Alexandria close</h2>
            <p className="mt-1 text-sm leading-6 text-[#27416c]">
              After your first visit, the public library shell remains available offline. Install Alexandria from your browser’s app menu for a focused reading window.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}

/** Skeletons rather than a spinner, so arriving content does not shift the page. */
function LibrarySkeleton() {
  return (
    <div aria-hidden className="space-y-0 py-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="grid gap-3 border-b border-[#071e4a]/20 py-6 animate-pulse sm:grid-cols-[minmax(0,1fr)_8rem]">
          <div className="space-y-3">
            <div className="h-5 w-2/3 bg-[#d8dde8]" />
            <div className="h-3 w-full bg-[#e7eaf0]" />
            <div className="h-3 w-1/3 bg-[#e7eaf0]" />
          </div>
          <div className="h-3 w-16 bg-[#e7eaf0] sm:justify-self-end" />
        </div>
      ))}
    </div>
  );
}
