// Shared Prev/Next pagination control for public listing pages — node G4.2
// requirement 5. Extracted from the near-identical JSX the Library
// (library.tsx) and category browse (category.tsx) routes each carried
// since node G2.6, so the two surfaces present pagination identically and
// a fix only has to happen once.
//
// Both buttons are always-visible tap targets, never a hover affordance
// (AGENT.md §24: no essential hover-only behavior), which is what makes
// this usable at 375px.
export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="border-2 border-[#071e4a] px-4 py-2 text-sm font-black text-[#071e4a] hover:bg-[#d9f4eb] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
      >
        Previous
      </button>
      <span className="text-sm font-medium text-[#526889]">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="border-2 border-[#071e4a] px-4 py-2 text-sm font-black text-[#071e4a] hover:bg-[#d9f4eb] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
      >
        Next
      </button>
    </nav>
  );
}
