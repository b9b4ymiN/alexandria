// One document in the Library listing.
//
// Written by node G1.10. Shows exactly what SPEC.md §14 specifies — title,
// category path, tags, updated date — and deliberately no cover image
// (AGENT.md §23) and no body excerpt, because list responses carry no HTML
// body at all.
import { Link } from "react-router";
import type { DocumentSummary } from "../lib/api-client";

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function DocumentCard({ document }: { document: DocumentSummary }) {
  return (
    <article className="group border-b border-[#071e4a]/20 py-5 last:border-b-0 sm:py-6">
      <Link
        to={`/docs/${document.slug}`}
        className="grid gap-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#071e4a] sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-start sm:gap-6"
      >
        <div>
          {document.categoryPath.length > 0 && (
            <p className="text-xs font-black uppercase tracking-[0.13em] text-[#087465]">
              {document.categoryPath.map((entry) => entry.name).join(" / ")}
            </p>
          )}
          <h2 className="mt-2 text-xl font-black leading-tight tracking-[-0.025em] text-[#071e4a] group-hover:underline sm:text-2xl">
            {document.title}
          </h2>
          {document.description !== "" && (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3e5478] sm:text-base">{document.description}</p>
          )}
          {document.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {document.tags.map((tag) => (
                <span key={tag} className="border border-[#071e4a]/25 px-2 py-1 text-xs font-semibold text-[#27416c]">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <time dateTime={document.updatedAt} className="text-sm font-medium tabular-nums text-[#526889] sm:pt-1 sm:text-right">
          {formatUpdated(document.updatedAt)}
        </time>
        <span className="flex h-9 w-9 items-center justify-center border border-[#071e4a] text-[#071e4a] transition-transform group-hover:translate-x-1" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </span>
      </Link>
    </article>
  );
}
