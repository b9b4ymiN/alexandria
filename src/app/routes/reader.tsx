// The Reader Shell at /docs/:slug.
//
// Written by node G1.10. Layout follows SPEC.md §15: a compact sticky
// header carrying back, title, category, updated date and share, then the
// document filling every remaining pixel.
//
// The shell uses 100dvh rather than 100vh because mobile browsers shrink
// the visual viewport as the address bar collapses; with 100vh the frame
// would be taller than the screen and the last lines of a document would
// sit permanently out of reach.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { getDocument, type DocumentDetail } from "../lib/api-client";
import { DocumentFrame } from "../components/DocumentFrame";
import { ShareButton } from "../components/ShareButton";

type Loaded =
  | { status: "ready"; document: DocumentDetail }
  | { status: "missing" }
  | { status: "error"; message: string };

/**
 * The loaded result carries the slug it belongs to. Navigating to another
 * document therefore reads as "loading" purely by comparison, with no state
 * write during render or at the top of an effect — which is both what the
 * React rules require and what stops a previous document from flashing up
 * under the new document's title.
 */
type LoadState = ({ slug: string } & Loaded) | null;

export function Reader() {
  const { slug } = useParams();
  const [loaded, setLoaded] = useState<LoadState>(null);

  useEffect(() => {
    if (slug === undefined) {
      return;
    }
    let cancelled = false;
    getDocument(slug)
      .then((document) => {
        if (!cancelled) setLoaded({ slug, status: "ready", document });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = (error as { code?: string }).code;
        setLoaded(
          code === "DOCUMENT_NOT_FOUND"
            ? { slug, status: "missing" }
            : {
                slug,
                status: "error",
                message:
                  error instanceof Error ? error.message : "This document could not be loaded.",
              },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const state: Loaded | { status: "loading" } =
    slug === undefined
      ? { status: "missing" }
      : loaded !== null && loaded.slug === slug
        ? loaded
        : { status: "loading" };

  const document = state.status === "ready" ? state.document : null;

  return (
    // The header keeps its own height and the frame takes the rest, so the
    // document scrolls inside the frame and the header never scrolls away.
    <div className="flex h-[100dvh] flex-col bg-[#f7f5ef] text-[#071e4a]">
      <header className="shrink-0 border-b-2 border-[#071e4a] bg-[#071e4a] px-3 py-3 text-[#f7f5ef] sm:px-5">
        <div className="mx-auto flex max-w-[110rem] items-center gap-3">
        <Link
          to="/"
          className="shrink-0 px-2 py-1 text-sm font-bold text-[#bcefe1] transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#71d6be]"
        >
          ← Library
        </Link>

        <div className="min-w-0 flex-1">
          <h1
            className="truncate text-sm font-black tracking-[-0.01em] text-[#f7f5ef] sm:text-base"
            title={document?.title ?? ""}
          >
            {document?.title ?? (state.status === "missing" ? "Not found" : "Loading…")}
          </h1>
          {document !== null && (
            <p className="truncate text-xs text-[#b9c5dc]">
              {document.categoryPath.map((entry) => entry.name).join(" / ")}
              {document.categoryPath.length > 0 && " · "}
              {new Date(document.updatedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          )}
        </div>

        {document !== null && <ShareButton title={document.title} />}
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {state.status === "loading" && (
          <div aria-hidden className="h-full w-full animate-pulse bg-white" />
        )}

        {state.status === "missing" && (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div>
              <p className="text-sm text-[#27416c]">
                No document lives at this address, or it has been removed.
              </p>
              <Link to="/" className="mt-3 inline-block text-sm font-bold text-[#071e4a] underline">
                Back to the Library
              </Link>
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex h-full items-center justify-center px-6 text-center" role="alert">
            <p className="text-sm text-[#27416c]">{state.message}</p>
          </div>
        )}

        {document !== null && (
          <DocumentFrame contentUrl={document.contentUrl} title={document.title} />
        )}
      </main>
    </div>
  );
}
