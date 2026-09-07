// The public category browse route at /category/*.
//
// Written by node G2.6. The URL mirrors the human-readable slug path
// (`/category/stocks/thailand`) so a shared link communicates exactly
// where the reader is (requirement 1). The category filter defaults to the
// whole subtree, so a category with only descendant documents shows that
// subtree rather than reading as empty (edge case).
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  categoryPathHref,
  findCategoryChain,
  listPublicCategories,
  type CategoryTreeNode,
} from "../lib/api-client";
import { DocumentCard } from "../components/DocumentCard";
import { Breadcrumb } from "../components/Breadcrumb";
import { Pagination } from "../components/Pagination";
import { CategorySidebar } from "../features/browse/CategorySidebar";
import { useDocumentListing } from "../features/browse/useDocumentListing";

type TreeState =
  | { status: "loading" }
  | { status: "ready"; tree: CategoryTreeNode[] }
  | { status: "error"; message: string };

export function CategoryBrowse() {
  const params = useParams();
  const splat = params["*"] ?? "";
  const segments = splat.split("/").filter((segment) => segment !== "");

  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [treeState, setTreeState] = useState<TreeState>({ status: "loading" });

  // Fetched once per page load, same as the Library (requirement 7).
  useEffect(() => {
    let cancelled = false;
    listPublicCategories()
      .then(({ categories }) => {
        if (!cancelled) setTreeState({ status: "ready", tree: categories });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTreeState({
            status: "error",
            message: error instanceof Error ? error.message : "Categories could not be loaded.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chain = treeState.status === "ready" ? findCategoryChain(treeState.tree, segments) : null;
  const current = chain !== null && chain.length > 0 ? chain[chain.length - 1] : undefined;

  function goToPage(nextPage: number) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextPage <= 1) next.delete("page");
      else next.set("page", String(nextPage));
      return next;
    });
  }

  const totalDocuments =
    treeState.status === "ready" ? treeState.tree.reduce((sum, node) => sum + node.descendantDocumentCount, 0) : 0;

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#f7f5ef] text-[#071e4a]">
      <header className="border-b-4 border-[#071e4a] bg-[#071e4a] text-[#f7f5ef]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 sm:px-8 lg:px-12">
          <h1 className="text-xl font-black tracking-[-0.03em] sm:text-2xl">
            <Link to="/" className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#71d6be]">
              Alexandria
            </Link>
          </h1>
          <nav aria-label="Library navigation" className="flex items-center gap-4 text-sm font-semibold">
            <Link to="/" className="rounded px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#71d6be]">
              Library
            </Link>
            <a href="/admin/" className="rounded px-2 py-1 text-[#bcefe1] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#71d6be]">
              Admin
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
        {treeState.status === "loading" && (
          <p aria-hidden className="py-16 text-sm text-[#526889]">
            Loading…
          </p>
        )}

        {treeState.status === "error" && (
          <p role="alert" className="py-16 text-sm text-[#27416c]">
            {treeState.message}
          </p>
        )}

        {treeState.status === "ready" && current === undefined && (
          <div className="py-16 text-center" data-testid="category-not-found">
            <p className="text-lg font-black tracking-[-0.02em]">No such category.</p>
            <p className="mt-2 text-sm leading-6 text-[#27416c]">This route does not match any part of the library.</p>
            <Link to="/" className="mt-4 inline-block text-sm font-bold text-[#071e4a] underline">
              Back to the Library
            </Link>
          </div>
        )}

        {treeState.status === "ready" && current !== undefined && chain !== null && (
          <>
            <Breadcrumb
              items={[
                { label: "Library", href: "/" },
                ...chain.map((node, index) => ({
                  label: node.name,
                  href: categoryPathHref(segments.slice(0, index + 1)),
                })),
              ]}
            />

            <div className="mt-4 grid gap-10 py-4 lg:grid-cols-[minmax(13rem,0.72fr)_minmax(0,2fr)] lg:gap-14 lg:py-8">
              <CategorySidebar categories={treeState.tree} activeCategoryId={current.id} totalCount={totalDocuments} />

              <section aria-labelledby="category-results-title">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-[#071e4a] pb-3">
                  <h2 id="category-results-title" className="text-2xl font-black tracking-[-0.03em] sm:text-3xl">
                    {current.name}
                  </h2>
                </div>
                <CategoryListing categoryId={current.id} page={page} onPageChange={goToPage} />
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function CategoryListing({
  categoryId,
  page,
  onPageChange,
}: {
  categoryId: string;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const listing = useDocumentListing({ categoryId }, page);
  const totalPages = listing.status === "ready" ? Math.max(1, Math.ceil(listing.total / listing.pageSize)) : 1;

  return (
    <div aria-live="polite">
      {listing.status === "loading" && (
        <p aria-hidden className="py-10 text-sm text-[#526889]">
          Loading…
        </p>
      )}

      {listing.status === "error" && (
        <p role="alert" className="border-b border-[#071e4a]/20 py-10 text-sm leading-6 text-[#27416c]">
          {listing.message}
        </p>
      )}

      {listing.status === "ready" && listing.total === 0 && (
        <p data-testid="category-empty" className="border-b border-[#071e4a]/20 py-12 text-sm leading-6 text-[#27416c]">
          Nothing is published in this category yet.
        </p>
      )}

      {/* Same shape as the Library's own "page beyond the last" state (node
          G4.2): `total > 0` but an empty `items` means the page number itself
          — only reachable by editing the URL — is out of range, not that the
          category is empty. */}
      {listing.status === "ready" && listing.items.length === 0 && listing.total > 0 && (
        <div className="border-b border-[#071e4a]/20 py-12 text-sm leading-6 text-[#27416c]" data-testid="category-page-beyond-range">
          <p>This page has nothing to show.</p>
          <button
            type="button"
            onClick={() => onPageChange(1)}
            className="mt-2 font-bold text-[#071e4a] underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
          >
            Back to the first page
          </button>
        </div>
      )}

      {listing.status === "ready" && listing.items.map((document) => <DocumentCard key={document.slug} document={document} />)}

      {listing.status === "ready" && <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />}
    </div>
  );
}
