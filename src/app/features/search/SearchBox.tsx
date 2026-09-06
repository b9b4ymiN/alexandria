// Debounced Library search input — node G4.2 requirement 2.
//
// The URL's `q` parameter is the single source of truth for the COMMITTED
// query (library.tsx owns writing it via `onChange`), so this component
// holds only the in-flight keystroke `draft` and decides when a draft is
// settled enough to become that committed value. A keystroke commits after
// roughly 250ms of silence.
//
// An IME composition (Thai, Japanese, etc.) is tracked via
// compositionstart/compositionend rather than trusting every `input` event
// to be a finished character — committing mid-composition would fire a
// search for a half-typed syllable that does not exist yet (node G4.2 edge
// case). While `composingRef` is set, keystrokes still update the visible
// draft (so typing feels normal) but never schedule a commit; the commit is
// scheduled explicitly once compositionend fires.
import { useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 250;

/**
 * Mirrors MAX_SEARCH_QUERY_LENGTH in
 * src/domain/search/metadata-search-service.ts. Duplicated rather than
 * imported — this node is frontend-only, and importing a domain module into
 * the public bundle for one constant would cross the Domain Service
 * boundary (AGENT.md §9) for no reason. This cap only keeps the 400
 * SEARCH_QUERY_TOO_LONG response unreachable through normal typing; it is
 * not the source of truth for the limit.
 */
const MAX_QUERY_LENGTH = 200;

export interface SearchBoxProps {
  id: string;
  label: string;
  /** The committed query, mirrored from the URL. */
  value: string;
  /** Called with the committed (already-trimmed) value once a keystroke settles. */
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBox({ id, label, value, onChange, placeholder }: SearchBoxProps) {
  const [draft, setDraft] = useState(value);
  // Resync the visible draft when the committed value changes from OUTSIDE
  // a keystroke here — a deep link, the browser back/forward button, or
  // another control (a tag chip, the "Clear search" empty-state action)
  // navigating to a new `q`. This is the "adjust state when a prop changes"
  // pattern done during render rather than in a `useEffect` — React re-runs
  // the render immediately on this `setDraft` without committing/painting
  // the stale pass, so it never causes the cascading-render effect a
  // `useEffect([value])` doing the same assignment would (react-hooks lint).
  const [committedValue, setCommittedValue] = useState(value);
  if (value !== committedValue) {
    setCommittedValue(value);
    // ...but NOT when this commit is simply the draft's own trimmed form
    // coming back. A commit sends the trimmed term, so pausing after a
    // space makes `value` differ from `draft` by exactly that space, and
    // resyncing here would delete the space the reader just typed —
    // "expectations investing" becomes "expectationsinvesting" for anyone
    // who thinks for 250ms between two words. Only a genuinely EXTERNAL
    // change (deep link, back/forward, "Clear search") replaces the draft.
    if (value !== draft.trim()) setDraft(value);
  }

  const composingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    },
    [],
  );

  function commitAfterDelay(next: string) {
    if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onChange(next.trim()), DEBOUNCE_MS);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setDraft(next);
    if (composingRef.current) return;
    commitAfterDelay(next);
  }

  function handleCompositionStart() {
    composingRef.current = true;
  }

  function handleCompositionEnd(event: React.CompositionEvent<HTMLInputElement>) {
    composingRef.current = false;
    commitAfterDelay(event.currentTarget.value);
  }

  function handleClear() {
    if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    setDraft("");
    onChange("");
  }

  return (
    <div className="mt-8 flex max-w-5xl gap-0 border-2 border-[#071e4a] bg-white shadow-[8px_10px_22px_rgba(7,30,74,0.12)] focus-within:shadow-[10px_12px_28px_rgba(7,30,74,0.18)]">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={draft}
        maxLength={MAX_QUERY_LENGTH}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-4 py-4 text-base font-medium text-[#071e4a] placeholder:text-[#526889] focus:outline-none sm:px-5 sm:text-lg"
      />
      {draft !== "" && (
        <button
          type="button"
          onClick={handleClear}
          className="border-l-2 border-[#071e4a] px-4 text-sm font-bold hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#071e4a]"
        >
          Clear
        </button>
      )}
    </div>
  );
}
