// Tag chips: each one is a real link to `/?tag=<name>`, so a chip is a
// filter shortcut a reader can also share (node G2.6 requirement 4).
//
// Written by node G2.6. `variant` exists because this same component sits
// on the mineral-white Document Card and on the ink-blue Reader header
// (SPEC.md §15) — two different surfaces that need two different chip
// colorways, not two different components.
import { Link } from "react-router";

export interface TagChipsProps {
  tags: string[];
  variant?: "light" | "dark";
}

export function TagChips({ tags, variant = "light" }: TagChipsProps) {
  if (tags.length === 0) return null;

  const chipClassName =
    variant === "dark"
      ? "inline-flex min-h-11 items-center border border-white/30 px-2.5 py-2 text-xs font-semibold text-[#bcefe1] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#71d6be]"
      : "inline-flex min-h-11 items-center border border-[#071e4a]/25 px-2.5 py-2 text-xs font-semibold text-[#27416c] hover:bg-[#d9f4eb] hover:text-[#071e4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]";

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <Link key={tag} to={`/?tag=${encodeURIComponent(tag)}`} className={chipClassName}>
          {tag}
        </Link>
      ))}
    </div>
  );
}
