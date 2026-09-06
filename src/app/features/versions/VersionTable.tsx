// The version history list: preview, restore and delete, per version.
//
// Written by node G3.5. Presentational, same discipline as CategoryTree
// and TagTable: mutations are delegated to callback props owned by
// document-edit.tsx, which does the request and the refetch. Destructive
// confirmations live here, in the row, matching TagRow's convention
// exactly (window.confirm before calling the delegated callback).
//
// Requirement 1 & 2: a guarded delete control is DISABLED WITH A VISIBLE,
// always-on explanation — never just hidden, and never only a hover
// tooltip (title=...), because AGENT.md §24/SPEC.md §25 rule out any
// essential hover-only behaviour. The explanation text sits directly under
// the row so it is reachable identically on a touch screen.
//
// Guard precedence mirrors VersionService.deleteVersion exactly (SPEC.md
// §13, src/domain/versions/version-service.ts): a single-version document
// is unavoidably both the last version and the current version, and the
// backend reports LAST_VERSION_CANNOT_DELETE for it, not
// VERSION_IS_CURRENT. The client-side reason below is computed with the
// same precedence so the explanation an operator sees never disagrees
// with what the server would have said.
import { useState } from "react";
import type { VersionHistoryEntry } from "../../lib/api-client";

const secondaryButtonClass =
  "border border-[#071e4a] px-2.5 py-1.5 text-xs font-bold text-[#071e4a] hover:bg-[#d9f4eb] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]";
const dangerButtonClass =
  "border border-red-700 px-2.5 py-1.5 text-xs font-bold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700";

const NOTE_PREVIEW_LENGTH = 80;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export interface VersionTableProps {
  versions: VersionHistoryEntry[];
  onPreview: (versionNo: number) => void;
  onRestore: (versionNo: number) => Promise<void>;
  onDelete: (versionNo: number) => Promise<void>;
}

export function VersionTable({ versions, onPreview, onRestore, onDelete }: VersionTableProps) {
  if (versions.length === 0) {
    return <p className="py-6 text-sm text-[#526889]">No versions yet.</p>;
  }

  // Edge case: numbering gaps left by a deleted version are displayed as
  // they come back from the server — versions are never renumbered, and
  // this list never fills a gap in with a placeholder row.
  const onlyOneVersion = versions.length === 1;

  return (
    <ul className="divide-y divide-[#071e4a]/15 border-y-2 border-[#071e4a]" aria-label="Version history">
      {versions.map((version) => (
        <VersionRow
          key={version.versionId}
          version={version}
          onlyOneVersion={onlyOneVersion}
          onPreview={() => onPreview(version.versionNo)}
          onRestore={() => onRestore(version.versionNo)}
          onDelete={() => onDelete(version.versionNo)}
        />
      ))}
    </ul>
  );
}

function VersionRow({
  version,
  onlyOneVersion,
  onPreview,
  onRestore,
  onDelete,
}: {
  version: VersionHistoryEntry;
  onlyOneVersion: boolean;
  onPreview: () => void;
  onRestore: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteReason = onlyOneVersion
    ? "This is the only version of this document — a document must always keep at least one version."
    : version.isCurrent
      ? "This is the current version — restore or upload another version first, then delete this one."
      : null;

  const noteIsLong = version.note.length > NOTE_PREVIEW_LENGTH;
  const noteText = noteExpanded || !noteIsLong ? version.note : `${version.note.slice(0, NOTE_PREVIEW_LENGTH)}…`;

  async function runRestore() {
    // Requirement 3: states plainly that restore creates a NEW version
    // rather than rewinding, and names the source version — the single
    // most misunderstood behaviour in the system (this is not a rewind).
    const confirmed = window.confirm(
      `Restore version ${version.versionNo}? This does NOT rewind the document — it creates a brand-new version ` +
        `using the bytes from version ${version.versionNo}, and that new version becomes current. This cannot be ` +
        `undone.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await onRestore();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The version could not be restored.");
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    if (deleteReason !== null) return;
    const confirmed = window.confirm(
      `Delete version ${version.versionNo}? Its content is permanently removed from storage. This cannot be undone.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The version could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black text-[#071e4a]">v{version.versionNo}</span>
            {version.isCurrent && (
              <span className="border border-[#0e9e85] bg-[#d9f4eb] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#071e4a]">
                Current
              </span>
            )}
            {version.restoredFromVersionNo !== null && (
              <span className="text-xs font-medium text-[#526889]">restored from v{version.restoredFromVersionNo}</span>
            )}
          </div>
          <p className="text-xs text-[#526889]">
            {version.createdBy} · {formatSize(version.sizeBytes)} · {formatTimestamp(version.createdAt)}
          </p>
          {version.note !== "" && (
            <p className="text-xs leading-5 text-[#27416c]">
              {noteText}{" "}
              {noteIsLong && (
                <button
                  type="button"
                  onClick={() => setNoteExpanded((current) => !current)}
                  className="font-bold text-[#27416c] underline decoration-[#f26b21] decoration-2 underline-offset-2"
                >
                  {noteExpanded ? "Show less" : "Show full note"}
                </button>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onPreview}
            aria-label={`Preview version ${version.versionNo}`}
            className={secondaryButtonClass}
          >
            Preview
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runRestore()}
            aria-label={`Restore version ${version.versionNo}`}
            className={secondaryButtonClass}
          >
            Restore
          </button>
          <button
            type="button"
            disabled={busy || deleteReason !== null}
            onClick={() => void runDelete()}
            aria-label={`Delete version ${version.versionNo}`}
            className={dangerButtonClass}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Always visible, never a hover-only tooltip — the rule has to be
          learnable by looking, not by hovering. */}
      {deleteReason !== null && <p className="mt-1 text-xs text-[#526889]">{deleteReason}</p>}

      {error !== null && (
        <p role="alert" className="mt-1 text-sm text-red-800">
          {error}
        </p>
      )}
    </li>
  );
}

export default VersionTable;
