// The public Library listing.
//
// Written by node G1.10. Search, category browsing and pagination controls
// arrive in later nodes (G2.6, G4.2); this node ships the listing itself,
// its loading state, its empty state and its error state, because a page
// that only works when everything succeeds is not finished.
import { useEffect, useState } from "react";
import { listDocuments, type DocumentSummary } from "../lib/api-client";
import { DocumentCard } from "../components/DocumentCard";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; items: DocumentSummary[]; total: number }
  | { status: "error"; message: string };

export function Library() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    listDocuments()
      .then((page) => {
        if (!cancelled) setState({ status: "ready", items: page.items, total: page.total });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "The library could not be loaded.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="border-b border-stone-300 pb-6">
        <h1 className="font-serif text-3xl tracking-tight text-stone-900 sm:text-4xl">Alexandria</h1>
        <p className="mt-2 text-sm text-stone-600">
          A reading library. Open anything without signing in.
        </p>
      </header>

      <div className="mt-2">
        {state.status === "loading" && <LibrarySkeleton />}

        {state.status === "error" && (
          <p className="py-10 text-sm text-stone-600" role="alert">
            {state.message}
          </p>
        )}

        {state.status === "ready" && state.items.length === 0 && (
          <p className="py-12 text-sm text-stone-600" data-testid="library-empty">
            Nothing has been published yet.
          </p>
        )}

        {state.status === "ready" &&
          state.items.map((document) => <DocumentCard key={document.slug} document={document} />)}
      </div>
    </div>
  );
}

/** Skeletons rather than a spinner, so arriving content does not shift the page. */
function LibrarySkeleton() {
  return (
    <div aria-hidden className="space-y-6 py-6">
      {[0, 1, 2].map((row) => (
        <div key={row} className="space-y-2">
          <div className="h-5 w-2/3 rounded bg-stone-200" />
          <div className="h-3 w-full rounded bg-stone-100" />
          <div className="h-3 w-1/3 rounded bg-stone-100" />
        </div>
      ))}
    </div>
  );
}
