// /admin/documents/:slug — node G2.5.
//
// Requirement 7: the slug is shown READ-ONLY, with a short explanation
// that it is permanent, and it is never included in the PATCH/move
// bodies this screen sends — src/api/routes/admin/documents.ts rejects a
// body carrying `slug` with SLUG_IMMUTABLE regardless, but the point is
// this screen never gives the operator a field that could produce one.
//
// Loads the document over the PUBLIC detail endpoint (GET
// /api/public/documents/:slug) rather than inventing an admin-only GET —
// the current published document is public data already (AGENT.md §5
// "Public Read"), and every route this screen WRITES through is still
// bearer-authenticated.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { adminRequest } from "../../lib/admin-session";
import {
  getDocument,
  type DeleteDocumentResult,
  type DocumentDetail,
  type RestoreVersionResult,
  type UploadVersionResult,
  type VersionHistoryEntry,
} from "../../lib/api-client";
import { VersionTable } from "../../features/versions/VersionTable";
import { VersionPreview } from "../../features/versions/VersionPreview";

interface CategoryOption {
  id: string;
  name: string;
}

const inputClass =
  "mt-1.5 block w-full border-2 border-[#071e4a] bg-white px-3 py-3 text-sm text-[#071e4a] focus:outline-2 focus:outline-offset-2 focus:outline-[#0e9e85]";

