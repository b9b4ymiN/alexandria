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
import { useState } from "react";
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
  const rows = flatten(categories, [], 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-expanded={isOpen}
        aria-controls="category-drawer"
        className="mb-4 flex w-full items-center justify-between border-2 border-[#071e4a] px-4 py-3 text-sm font-black uppercase tracking-[0.1em] hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a] lg:hidden"
      >
        Categories
        <span aria-hidden>▾</span>
      </button>

      {isOpen && (
        <button
          type="button"
          aria-label="Close categories"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 bg-[#071e4a]/50 lg:hidden"
        />
      )}

      <aside
        id="category-drawer"
        aria-label="Category routes"
        className={
          isOpen
            ? "fixed inset-y-0 right-0 z-50 w-[85%] max-w-sm overflow-y-auto bg-[#f7f5ef] p-5 shadow-[14px_16px_32px_rgba(0,0,0,0.24)] lg:sticky lg:top-6 lg:z-auto lg:w-auto lg:max-w-none lg:self-start lg:bg-transparent lg:p-0 lg:shadow-none"
            : "hidden lg:sticky lg:top-6 lg:block lg:self-start"
        }
      >
        <div className="flex items-center justify-between border-b-2 border-[#071e4a] pb-3">
          <h2 className="text-sm font-black uppercase tracking-[0.16em]">Routes through Alexandria</h2>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close categories"
            className="px-2 text-lg font-black leading-none lg:hidden"
          >
            ×
          </button>
        </div>

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

          {rows.map(({ node, path, depth }) => (
            <Link
              key={node.id}
              to={categoryPathHref(path)}
              onClick={() => setIsOpen(false)}
              aria-current={activeCategoryId === node.id ? "page" : undefined}
              style={{ paddingLeft: `${depth * 14 + 4}px` }}
              className="flex w-full items-center justify-between gap-3 border-b border-[#071e4a]/20 py-3 pr-1 text-left text-sm font-semibold hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
            >
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <span className="tabular-nums text-[#526889]">{node.descendantDocumentCount}</span>
            </Link>
          ))}

          {rows.length === 0 && <p className="px-1 py-3 text-sm leading-6 text-[#27416c]">No categories yet.</p>}
        </nav>
      </aside>
    </>
  );
}
