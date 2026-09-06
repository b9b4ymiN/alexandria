// The admin category tree: arbitrary depth, create/rename/move/delete.
//
// Written by node G2.5. Presentational only — every mutation is delegated
// to the callback props that categories.tsx supplies, and that page owns
// the actual request AND the refetch afterward. This component never
// patches its own `categories` prop optimistically (Implementation
// Requirement 6): a cycle, a non-empty delete, or a slug conflict are all
// guards the server evaluates, and the operator must see what the server
// actually decided, not a guess.
//
// Every action below is a plain, always-visible button or form control —
// nothing here is revealed only on hover (Implementation Requirement 5,
// AGENT.md §24). Indentation is applied with an inline style rather than a
// dynamic Tailwind class, and the action row wraps with `flex-wrap` rather
// than scrolling, so a ten-level-deep tree stays free of horizontal
// overflow at 375px (edge case: "a tree ten levels deep is still
// navigable at 375 pixels").
import { useState } from "react";

export interface CategoryTreeItem {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  documentCount: number;
}

interface TreeNode extends CategoryTreeItem {
  children: TreeNode[];
}

const INDENT_PX = 18;

function buildTree(flat: CategoryTreeItem[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const category of flat) byId.set(category.id, { ...category, children: [] });

  const roots: TreeNode[] = [];
  for (const category of flat) {
    const node = byId.get(category.id);
    if (node === undefined) continue;
    const parent = category.parentId !== null ? byId.get(category.parentId) : undefined;
    if (parent !== undefined) {
      parent.children.push(node);
    } else {
      // A true root, or an orphan that FK RESTRICT should make impossible —
      // surfaced rather than silently dropped either way.
      roots.push(node);
    }
  }

  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const node of nodes) sortChildren(node.children);
  };
  sortChildren(roots);
  return roots;
}

const inputClass =
  "block w-full border-2 border-[#071e4a] bg-white px-2.5 py-2 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-[#0e9e85]";
const primaryButtonClass =
  "bg-[#f26b21] px-3 py-2 text-xs font-black text-[#071e4a] hover:bg-[#ff873f] disabled:cursor-not-allowed disabled:bg-[#f4c3a6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]";
const secondaryButtonClass =
  "border border-[#071e4a] px-2.5 py-1.5 text-xs font-bold text-[#071e4a] hover:bg-[#d9f4eb] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]";
const cancelButtonClass = "px-2 py-2 text-xs font-semibold text-[#27416c] underline";

