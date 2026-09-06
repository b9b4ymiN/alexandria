// The admin tag list: create, rename, merge and delete.
//
// Written by node G2.5. Presentational, same discipline as CategoryTree:
// mutations are delegated to callback props owned by tags.tsx, which does
// the request and the refetch (Implementation Requirement 6).
//
// Requirement 4: the merge control shows BOTH tags and states how many
// documents will be affected before the confirmation is even shown — the
// confirm() text itself carries source name, source count, and target
// name, so the operator sees the whole picture in one place before
// committing to an irreversible merge.
import { useState } from "react";

export interface TagListItem {
  id: string;
  name: string;
  documentCount: number;
}

const inputClass =
  "block w-full border-2 border-[#071e4a] bg-white px-2.5 py-2 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-[#0e9e85]";
const primaryButtonClass =
  "bg-[#f26b21] px-3 py-2 text-xs font-black text-[#071e4a] hover:bg-[#ff873f] disabled:cursor-not-allowed disabled:bg-[#f4c3a6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]";
const secondaryButtonClass =
  "border border-[#071e4a] px-2.5 py-1.5 text-xs font-bold text-[#071e4a] hover:bg-[#d9f4eb] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]";
const cancelButtonClass = "px-2 py-2 text-xs font-semibold text-[#27416c] underline";

