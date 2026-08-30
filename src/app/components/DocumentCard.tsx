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
    <article className="group border-b border-stone-200 py-5 last:border-b-0">
      <Link
        to={`/docs/${document.slug}`}
        className="block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-900"
      >
        <h2 className="font-serif text-lg leading-snug text-stone-900 group-hover:underline sm:text-xl">
          {document.title}
        </h2>
      </Link>

      {document.description !== "" && (
        <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-stone-600">
          {document.description}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-stone-500">
        {document.categoryPath.length > 0 && (
          <span className="font-medium text-stone-600">
            {document.categoryPath.map((entry) => entry.name).join(" / ")}
          </span>
        )}
        {document.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">
            {tag}
          </span>
        ))}
        <span className="ml-auto tabular-nums">{formatUpdated(document.updatedAt)}</span>
      </div>
    </article>
  );
}
