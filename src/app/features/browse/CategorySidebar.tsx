// The category tree navigator: a sticky sidebar on desktop, a drawer on
// mobile.
//
// Written by node G2.6. Used identically on the Library (`/`) and on
// `/category/*`, so browsing and the route structure never diverge — every
// entry here is a real `<Link>` to a shareable `/category/...` URL (node
// G2.6 requirement 1), never a client-side-only filter toggle.
//
// The sidebar and the drawer render the SAME link elements once; only the
// wrapping `<aside>`'s classes change between a `lg:` sticky column and a
// mobile fixed overlay. Rendering the tree twice (once per breakpoint)
// would double every link in the DOM and break single-match queries in
// tests, so this is a single tree with responsive positioning, not two
// trees with responsive visibility.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { categoryPathHref, type CategoryTreeNode } from "../../lib/api-client";

interface FlatRow {
  node: CategoryTreeNode;
  path: string[];
  depth: number;
}

function flatten(nodes: CategoryTreeNode[], parentPath: string[], depth: number): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    const path = [...parentPath, node.slug];
    rows.push({ node, path, depth });
    rows.push(...flatten(node.children, path, depth + 1));
  }
  return rows;
}

export interface CategorySidebarProps {
  categories: CategoryTreeNode[];
  /** The category currently being browsed, or `null` for "All documents". */
  activeCategoryId?: string | null;
  /** Count shown next to "All documents" — the whole library. */
  totalCount: number;
}

export function CategorySidebar({ categories, activeCategoryId = null, totalCount }: CategorySidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const rows = useMemo(() => flatten(categories, [], 0), [categories]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingCount =
    normalizedQuery === ""
      ? rows.length
      : rows.filter(({ node }) => node.name.toLocaleLowerCase().includes(normalizedQuery)).length;
  const visibleRows = useMemo(() => {
    if (normalizedQuery !== "") {
      return rows.filter(({ node }) => node.name.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 40);
    }
    const initialRows = rows.slice(0, 18);
    const activeRow = rows.find(({ node }) => node.id === activeCategoryId);
    if (activeRow === undefined || initialRows.some(({ node }) => node.id === activeRow.node.id)) return initialRows;
    return [...initialRows.slice(0, 17), activeRow];
  }, [activeCategoryId, normalizedQuery, rows]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>("[data-drawer-close]")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      if (event.key !== "Tab" || drawer === null) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-expanded={isOpen}
        aria-controls="category-drawer"
        className="mb-1 flex min-h-12 w-full items-center justify-between border-2 border-[#071e4a] bg-white px-3.5 py-2.5 text-sm font-black hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a] lg:hidden"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d9f4eb] text-xs tabular-nums">{rows.length}</span>
          Browse categories
        </span>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>

      {isOpen && (
        <button
          type="button"
          aria-label="Close categories"
          onClick={() => setIsOpen(false)}
          tabIndex={-1}
          className="fixed inset-0 z-40 bg-[#071e4a]/50 lg:hidden"
        />
      )}

      <aside
        ref={drawerRef}
        id="category-drawer"
        aria-label="Category routes"
        role={isOpen ? "dialog" : undefined}
        aria-modal={isOpen ? true : undefined}
        className={
          isOpen
            ? "fixed inset-y-0 right-0 z-50 w-[85%] max-w-sm overflow-y-auto bg-[#f7f5ef] p-5 shadow-[14px_16px_32px_rgba(0,0,0,0.24)] lg:sticky lg:top-6 lg:z-auto lg:w-auto lg:max-w-none lg:self-start lg:bg-transparent lg:p-0 lg:shadow-none"
            : "hidden lg:sticky lg:top-20 lg:block lg:self-start"
        }
      >
        <div className="flex items-center justify-between border-b-2 border-[#071e4a] pb-3">
          <h2 className="text-sm font-black uppercase tracking-[0.16em]">Routes through Alexandria</h2>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close categories"
            data-drawer-close
            className="flex h-11 w-11 items-center justify-center border border-[#071e4a] lg:hidden"
          >
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {rows.length > 18 && (
          <label className="mt-3 flex min-h-11 items-center border border-[#071e4a]/50 bg-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#71d6be]">
            <span className="sr-only">Filter categories</span>
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-3 h-4 w-4 shrink-0 text-[#526889]">
              <circle cx="11" cy="11" r="6" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a category"
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-semibold text-[#071e4a] placeholder:font-normal placeholder:text-[#526889] focus:outline-none"
            />
          </label>
        )}

        {normalizedQuery !== "" && (
          <p className="mt-2 text-xs font-semibold text-[#526889]" aria-live="polite">
            {matchingCount} {matchingCount === 1 ? "route" : "routes"} match
          </p>
        )}

        <nav aria-label="Categories" className="mt-4 space-y-1">
          <Link
            to="/"
            onClick={() => setIsOpen(false)}
            aria-current={activeCategoryId === null ? "page" : undefined}
            className="flex w-full items-center justify-between border-b border-[#071e4a]/20 px-1 py-3 text-left text-sm font-bold hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
          >
            <span>All documents</span>
            <span className="tabular-nums text-[#526889]">{totalCount}</span>
          </Link>

          {visibleRows.map(({ node, path, depth }) => (
            <Link
              key={node.id}
              to={categoryPathHref(path)}
              onClick={() => setIsOpen(false)}
              aria-current={activeCategoryId === node.id ? "page" : undefined}
              className="grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[#071e4a]/20 py-2 pr-1 text-left text-sm font-semibold hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
            >
              <span className="relative flex w-4 self-stretch items-center justify-center" style={{ marginLeft: `${depth * 14}px` }} aria-hidden>
                <span className="absolute inset-y-[-0.55rem] w-px bg-[#071e4a]/20" />
                <span
                  className="relative h-2.5 w-2.5 rounded-full border-2 bg-[#f7f5ef]"
                  style={{ borderColor: ["#f26b21", "#71d6be", "#8a4fc6", "#071e4a"][depth % 4] }}
                />
              </span>
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <span className="tabular-nums text-[#526889]">{node.descendantDocumentCount}</span>
            </Link>
          ))}

          {rows.length === 0 && <p className="px-1 py-3 text-sm leading-6 text-[#27416c]">No categories yet.</p>}
          {rows.length > 0 && visibleRows.length === 0 && (
            <p className="px-1 py-3 text-sm leading-6 text-[#27416c]" role="status">
              No categories match “{query.trim()}”.
            </p>
          )}
        </nav>

        {normalizedQuery === "" && rows.length > 18 && (
          <p className="mt-3 text-xs leading-5 text-[#526889]">Showing the first 18 routes. Search to reach the full index.</p>
        )}
        {normalizedQuery !== "" && matchingCount > 40 && (
          <p className="mt-3 text-xs leading-5 text-[#526889]">Showing the first 40 matches. Refine your search to narrow the list.</p>
        )}
      </aside>
    </>
  );
}
