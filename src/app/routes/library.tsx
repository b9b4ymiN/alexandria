// The public Library listing.
//
// Written by node G1.10. Search, category browsing and pagination controls
// arrive in later nodes (G2.6, G4.2); this node ships the listing itself,
// its loading state, its empty state and its error state, because a page
// that only works when everything succeeds is not finished.
import { useEffect, useState } from "react";
import { listDocuments, listPublicCategories, type CategoryListEntry, type DocumentSummary } from "../lib/api-client";
import { DocumentCard } from "../components/DocumentCard";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; items: DocumentSummary[]; total: number }
  | { status: "error"; message: string };

const PAGE_SIZE = 20;

export function Library() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [categories, setCategories] = useState<CategoryListEntry[]>([]);
  const [categoryRoutesUnavailable, setCategoryRoutesUnavailable] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const searchTerm = query.trim();
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? null;

  useEffect(() => {
    let cancelled = false;
    listPublicCategories()
      .then(({ categories: publicCategories }) => {
        if (!cancelled) {
          setCategories(publicCategories);
          setCategoryRoutesUnavailable(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCategoryRoutesUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listDocuments({
      page,
      pageSize: PAGE_SIZE,
      query: searchTerm === "" ? undefined : searchTerm,
      categoryId: selectedCategoryId ?? undefined,
    })
      .then((result) => {
        if (!cancelled) {
          setState((previous) => {
            if (page === 1 || previous.status !== "ready") {
              return { status: "ready", items: result.items, total: result.total };
            }
            const bySlug = new Map(previous.items.map((document) => [document.slug, document]));
            for (const document of result.items) bySlug.set(document.slug, document);
            return { status: "ready", items: [...bySlug.values()], total: result.total };
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "The library could not be loaded.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMore(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, searchTerm, selectedCategoryId]);

  function resetListing(nextQuery: string, nextCategoryId: string | null) {
    if (nextQuery.trim() === searchTerm && nextCategoryId === selectedCategoryId && page === 1) {
      setQuery(nextQuery);
      return;
    }
    setQuery(nextQuery);
    setSelectedCategoryId(nextCategoryId);
    setPage(1);
    setIsLoadingMore(false);
    setState({ status: "loading" });
  }

  const collectionTotal = categories.reduce((total, category) => total + category.documentCount, 0);
  const visibleCategories = categories.filter((category) => category.documentCount > 0);
  const visibleDocuments = state.status === "ready" ? state.items : [];
  const resultTitle =
    searchTerm !== ""
      ? `Matches for “${searchTerm}”`
      : selectedCategory === null
        ? "Recently updated"
        : `Recently updated in ${selectedCategory.name}`;

  function loadMore() {
    setIsLoadingMore(true);
    setPage((currentPage) => currentPage + 1);
  }

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
              onChange={(event) => resetListing(event.target.value, selectedCategoryId)}
              placeholder="Search the collection"
              className="min-w-0 flex-1 bg-transparent px-4 py-4 text-base font-medium text-[#071e4a] placeholder:text-[#526889] focus:outline-none sm:px-5 sm:text-lg"
            />
            {query !== "" && (
              <button
                type="button"
                onClick={() => resetListing("", selectedCategoryId)}
                className="border-l-2 border-[#071e4a] px-4 text-sm font-bold hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#071e4a]"
              >
                Clear
              </button>
            )}
          </div>
        </section>

        <div className="grid gap-10 py-8 lg:grid-cols-[minmax(13rem,0.72fr)_minmax(0,2fr)] lg:gap-14 lg:py-12">
          <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Category routes">
            <div className="flex items-center justify-between border-b-2 border-[#071e4a] pb-3">
              <h2 className="text-sm font-black uppercase tracking-[0.16em]">Routes through Alexandria</h2>
              {categories.length > 0 && <span className="text-sm tabular-nums text-[#526889]">{collectionTotal}</span>}
            </div>
            <div className="mt-4 space-y-1">
              <button
                type="button"
                aria-pressed={selectedCategoryId === null && searchTerm === ""}
                onClick={() => resetListing("", null)}
                className="flex w-full items-center justify-between border-b border-[#071e4a]/20 px-1 py-3 text-left text-sm font-bold hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
              >
                <span>All documents</span>
                {categories.length > 0 && <span className="tabular-nums text-[#526889]">{collectionTotal}</span>}
              </button>
              {visibleCategories.map((category, index) => (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={selectedCategoryId === category.id}
                  onClick={() => resetListing("", category.id)}
                  className="group flex w-full items-center gap-3 border-b border-[#071e4a]/20 px-1 py-3 text-left text-sm font-semibold hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
                >
                  <span
                    aria-hidden
                    className={index % 3 === 0 ? "h-2.5 w-2.5 shrink-0 rounded-full bg-[#f26b21]" : index % 3 === 1 ? "h-2.5 w-2.5 shrink-0 rounded-full bg-[#0e9e85]" : "h-2.5 w-2.5 shrink-0 rounded-full bg-[#7652c8]"}
                  />
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <span className="tabular-nums text-[#526889] group-hover:text-[#071e4a]">{category.documentCount}</span>
                </button>
              ))}
              {categoryRoutesUnavailable && (
                <p role="status" className="px-1 py-3 text-sm leading-6 text-[#27416c]">
                  Routes are temporarily unavailable.
                </p>
              )}
            </div>
          </aside>

          <section id="library-results" aria-labelledby="library-results-title">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-[#071e4a] pb-3">
              <h2 id="library-results-title" className="text-2xl font-black tracking-[-0.03em] sm:text-3xl">
                {resultTitle}
              </h2>
              {state.status === "ready" && <p className="text-sm font-medium text-[#526889]">{visibleDocuments.length} of {state.total} shown</p>}
            </div>

            <div aria-live="polite">
              {state.status === "loading" && <LibrarySkeleton />}

              {state.status === "error" && (
                <p className="border-b border-[#071e4a]/20 py-10 text-sm leading-6 text-[#27416c]" role="alert">
                  {state.message}
                </p>
              )}

              {state.status === "ready" && state.total === 0 && searchTerm === "" && selectedCategoryId === null && (
                <p className="border-b border-[#071e4a]/20 py-12 text-sm leading-6 text-[#27416c]" data-testid="library-empty">
                  Nothing has been published yet.
                </p>
              )}

              {state.status === "ready" && state.total === 0 && (searchTerm !== "" || selectedCategoryId !== null) && (
                <p className="border-b border-[#071e4a]/20 py-12 text-sm leading-6 text-[#27416c]">
                  {searchTerm === "" ? "No documents are published in this category." : "No documents match this search."}
                </p>
              )}

              {state.status === "ready" && visibleDocuments.map((document) => <DocumentCard key={document.slug} document={document} />)}
              {state.status === "ready" && visibleDocuments.length < state.total && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="mt-6 border-2 border-[#071e4a] px-4 py-2 text-sm font-black text-[#071e4a] hover:bg-[#d9f4eb] disabled:cursor-wait disabled:bg-[#e7eaf0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
                >
                  {isLoadingMore ? "Loading more…" : "Load more documents"}
                </button>
              )}
            </div>
          </section>
        </div>

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
