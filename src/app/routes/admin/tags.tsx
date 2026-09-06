// /admin/tags — node G2.5.
//
// The list itself is read from the PUBLIC tag endpoint (GET
// /api/public/tags, node G2.4) rather than a bearer-authenticated one —
// there is no admin-only tag listing route, and tag names/counts carry no
// permission-sensitive information (SPEC.md §18 already exposes them to
// every anonymous reader for filtering). Every mutation still goes through
// the bearer-authenticated /api/admin/tags/* routes.
import { useCallback, useEffect, useState } from "react";
import { adminRequest } from "../../lib/admin-session";
import { TagTable, type TagListItem } from "../../features/tags/TagTable";

interface PublicTagEnvelope {
  ok: boolean;
  data?: TagListItem[];
  error?: { message: string };
}

export function TagsPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [tags, setTags] = useState<TagListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/public/tags")
      .then((response) => response.json() as Promise<PublicTagEnvelope>)
      .then((envelope) => {
        if (!envelope.ok || envelope.data === undefined) {
          setLoadError(envelope.error?.message ?? "Tags could not be loaded.");
          return;
        }
        setTags(envelope.data);
        setLoadError(null);
      })
      .catch(() => setLoadError("Tags could not be loaded."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function withSessionGuard<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "SessionExpiredError") onSessionExpired();
      throw cause;
    }
  }

  async function handleCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (newName.trim() === "") return;
    setCreating(true);
    setCreateError(null);
    try {
      await withSessionGuard(() =>
        adminRequest("/api/admin/tags", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: newName.trim() }),
        }),
      );
      setNewName("");
      load();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "The tag could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(id: string, name: string): Promise<void> {
    await withSessionGuard(() =>
      adminRequest(`/api/admin/tags/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    );
    load();
  }

  async function handleMerge(sourceId: string, targetId: string): Promise<void> {
    await withSessionGuard(() =>
      adminRequest(`/api/admin/tags/${encodeURIComponent(sourceId)}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId }),
      }),
    );
    load();
  }

  async function handleDelete(id: string): Promise<void> {
    await withSessionGuard(() => adminRequest(`/api/admin/tags/${encodeURIComponent(id)}`, { method: "DELETE" }));
    load();
  }

  if (loadError !== null) {
    return (
      <p role="alert" className="border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
        {loadError}
      </p>
    );
  }
  if (tags === null) {
    return <p className="py-6 text-sm text-[#526889]">Loading tags…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-[-0.03em] text-[#071e4a]">Tags</h2>
        <p className="mt-1 text-sm leading-6 text-[#27416c]">
          Admin and Agents may both create tags. Renaming or merging here changes every document that carries the
          tag.
        </p>
      </div>

      <form onSubmit={(event) => void handleCreate(event)} className="flex flex-wrap items-end gap-3 border-b-2 border-[#071e4a] pb-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="new-tag-name" className="block text-sm font-black text-[#071e4a]">
            New tag
          </label>
          <input
            id="new-tag-name"
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="e.g. valuation"
            className="mt-1.5 block w-full border-2 border-[#071e4a] bg-white px-3 py-2.5 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-[#0e9e85]"
          />
        </div>
        <button
          type="submit"
          disabled={creating || newName.trim() === ""}
          className="bg-[#f26b21] px-4 py-2.5 text-sm font-black text-[#071e4a] hover:bg-[#ff873f] disabled:cursor-not-allowed disabled:bg-[#f4c3a6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
        >
          {creating ? "Creating…" : "Add tag"}
        </button>
        {createError !== null && (
          <p role="alert" className="w-full border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
            {createError}
          </p>
        )}
      </form>

      <TagTable tags={tags} onRename={handleRename} onMerge={handleMerge} onDelete={handleDelete} />
    </div>
  );
}

export default TagsPage;
