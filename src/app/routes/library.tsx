// The public Library listing.
//
// Written by node G1.10. Search was shipped there and stays untouched
// here — it is out of scope for node G2.6 (the real search box is G4.2).
//
// Node G2.6 adds: the nested category tree as a sidebar/drawer that
// navigates to shareable `/category/*` routes instead of filtering in
// place, a `?tag=` filtered view fed by the same tag chips that appear on
// every Document Card and on the Reader header, and explicit Prev/Next
// pagination in place of the old accumulating "Load more" button — so a
// listing page is always a plain, bookmarkable GET (requirement 6).
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  listPublicCategories,
  listPublicTags,
  type CategoryTreeNode,
  type TagSummary,
} from "../lib/api-client";
import { DocumentCard } from "../components/DocumentCard";
import { CategorySidebar } from "../features/browse/CategorySidebar";
import { TagChips } from "../features/browse/TagChips";
import { useDocumentListing } from "../features/browse/useDocumentListing";

type CategoryState =
  | { status: "loading" }
  | { status: "ready"; tree: CategoryTreeNode[] }
  | { status: "error" };

type TagState = { status: "loading" | "error" } | { status: "ready"; tags: TagSummary[] };

export function Library() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tagParam = searchParams.get("tag");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [categoryState, setCategoryState] = useState<CategoryState>({ status: "loading" });
  const [tagState, setTagState] = useState<TagState>({ status: "loading" });
  const [query, setQuery] = useState("");

  const searchTerm = query.trim();

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

  const listing = useDocumentListing(
    { tag: tagParam ?? undefined, query: searchTerm === "" ? undefined : searchTerm },
    page,
  );
  const totalPages = listing.status === "ready" ? Math.max(1, Math.ceil(listing.total / listing.pageSize)) : 1;

  function goToPage(nextPage: number) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextPage <= 1) next.delete("page");
      else next.set("page", String(nextPage));
      return next;
    });
  }

  function updateQuery(value: string) {
    setQuery(value);
    if (page !== 1) goToPage(1);
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
    tagParam !== null
      ? `Tagged “${tagParam}”`
      : searchTerm !== ""
        ? `Matches for “${searchTerm}”`
        : "Recently updated";

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#f7f5ef] text-[#071e4a]">
      <header className="border-b-4 border-[#071e4a] bg-[#071e4a] text-[#f7f5ef]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 sm:px-8 lg:px-12">
          <h1 className="text-xl font-black tracking-[-0.03em] sm:text-2xl">
            <a href="/" className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#71d6be]">
              Alexandria
            </a>
          </h1>
          <nav aria-label="Library navigation" className="flex items-center gap-4 text-sm font-semibold">
            <a href="#library-results" className="rounded px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#71d6be]">
              Browse
            </a>
            <a href="/admin/" className="rounded px-2 py-1 text-[#bcefe1] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#71d6be]">
              Admin
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
        <section className="border-b border-[#071e4a]/30 pb-8 sm:pb-10">
          <div className="max-w-3xl">
            <p className="max-w-2xl text-4xl font-black leading-[0.94] tracking-[-0.045em] text-[#071e4a] sm:text-6xl">
              Find a clear route into the collection.
            </p>
            <p className="mt-4 max-w-xl text-base leading-7 text-[#27416c] sm:text-lg">
              A public reading library for original documents. Open anything without signing in.
            </p>
          </div>

          <div className="mt-8 flex max-w-5xl gap-0 border-2 border-[#071e4a] bg-white shadow-[8px_10px_22px_rgba(7,30,74,0.12)] focus-within:shadow-[10px_12px_28px_rgba(7,30,74,0.18)]">
            <label className="sr-only" htmlFor="library-search">
              Search the library
            </label>
            <input
              id="library-search"
              type="search"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="Search the collection"
              className="min-w-0 flex-1 bg-transparent px-4 py-4 text-base font-medium text-[#071e4a] placeholder:text-[#526889] focus:outline-none sm:px-5 sm:text-lg"
            />
            {query !== "" && (
              <button
                type="button"
                onClick={() => updateQuery("")}
                className="border-l-2 border-[#071e4a] px-4 text-sm font-bold hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#071e4a]"
              >
                Clear
              </button>
            )}
          </div>
        </section>

        <div className="grid gap-10 py-8 lg:grid-cols-[minmax(13rem,0.72fr)_minmax(0,2fr)] lg:gap-14 lg:py-12">
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
              <h2 id="library-results-title" className="text-2xl font-black tracking-[-0.03em] sm:text-3xl">
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

              {listing.status === "ready" && listing.total === 0 && searchTerm === "" && tagParam === null && (
                <p className="border-b border-[#071e4a]/20 py-12 text-sm leading-6 text-[#27416c]" data-testid="library-empty">
                  Nothing has been published yet.
                </p>
              )}

              {listing.status === "ready" && listing.total === 0 && (searchTerm !== "" || tagParam !== null) && (
                <p className="border-b border-[#071e4a]/20 py-12 text-sm leading-6 text-[#27416c]">
                  {tagParam !== null ? "No documents carry this tag." : "No documents match this search."}
                </p>
              )}

              {listing.status === "ready" && visibleDocuments.map((document) => <DocumentCard key={document.slug} document={document} />)}

              {listing.status === "ready" && totalPages > 1 && (
                <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => goToPage(page - 1)}
                    disabled={page <= 1}
                    className="border-2 border-[#071e4a] px-4 py-2 text-sm font-black text-[#071e4a] hover:bg-[#d9f4eb] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
                  >
                    Previous
                  </button>
                  <span className="text-sm font-medium text-[#526889]">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => goToPage(page + 1)}
                    disabled={page >= totalPages}
                    className="border-2 border-[#071e4a] px-4 py-2 text-sm font-black text-[#071e4a] hover:bg-[#d9f4eb] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
                  >
                    Next
                  </button>
                </nav>
              )}
            </div>
          </section>
        </div>

        {tagState.status === "ready" && tagState.tags.length > 0 && (
          <section aria-labelledby="library-tags-title" className="border-y-2 border-[#071e4a] py-5">
            <h2 id="library-tags-title" className="text-sm font-black uppercase tracking-[0.16em]">
              Browse by tag
            </h2>
            <div className="mt-3">
              <TagChips tags={tagState.tags.map((tag) => tag.name)} />
            </div>
          </section>
        )}

        <aside className="grid gap-4 border-y-2 border-[#071e4a] py-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#d9f4eb] text-[#071e4a]" aria-hidden>
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