export function TagTable({
  tags,
  onRename,
  onMerge,
  onDelete,
}: {
  tags: TagListItem[];
  onRename: (id: string, name: string) => Promise<void>;
  onMerge: (sourceId: string, targetId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  if (tags.length === 0) {
    return (
      <p className="py-6 text-sm leading-6 text-[#27416c]">
        No tags yet. Tags are also created from the upload form and the document edit screen, or here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[#071e4a]/15 border-y-2 border-[#071e4a]">
      {tags.map((tag) => (
        <TagRow key={tag.id} tag={tag} allTags={tags} onRename={onRename} onMerge={onMerge} onDelete={onDelete} />
      ))}
    </ul>
  );
}

type RowMode = "idle" | "rename" | "merge";

function TagRow({
  tag,
  allTags,
  onRename,
  onMerge,
  onDelete,
}: {
  tag: TagListItem;
  allTags: TagListItem[];
  onRename: (id: string, name: string) => Promise<void>;
  onMerge: (sourceId: string, targetId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const otherTags = allTags.filter((candidate) => candidate.id !== tag.id);
  const [mode, setMode] = useState<RowMode>("idle");
  const [draftName, setDraftName] = useState(tag.name);
  const [targetId, setTargetId] = useState<string>(otherTags[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edge case: renaming into an existing name explains the conflict AND
  // offers merge as the alternative (node G2.5 Edge Cases). The server
  // never sends back which tag collided (AppError.detail is server-only —
  // src/shared/errors.ts), so this is a best-effort local match on the
  // name the operator just typed.
  const [conflictTagId, setConflictTagId] = useState<string | null>(null);

  function openMode(next: RowMode) {
    setError(null);
    setConflictTagId(null);
    setMode((current) => (current === next ? "idle" : next));
  }

  async function runRename(event: React.FormEvent) {
    event.preventDefault();
    if (draftName.trim() === "") return;
    setBusy(true);
    setError(null);
    setConflictTagId(null);
    try {
      await onRename(tag.id, draftName.trim());
      setMode("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tag could not be renamed.");
      if (cause instanceof Error && (cause as Error & { code?: string }).code === "TAG_NAME_CONFLICT") {
        const collision = otherTags.find(
          (candidate) => candidate.name.trim().toLowerCase() === draftName.trim().toLowerCase(),
        );
        if (collision !== undefined) setConflictTagId(collision.id);
      }
    } finally {
      setBusy(false);
    }
  }

  async function runMerge() {
    if (targetId === "" || targetId === tag.id) return;
    const target = otherTags.find((candidate) => candidate.id === targetId);
    if (target === undefined) return;
    const confirmed = window.confirm(
      `Merge "${tag.name}" (${tag.documentCount} document${tag.documentCount === 1 ? "" : "s"}) into "${target.name}" ` +
        `(${target.documentCount} document${target.documentCount === 1 ? "" : "s"})?\n\n` +
        `Every document tagged "${tag.name}" will end up tagged "${target.name}" instead, and "${tag.name}" will be ` +
        `permanently deleted. This cannot be undone.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await onMerge(tag.id, targetId);
      setMode("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tags could not be merged.");
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    const confirmed = window.confirm(
      tag.documentCount > 0
        ? `Delete tag "${tag.name}"? It is on ${tag.documentCount} document${tag.documentCount === 1 ? "" : "s"} ` +
          `right now; deleting it removes the tag from all of them. This cannot be undone.`
        : `Delete tag "${tag.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(tag.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tag could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const conflictTag = conflictTagId !== null ? otherTags.find((candidate) => candidate.id === conflictTagId) : undefined;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p data-testid="tag-name" className="truncate text-sm font-black text-[#071e4a]">
            {tag.name}
          </p>
          <p className="text-xs text-[#526889]">
            {tag.documentCount} document{tag.documentCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraftName(tag.name);
              openMode("rename");
            }}
            aria-label={`Rename tag "${tag.name}"`}
            className={secondaryButtonClass}
          >
            Rename
          </button>
          <button
            type="button"
            disabled={busy || otherTags.length === 0}
            onClick={() => {
              setTargetId(otherTags[0]?.id ?? "");
              openMode("merge");
            }}
            aria-label={`Merge tag "${tag.name}" into another tag`}
            className={secondaryButtonClass}
          >
            Merge into…
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runDelete()}
            aria-label={`Delete tag "${tag.name}"`}
            className="border border-red-700 px-2.5 py-1.5 text-xs font-bold text-red-800 hover:bg-red-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Edge case: merging into itself has nothing to disable a control
          against by name, so this is the always-visible explanation for
          the one state where "Merge into…" cannot do anything — no other
          tag yet exists. The trigger button above is also disabled. */}
      {otherTags.length === 0 && (
        <p className="mt-1 text-xs text-[#526889]">No other tag exists yet to merge into.</p>
      )}

      {error !== null && (
        <div className="mt-2 space-y-1">
          <p role="alert" className="text-sm text-red-800">
            {error}
          </p>
          {conflictTag !== undefined && (
            <button
              type="button"
              onClick={() => {
                setTargetId(conflictTag.id);
                setMode("merge");
                setError(null);
              }}
              className="text-sm font-bold text-[#27416c] underline decoration-[#f26b21] decoration-2 underline-offset-4"
            >
              Merge &quot;{tag.name}&quot; into &quot;{conflictTag.name}&quot; instead
            </button>
          )}
        </div>
      )}

      {mode === "rename" && (
        <form onSubmit={(event) => void runRename(event)} className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`tag-rename-${tag.id}`} className="sr-only">
              New name for tag &quot;{tag.name}&quot;
            </label>
            <input
              id={`tag-rename-${tag.id}`}
              type="text"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={busy || draftName.trim() === ""}
            aria-label={`Save new name for tag "${tag.name}"`}
            className={primaryButtonClass}
          >
            Save name
          </button>
          <button type="button" onClick={() => setMode("idle")} className={cancelButtonClass}>
            Cancel
          </button>
        </form>
      )}

      {mode === "merge" && otherTags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`tag-merge-${tag.id}`} className="block text-xs font-bold text-[#071e4a]">
              Merge &quot;{tag.name}&quot; into
            </label>
            <select
              id={`tag-merge-${tag.id}`}
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className={`mt-1 ${inputClass}`}
            >
              {otherTags.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({candidate.documentCount})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={busy || targetId === "" || targetId === tag.id}
            onClick={() => void runMerge()}
            aria-label={`Confirm merge of tag "${tag.name}"`}
            className={primaryButtonClass}
          >
            Merge
          </button>
          <button type="button" onClick={() => setMode("idle")} className={cancelButtonClass}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}
