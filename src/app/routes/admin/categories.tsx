// /admin/categories — node G2.5.
//
// Owns the fetch/mutate/refetch cycle; CategoryTree.tsx is purely
// presentational. GOAL.md §10: Admin grows the category structure with no
// code change, and this screen is that promise made real.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { adminRequest } from "../../lib/admin-session";
import { listDocuments, type DocumentSummary } from "../../lib/api-client";
import { CategoryTree, type CategoryTreeItem } from "../../features/categories/CategoryTree";

interface NotEmptyBlockers {
  categoryName: string;
  summary: string;
  documents: DocumentSummary[];
  documentTotal: number;
}

export function CategoriesPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [categories, setCategories] = useState<CategoryTreeItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [blockers, setBlockers] = useState<NotEmptyBlockers | null>(null);

  const load = useCallback(() => {
    adminRequest<{ categories: CategoryTreeItem[] }>("/api/admin/categories")
      .then((data) => {
        setCategories(data.categories);
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === "SessionExpiredError") {
          onSessionExpired();
          return;
        }
        setLoadError(cause instanceof Error ? cause.message : "Categories could not be loaded.");
      });
  }, [onSessionExpired]);

  useEffect(() => {
    load();
  }, [load]);

  // Requirement 3: expansion state lives here, not inside the tree, so a
  // refetch — which replaces `categories` wholesale — never resets it.
  function toggleExpand(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function expandCategory(id: string) {
    setExpanded((previous) => (previous.has(id) ? previous : new Set(previous).add(id)));
  }

  async function withSessionGuard<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "SessionExpiredError") onSessionExpired();
      throw cause;
    }
  }

  async function handleCreate(parentId: string | null, name: string): Promise<void> {
    await withSessionGuard(() =>
      adminRequest("/api/admin/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId, name }),
      }),
    );
    setBlockers(null);
    load();
  }

  async function handleRename(id: string, name: string): Promise<void> {
    await withSessionGuard(() =>
      adminRequest(`/api/admin/categories/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    );
    load();
  }

  async function handleMove(id: string, newParentId: string | null): Promise<void> {
    // Deliberately NOT filtered client-side to exclude descendants: the
    // server's cycle guard is the authority (CATEGORY_CYCLE), and the
    // operator needs to see that exact guard message when they try it,
    // not have the option silently disappear (edge case: moving into an
    // own descendant shows the guard and leaves the tree unchanged).
    await withSessionGuard(() =>
      adminRequest(`/api/admin/categories/${encodeURIComponent(id)}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: newParentId }),
      }),
    );
    load();
  }

  async function handleDelete(id: string): Promise<void> {
    const category = categories?.find((candidate) => candidate.id === id);
    try {
      await withSessionGuard(() =>
        adminRequest(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" }),
      );
      setBlockers(null);
      load();
    } catch (cause) {
      if (cause instanceof Error && (cause as Error & { code?: string }).code === "CATEGORY_NOT_EMPTY") {
        await describeBlockers(id, category?.name ?? "This category");
      }
      throw cause;
    }
  }

  // Requirement 1: names exactly what is still filed in a non-empty
  // category. Child-category names come from the list already in memory;
  // document titles are a best-effort preview fetch (public endpoint, so
  // it can never itself be the reason the guard message fails to show).
  async function describeBlockers(categoryId: string, categoryName: string): Promise<void> {
    const childNames = (categories ?? [])
      .filter((candidate) => candidate.parentId === categoryId)
      .map((candidate) => candidate.name);

    let documents: DocumentSummary[] = [];
    let documentTotal = 0;
    try {
      const result = await listDocuments({ categoryId, pageSize: 5 });
      documents = result.items;
      documentTotal = result.total;
    } catch {
      // Best-effort only — the guard message still stands without a preview.
    }

    const parts: string[] = [];
    if (childNames.length > 0) {
      parts.push(`${childNames.length} subcategor${childNames.length === 1 ? "y" : "ies"} (${childNames.join(", ")})`);
    }
    if (documentTotal > 0) {
      parts.push(`${documentTotal} document${documentTotal === 1 ? "" : "s"}`);
    }

    setBlockers({
      categoryName,
      summary: parts.length > 0 ? parts.join(" and ") : "something that has not finished loading",
      documents,
      documentTotal,
    });
  }

  if (loadError !== null) {
    return (
      <p role="alert" className="border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
        {loadError}
      </p>
    );
  }
  if (categories === null) {
    return <p className="py-6 text-sm text-[#526889]">Loading categories…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-[-0.03em] text-[#071e4a]">Categories</h2>
        <p className="mt-1 text-sm leading-6 text-[#27416c]">
          Admin owns this structure end to end — an Agent can file a document into an existing category but never
          create, rename, move or delete one.
        </p>
      </div>

      {blockers !== null && (
        <div role="alert" className="space-y-2 border border-red-700 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>
            &ldquo;{blockers.categoryName}&rdquo; still contains {blockers.summary}, so it cannot be deleted yet — it
            is expanded below.
          </p>
          {blockers.documents.length > 0 && (
            <p>
              Filed here:{" "}
              {blockers.documents.map((doc, index) => (
                <span key={doc.slug}>
                  {index > 0 && ", "}
                  <Link to={`/admin/documents/${doc.slug}`} className="underline decoration-2 underline-offset-2">
                    {doc.title}
                  </Link>
                </span>
              ))}
              {blockers.documentTotal > blockers.documents.length &&
                ` and ${blockers.documentTotal - blockers.documents.length} more`}
              . Move each to another category, then delete again.
            </p>
          )}
        </div>
      )}

      <CategoryTree
        categories={categories}
        expandedIds={expanded}
        onToggleExpand={toggleExpand}
        onExpand={expandCategory}
        onCreate={handleCreate}
        onRename={handleRename}
        onMove={handleMove}
        onDelete={handleDelete}
      />
    </div>
  );
}

export default CategoriesPage;