export function CategoryTree({
  categories,
  expandedIds,
  onToggleExpand,
  onExpand,
  onCreate,
  onRename,
  onMove,
  onDelete,
}: {
  categories: CategoryTreeItem[];
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onExpand: (id: string) => void;
  onCreate: (parentId: string | null, name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onMove: (id: string, newParentId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const tree = buildTree(categories);

  return (
    <div className="space-y-4">
      <RootCreateForm onCreate={(name) => onCreate(null, name)} />
      {tree.length === 0 ? (
        <p className="py-6 text-sm leading-6 text-[#27416c]">No categories yet. Create the first one above.</p>
      ) : (
        <ul className="divide-y divide-[#071e4a]/15 border-y-2 border-[#071e4a]">
          {tree.map((node) => (
            <CategoryRow
              key={node.id}
              node={node}
              depth={0}
              categories={categories}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onExpand={onExpand}
              onCreate={onCreate}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RootCreateForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The category could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-3 border-b-2 border-[#071e4a] pb-4">
      <div className="min-w-0 flex-1">
        <label htmlFor="new-root-category" className="block text-sm font-black text-[#071e4a]">
          New top-level category
        </label>
        <input
          id="new-root-category"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Research"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <button type="submit" disabled={busy || name.trim() === ""} className={primaryButtonClass}>
        {busy ? "Creating…" : "Add category"}
      </button>
      {error !== null && (
        <p role="alert" className="w-full border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}

type RowMode = "idle" | "add" | "rename" | "move";

function CategoryRow({
  node,
  depth,
  categories,
  expandedIds,
  onToggleExpand,
  onExpand,
  onCreate,
  onRename,
  onMove,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  categories: CategoryTreeItem[];
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onExpand: (id: string) => void;
  onCreate: (parentId: string | null, name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onMove: (id: string, newParentId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<RowMode>("idle");
  const [draftName, setDraftName] = useState(node.name);
  const [draftParentId, setDraftParentId] = useState<string>(node.parentId ?? "");
  const [childName, setChildName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const indent = { paddingLeft: `${depth * INDENT_PX}px` };
  const formIndent = { paddingLeft: `${depth * INDENT_PX + 34}px` };

  function openMode(next: RowMode) {
    setError(null);
    setMode((current) => (current === next ? "idle" : next));
  }

  async function runRename(event: React.FormEvent) {
    event.preventDefault();
    if (draftName.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await onRename(node.id, draftName.trim());
      setMode("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The category could not be renamed.");
    } finally {
      setBusy(false);
    }
  }

  async function runMove(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onMove(node.id, draftParentId === "" ? null : draftParentId);
      setMode("idle");
    } catch (cause) {
      // Requirement 1 + edge case: a cycle or depth guard is shown right
      // here, next to the move control that triggered it, and the tree
      // itself is never touched because onMove's caller only refetches on
      // success.
      setError(cause instanceof Error ? cause.message : "The category could not be moved.");
    } finally {
      setBusy(false);
    }
  }

  async function runCreateChild(event: React.FormEvent) {
    event.preventDefault();
    if (childName.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(node.id, childName.trim());
      setChildName("");
      setMode("idle");
      onExpand(node.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The subcategory could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    // Requirement 2: the confirmation names the exact object, not a
    // generic "this category".
    const confirmed = window.confirm(`Delete category "${node.name}"? This cannot be undone.`);
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(node.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The category could not be deleted.");
      // A non-empty delete failure is exactly when the operator most needs
      // to see what is inside, so make sure it is not hidden collapsed.
      if (hasChildren) onExpand(node.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" style={indent}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpand(node.id)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse "${node.name}"` : `Expand "${node.name}"`}
            className="flex h-6 w-6 shrink-0 items-center justify-center border border-[#071e4a] text-xs font-black text-[#071e4a] hover:bg-[#d9f4eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
          >
            {expanded ? "−" : "+"}
          </button>
        ) : (
          <span className="h-6 w-6 shrink-0" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          <p data-testid="category-name" className="truncate text-sm font-black text-[#071e4a]">
            {node.name}
          </p>
          <p className="text-xs text-[#526889]">
            /{node.slug} &middot; {node.documentCount} document{node.documentCount === 1 ? "" : "s"}
            {hasChildren
              ? ` · ${node.children.length} subcategor${node.children.length === 1 ? "y" : "ies"}`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => openMode("add")}
            aria-label={`Add a subcategory under "${node.name}"`}
            className={secondaryButtonClass}
          >
            Add subcategory
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraftName(node.name);
              openMode("rename");
            }}
            aria-label={`Rename "${node.name}"`}
            className={secondaryButtonClass}
          >
            Rename
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraftParentId(node.parentId ?? "");
              openMode("move");
            }}
            aria-label={`Move "${node.name}"`}
            className={secondaryButtonClass}
          >
            Move
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runDelete()}
            aria-label={`Delete "${node.name}"`}
            className="border border-red-700 px-2.5 py-1.5 text-xs font-bold text-red-800 hover:bg-red-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            Delete
          </button>
        </div>
      </div>

      {error !== null && (
        <p role="alert" style={formIndent} className="pb-2 pr-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {mode === "add" && (
        <form onSubmit={(event) => void runCreateChild(event)} style={formIndent} className="flex flex-wrap items-end gap-2 pb-3 pr-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`add-child-${node.id}`} className="sr-only">
              New subcategory name under &quot;{node.name}&quot;
            </label>
            <input
              id={`add-child-${node.id}`}
              type="text"
              value={childName}
              onChange={(event) => setChildName(event.target.value)}
              placeholder="Subcategory name"
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={busy || childName.trim() === ""}
            aria-label={`Confirm new subcategory under "${node.name}"`}
            className={primaryButtonClass}
          >
            Add
          </button>
          <button type="button" onClick={() => setMode("idle")} className={cancelButtonClass}>
            Cancel
          </button>
        </form>
      )}

      {mode === "rename" && (
        <form onSubmit={(event) => void runRename(event)} style={formIndent} className="flex flex-wrap items-end gap-2 pb-3 pr-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`rename-${node.id}`} className="sr-only">
              New name for &quot;{node.name}&quot;
            </label>
            <input
              id={`rename-${node.id}`}
              type="text"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={busy || draftName.trim() === ""}
            aria-label={`Save new name for "${node.name}"`}
            className={primaryButtonClass}
          >
            Save name
          </button>
          <button type="button" onClick={() => setMode("idle")} className={cancelButtonClass}>
            Cancel
          </button>
        </form>
      )}

      {mode === "move" && (
        <form onSubmit={(event) => void runMove(event)} style={formIndent} className="flex flex-wrap items-end gap-2 pb-3 pr-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`move-${node.id}`} className="block text-xs font-bold text-[#071e4a]">
              Move &quot;{node.name}&quot; under
            </label>
            <select
              id={`move-${node.id}`}
              value={draftParentId}
              onChange={(event) => setDraftParentId(event.target.value)}
              className={`mt-1 ${inputClass}`}
            >
              <option value="">— Top level —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={busy} aria-label={`Confirm move of "${node.name}"`} className={primaryButtonClass}>
            Move
          </button>
          <button type="button" onClick={() => setMode("idle")} className={cancelButtonClass}>
            Cancel
          </button>
        </form>
      )}

      {expanded && hasChildren && (
        <ul className="divide-y divide-[#071e4a]/10 border-t border-[#071e4a]/15">
          {node.children.map((child) => (
            <CategoryRow
              key={child.id}
              node={child}
              depth={depth + 1}
              categories={categories}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onExpand={onExpand}
              onCreate={onCreate}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
