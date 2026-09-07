import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { TagSummary } from "../../lib/api-client";

const FEATURED_TAG_LIMIT = 12;
const FILTERED_TAG_LIMIT = 40;

export interface TagExplorerProps {
  tags: TagSummary[];
  activeTag?: string | null;
}

export function TagExplorer({ tags, activeTag = null }: TagExplorerProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const visibleTags = useMemo(() => {
    const ranked = [...tags].sort(
      (left, right) => right.documentCount - left.documentCount || left.name.localeCompare(right.name),
    );
    if (normalizedQuery === "") return ranked.slice(0, FEATURED_TAG_LIMIT);
    return ranked
      .filter((tag) => tag.name.toLocaleLowerCase().includes(normalizedQuery))
      .slice(0, FILTERED_TAG_LIMIT);
  }, [normalizedQuery, tags]);

  const isFiltered = normalizedQuery !== "";
  const matchingCount = isFiltered
    ? tags.filter((tag) => tag.name.toLocaleLowerCase().includes(normalizedQuery)).length
    : tags.length;

  return (
    <section
      aria-labelledby="library-topics-title"
      className="border-y-2 border-[#071e4a] py-5 sm:py-6"
      data-testid="tag-explorer"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)] sm:items-end">
        <div>
          <h2 id="library-topics-title" className="text-xl font-black tracking-[-0.025em] sm:text-2xl">
            Explore topics
          </h2>
          <p className="mt-1 text-sm leading-5 text-[#526889]">
            {isFiltered
              ? `${matchingCount} ${matchingCount === 1 ? "topic" : "topics"} match`
              : `${tags.length} topics across the collection`}
          </p>
        </div>

        <label className="flex min-h-11 items-center border border-[#071e4a]/60 bg-white focus-within:border-[#071e4a] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#71d6be]">
          <span className="sr-only">Filter topics</span>
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-3 h-4 w-4 shrink-0 text-[#526889]">
            <circle cx="11" cy="11" r="6" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a topic"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-semibold text-[#071e4a] placeholder:font-normal placeholder:text-[#526889] focus:outline-none"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="min-h-11 border-l border-[#071e4a]/30 px-3 text-xs font-black text-[#27416c] hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#071e4a]"
            >
              Clear
            </button>
          )}
        </label>
      </div>

      {visibleTags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
          {visibleTags.map((tag) => (
            <Link
              key={tag.id}
              to={`/?tag=${encodeURIComponent(tag.name)}`}
              aria-current={activeTag === tag.name ? "page" : undefined}
              className="inline-flex min-h-11 items-center gap-2 border border-[#071e4a]/25 bg-white px-3 py-2 text-xs font-bold text-[#27416c] hover:border-[#071e4a] hover:bg-[#d9f4eb] hover:text-[#071e4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a] aria-[current=page]:border-[#071e4a] aria-[current=page]:bg-[#d9f4eb] aria-[current=page]:text-[#071e4a]"
            >
              <span>{tag.name}</span>
              <span className="tabular-nums text-[#526889]" aria-label={`${tag.documentCount} documents`}>
                {tag.documentCount}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-4 border-t border-[#071e4a]/20 py-5 text-sm text-[#27416c]" role="status">
          No topics match “{query.trim()}”. Try a shorter term.
        </p>
      )}

      {!isFiltered && tags.length > FEATURED_TAG_LIMIT && (
        <p className="mt-3 text-xs leading-5 text-[#526889]">Showing the most-used topics. Search to reach the full index.</p>
      )}
      {isFiltered && matchingCount > FILTERED_TAG_LIMIT && (
        <p className="mt-3 text-xs leading-5 text-[#526889]">Showing the first {FILTERED_TAG_LIMIT} matches. Refine your search to narrow the list.</p>
      )}
    </section>
  );
}