export function DocumentEditPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // Version history state — node G3.5. Kept independent of the metadata
  // load()/save() cycle above: a restore, a version upload or a version
  // delete never touches title/description/tags/category, so refreshing
  // the version list must never clobber whatever the operator is mid-way
  // through typing in the metadata form above.
  const [versions, setVersions] = useState<VersionHistoryEntry[] | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [previewVersionNo, setPreviewVersionNo] = useState<number | null>(null);

  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionNote, setVersionNote] = useState("");
  const [versionUploadBusy, setVersionUploadBusy] = useState(false);
  const [versionUploadError, setVersionUploadError] = useState<string | null>(null);
  const [versionUploadMessage, setVersionUploadMessage] = useState<string | null>(null);

  // Requirement 5: document deletion requires typing the slug back,
  // matching the API's `confirmSlug` contract exactly.
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Guards against a second race, subtler than the one that gates the form
  // below: React Strict Mode (and, in principle, any caller invoking load()
  // again before an earlier call has resolved) can leave two of these
  // Promise.all() chains in flight for the same screen at once. Both fetch
  // the same pre-edit document, so whichever happens to resolve LAST wins —
  // and if that is the stale one, it silently reapplies the untouched
  // server values over whatever the operator has since typed. Each call
  // stamps its own generation and only applies its result if no newer
  // load() has started since; a superseded response is dropped instead of
  // overwriting the form.
  const loadGeneration = useRef(0);

  const load = useCallback(() => {
    if (slug === undefined) return;
    const generation = ++loadGeneration.current;
    Promise.all([getDocument(slug), adminRequest<{ categories: CategoryOption[] }>("/api/admin/categories")])
      .then(([detail, categoryData]) => {
        if (loadGeneration.current !== generation) return;
        setDoc(detail);
        setCategories(categoryData.categories);
        setTitle(detail.title);
        setDescription(detail.description);
        setTagsText(detail.tags.join(", "));
        setCategoryId(detail.categoryId);
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        if (loadGeneration.current !== generation) return;
        if (cause instanceof Error && cause.name === "SessionExpiredError") {
          onSessionExpired();
          return;
        }
        setLoadError(cause instanceof Error ? cause.message : "The document could not be loaded.");
      });
  }, [slug, onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const loadVersions = useCallback(() => {
    if (slug === undefined) return;
    adminRequest<{ versions: VersionHistoryEntry[] }>(`/api/admin/documents/${encodeURIComponent(slug)}/versions`)
      .then((data) => {
        setVersions(data.versions);
        setVersionsError(null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === "SessionExpiredError") {
          onSessionExpired();
          return;
        }
        setVersionsError(cause instanceof Error ? cause.message : "Version history could not be loaded.");
      });
  }, [slug, onSessionExpired]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  async function withSessionGuard<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "SessionExpiredError") onSessionExpired();
      throw cause;
    }
  }

  async function handleUploadVersion(event: React.FormEvent) {
    event.preventDefault();
    if (versionFile === null || slug === undefined) return;

    setVersionUploadBusy(true);
    setVersionUploadError(null);
    setVersionUploadMessage(null);
    try {
      const form = new FormData();
      form.set("file", versionFile);
      // Omitted entirely when blank, matching the server's optional field
      // rather than sending an empty string on purpose.
      if (versionNote.trim() !== "") form.set("note", versionNote.trim());
      const result = await withSessionGuard(() =>
        adminRequest<UploadVersionResult>(`/api/admin/documents/${encodeURIComponent(slug)}/versions`, {
          method: "POST",
          body: form,
        }),
      );
      // Requirement 6: UNCHANGED is a calm outcome, not an error — the
      // upload was accepted, nothing new needed creating, and the table
      // is deliberately left exactly as it was (Edge Case: "Upload of
      // identical bytes -> UNCHANGED message, table unchanged").
      setVersionUploadMessage(
        result.unchanged
          ? `Nothing changed — those bytes are identical to version ${result.versionNo}, which is already current. No new version was created.`
          : `Published as version ${result.versionNo}.`,
      );
      if (!result.unchanged) {
        setVersionFile(null);
        setVersionNote("");
        loadVersions();
      }
    } catch (cause) {
      setVersionUploadError(cause instanceof Error ? cause.message : "The new version could not be uploaded.");
    } finally {
      setVersionUploadBusy(false);
    }
  }

  async function handleRestore(versionNo: number): Promise<void> {
    if (slug === undefined) return;
    // Append-only restore (SPEC.md §12): always creates a brand-new version.
    await withSessionGuard(() =>
      adminRequest<RestoreVersionResult>(`/api/admin/documents/${encodeURIComponent(slug)}/restore/${versionNo}`, {
        method: "POST",
      }),
    );
    loadVersions();
  }

  async function handleDeleteVersion(versionNo: number): Promise<void> {
    if (slug === undefined) return;
    await withSessionGuard(() =>
      adminRequest<{ deletedVersionNo: number }>(
        `/api/admin/documents/${encodeURIComponent(slug)}/versions/${versionNo}`,
        { method: "DELETE" },
      ),
    );
    loadVersions();
  }

  async function handleDeleteDocument(event: React.FormEvent) {
    event.preventDefault();
    if (slug === undefined || deleteConfirmSlug !== slug) return;

    setDeleteBusy(true);
    setDeleteError(null);
    try {
      // The only irreversible Phase 1 operation — `confirmSlug` must match
      // exactly (SPEC.md §13).
      await withSessionGuard(() =>
        adminRequest<DeleteDocumentResult>(`/api/admin/documents/${encodeURIComponent(slug)}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmSlug: deleteConfirmSlug }),
        }),
      );
      navigate("/admin");
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "The document could not be deleted.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (doc === null || slug === undefined) return;

    setSaving(true);
    setSaveError(null);
    setSavedNote(null);

    const tags = tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");
    const metadataChanged =
      title.trim() !== doc.title || description.trim() !== doc.description || tags.join("\u0000") !== doc.tags.join("\u0000");
    const categoryChanged = categoryId !== doc.categoryId;

    try {
      if (metadataChanged) {
        await adminRequest(`/api/admin/documents/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim(), description: description.trim(), tags }),
        });
      }
      if (categoryChanged) {
        await adminRequest(`/api/admin/documents/${encodeURIComponent(slug)}/move`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ categoryId }),
        });
      }
      setSavedNote(
        metadataChanged || categoryChanged
          ? "Saved. The slug and public URL did not change."
          : "Nothing was changed.",
      );
      // Requirement 6: refetch rather than patch locally — a rename or a
      // category delete could have happened elsewhere in the meantime.
      load();
    } catch (cause: unknown) {
      if (cause instanceof Error && cause.name === "SessionExpiredError") {
        onSessionExpired();
        return;
      }
      setSaveError(cause instanceof Error ? cause.message : "The document could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (slug === undefined) {
    return (
      <p role="alert" className="border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
        No document slug was given.
      </p>
    );
  }
  if (loadError !== null) {
    return (
      <p role="alert" className="border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
        {loadError}
      </p>
    );
  }
  if (doc === null) {
    return <p className="py-6 text-sm text-[#526889]">Loading document…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-[-0.03em] text-[#071e4a]">Edit document</h2>
      </div>

      <div>
        <span className="block text-sm font-black text-[#071e4a]">Slug</span>
        <code className="mt-1.5 block w-full border-2 border-[#071e4a]/40 bg-[#e7eaf0] px-3 py-3 text-sm text-[#071e4a]">
          {doc.slug}
        </code>
        <p className="mt-1 text-xs leading-5 text-[#526889]">
          The slug is permanent — it is the document&apos;s public URL and never changes here. Retitling this
          document or moving it to a different category never affects it.
        </p>
      </div>

      <form onSubmit={(event) => void save(event)} className="space-y-5">
        <div>
          <label htmlFor="edit-title" className="block text-sm font-black text-[#071e4a]">
            Title
          </label>
          <input id="edit-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="edit-description" className="block text-sm font-black text-[#071e4a]">
            Description
          </label>
          <textarea
            id="edit-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="edit-tags" className="block text-sm font-black text-[#071e4a]">
            Tags (comma separated)
          </label>
          <input
            id="edit-tags"
            type="text"
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="edit-category" className="block text-sm font-black text-[#071e4a]">
            Category
          </label>
          <select id="edit-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={inputClass}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {saveError !== null && (
          <p role="alert" className="border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
            {saveError}
          </p>
        )}
        {savedNote !== null && (
          <p role="status" className="border border-[#0e9e85] bg-[#d9f4eb] px-3 py-2 text-sm text-[#071e4a]">
            {savedNote}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-[#f26b21] px-4 py-3 text-sm font-black text-[#071e4a] transition hover:bg-[#ff873f] disabled:cursor-not-allowed disabled:bg-[#f4c3a6] disabled:text-[#071e4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a] sm:w-auto"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>

      <div className="border-t-2 border-[#071e4a] pt-6">
        <h3 className="text-xl font-black tracking-[-0.02em] text-[#071e4a]">Version history</h3>
        <p className="mt-1 text-sm leading-6 text-[#27416c]">
          Every version is immutable — uploading a new one never overwrites an old one, and restoring an old one
          creates a new version rather than rewinding.
        </p>

        <form
          onSubmit={(event) => void handleUploadVersion(event)}
          className="mt-4 space-y-3 border-2 border-dashed border-[#071e4a]/55 p-4"
        >
          <div>
            <label htmlFor="version-file" className="block text-sm font-black text-[#071e4a]">
              Upload a new version
            </label>
            <input
              id="version-file"
              type="file"
              accept=".html"
              className="mt-1.5 block w-full border-2 border-[#071e4a] bg-white px-3 py-2.5 text-sm text-[#27416c] file:mr-3 file:border-0 file:bg-[#071e4a] file:px-3 file:py-2 file:text-sm file:font-bold file:text-[#f7f5ef]"
              onChange={(event) => setVersionFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div>
            <label htmlFor="version-note" className="block text-sm font-black text-[#071e4a]">
              Note (optional)
            </label>
            <input
              id="version-note"
              type="text"
              value={versionNote}
              onChange={(event) => setVersionNote(event.target.value)}
              className={inputClass}
            />
          </div>

          {versionUploadError !== null && (
            <p role="alert" className="border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
              {versionUploadError}
            </p>
          )}
          {versionUploadMessage !== null && (
            <p role="status" className="border border-[#0e9e85] bg-[#d9f4eb] px-3 py-2 text-sm text-[#071e4a]">
              {versionUploadMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={versionUploadBusy || versionFile === null}
            className="w-full bg-[#f26b21] px-4 py-2.5 text-sm font-black text-[#071e4a] hover:bg-[#ff873f] disabled:cursor-not-allowed disabled:bg-[#f4c3a6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a] sm:w-auto"
          >
            {versionUploadBusy ? "Uploading…" : "Upload new version"}
          </button>
        </form>

        <div className="mt-4">
          {versionsError !== null && (
            <p role="alert" className="border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
              {versionsError}
            </p>
          )}
          {versionsError === null && versions === null && (
            <p className="py-6 text-sm text-[#526889]">Loading version history…</p>
          )}
          {versions !== null && (
            <VersionTable
              versions={versions}
              onPreview={setPreviewVersionNo}
              onRestore={handleRestore}
              onDelete={handleDeleteVersion}
            />
          )}
        </div>
      </div>

      <div className="border-t-2 border-red-700 pt-6">
        <h3 className="text-xl font-black tracking-[-0.02em] text-red-800">Delete document</h3>
        <p className="mt-1 text-sm leading-6 text-[#27416c]">
          This permanently removes the document, every version and its stored content. It cannot be undone. Type the
          slug{" "}
          <span className="font-mono font-bold text-red-800" data-testid="delete-confirm-slug-hint">
            {doc.slug}
          </span>{" "}
          to confirm.
        </p>
        <form onSubmit={(event) => void handleDeleteDocument(event)} className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="delete-confirm-slug" className="sr-only">
              Type &quot;{doc.slug}&quot; to confirm deletion
            </label>
            <input
              id="delete-confirm-slug"
              type="text"
              value={deleteConfirmSlug}
              onChange={(event) => setDeleteConfirmSlug(event.target.value)}
              placeholder={doc.slug}
              className="block w-full border-2 border-red-700 bg-white px-3 py-2.5 text-sm text-[#071e4a] focus:outline-2 focus:outline-offset-2 focus:outline-red-700"
            />
          </div>
          <button
            type="submit"
            disabled={deleteBusy || deleteConfirmSlug !== doc.slug}
            className="border-2 border-red-700 bg-red-700 px-4 py-2.5 text-sm font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:border-red-300 disabled:bg-red-100 disabled:text-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            {deleteBusy ? "Deleting…" : "Delete document permanently"}
          </button>
        </form>
        {deleteConfirmSlug !== "" && deleteConfirmSlug !== doc.slug && (
          <p className="mt-1 text-xs text-red-800">The typed text must match the slug exactly.</p>
        )}
        {deleteError !== null && (
          <p role="alert" className="mt-2 border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
            {deleteError}
          </p>
        )}
      </div>

      {previewVersionNo !== null && (
        <VersionPreview slug={doc.slug} versionNo={previewVersionNo} onClose={() => setPreviewVersionNo(null)} />
      )}
    </div>
  );
}

export default DocumentEditPage;
