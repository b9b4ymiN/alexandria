// The category-path breadcrumb on `/category/*`.
//
// Written by node G2.6. Every level is a real link (requirement 5). Below
// the `sm` breakpoint (~640px, covering the 375px viewport this project
// tests — AGENT.md §24) the middle segments collapse behind an ellipsis so
// a deep path never wraps the header into several lines; root and the
// current level stay visible at every width (requirement/edge case: "very
// deep path at 375px truncates from the middle").
import { Link } from "react-router";

export interface BreadcrumbItem {
  label: string;
  href: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return null;
  const middle = items.slice(1, -1);

  return (
    <nav aria-label="Breadcrumb" className="text-sm font-semibold text-[#27416c]">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link
            to={first.href}
            className="rounded px-1 py-0.5 hover:bg-[#d9f4eb] hover:text-[#071e4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
          >
            {first.label}
          </Link>
        </li>

        {middle.length > 0 && (
          <li aria-hidden className="px-1 text-[#526889] sm:hidden">
            …
          </li>
        )}

        {middle.map((item) => (
          <li key={item.href} className="hidden items-center gap-1 sm:flex">
            <span aria-hidden>/</span>
            <Link
              to={item.href}
              className="rounded px-1 py-0.5 hover:bg-[#d9f4eb] hover:text-[#071e4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
            >
              {item.label}
            </Link>
          </li>
        ))}

        {items.length > 1 && (
          <li className="flex items-center gap-1">
            <span aria-hidden>/</span>
            <Link
              to={last.href}
              aria-current="page"
              className="rounded px-1 py-0.5 font-black text-[#071e4a] hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
            >
              {last.label}
            </Link>
          </li>
        )}
      </ol>
    </nav>
  );
}
