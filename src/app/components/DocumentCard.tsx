// One document in the Library listing.
//
// Written by node G1.10. Shows exactly what SPEC.md §14 specifies — title,
// category path, tags, updated date — and deliberately no cover image
// (AGENT.md §23) and no body excerpt, because list responses carry no HTML
// body at all.
//
// Node G2.6 adds tag chips (requirement 4). They render as a SIBLING of the
// title link rather than inside it — nesting an `<a>` inside an `<a>` is
// invalid HTML and would make the chips unclickable, since the browser
// closes the outer anchor at the first nested one it finds.
import { Link } from "react-router";
import type { DocumentSummary } from "../lib/api-client";
import { TagChips } from "../features/browse/TagChips";

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function DocumentCard({ document }: { document: DocumentSummary }) {
  return (
    <article className="group border-b border-[#071e4a]/20 py-4 last:border-b-0 sm:py-5">
      <Link
        to={`/docs/${document.slug}`}
        className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-start gap-x-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#071e4a] sm:gap-x-5"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            {document.categoryPath.length > 0 && (
              <p className="min-w-0 truncate text-xs font-black uppercase tracking-[0.12em] text-[#087465]">
                {document.categoryPath.map((entry) => entry.name).join(" / ")}
              </p>
            )}
            <time dateTime={document.updatedAt} className="shrink-0 text-xs font-semibold tabular-nums text-[#526889]">
              {formatUpdated(document.updatedAt)}
            </time>
          </div>
          <h2 className="mt-1.5 text-lg font-black leading-tight tracking-[-0.02em] text-[#071e4a] group-hover:underline sm:text-xl">
            {document.title}
          </h2>
          {document.description !== "" && (
            <p className="mt-1.5 line-clamp-2 max-w-2xl text-sm leading-5 text-[#3e5478] sm:leading-6">{document.description}</p>
          )}
        </div>
        <span className="flex h-10 w-10 items-center justify-center border border-[#071e4a] text-[#071e4a] transition-transform group-hover:translate-x-1" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </span>
      </Link>
      {document.tags.length > 0 && (
        <div className="mt-2.5">
          <TagChips tags={document.tags.slice(0, 4)} />
          {document.tags.length > 4 && <span className="mt-2 inline-block text-xs font-semibold text-[#526889]">+{document.tags.length - 4} more topics</span>}
        </div>
      )}
    </article>
  );
}
