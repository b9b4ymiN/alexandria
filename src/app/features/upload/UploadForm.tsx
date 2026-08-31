// Upload, review and publish.
//
// Written by node G1.11. The flow is: choose a file, see what Alexandria
// read out of it, correct anything that is wrong, publish once.
//
// Fields the operator did not touch are NOT sent, so the server's own
// extraction wins for them. Only edited fields go up as overrides. That is
// what keeps the server authoritative while still letting a person fix a
// bad title before it becomes a permanent URL.
import { useEffect, useState } from "react";
import { adminRequest } from "../../lib/admin-session";
import { extractClientMetadata, preflight } from "./client-metadata";

interface CategoryOption {
  id: string;
  name: string;
}

interface PublishResult {
  slug: string;
  url: string;
  title: string;
  description: string;
  tags: string[];
  versionNo: number;
}

type Phase =
  | { name: "choosing" }
  | { name: "reviewing" }
  | { name: "publishing" }
  | { name: "published"; result: PublishResult };

export function UploadForm({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "choosing" });
  const [error, setError] = useState<string | null>(null);

  // Extracted values, and the operator's edits kept separately so an
  // untouched field can be omitted from the request entirely.
  const [extracted, setExtracted] = useState({ title: "", description: "", keywords: [] as string[] });
  const [edited, setEdited] = useState<{ title?: string; description?: string; tags?: string }>({});

  useEffect(() => {
    let cancelled = false;
    adminRequest<{ categories: CategoryOption[] }>("/api/admin/categories")
      .then((data) => {
        if (cancelled) return;
        setCategories(data.categories);
        setCategoryId((current) => (current === "" ? (data.categories[0]?.id ?? "") : current));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof Error && cause.name === "SessionExpiredError") {
          onSessionExpired();
          return;
        }
        setError("Categories could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [onSessionExpired]);

  async function chooseFile(chosen: File) {
    const problem = preflight(chosen);
    if (problem !== null) {
      setError(problem);
      setFile(null);
      setPhase({ name: "choosing" });
      return;
    }
    setError(null);
    setFile(chosen);
    const metadata = await extractClientMetadata(chosen);
    setExtracted(metadata);
    setEdited({});
    setPhase({ name: "reviewing" });
  }

  async function publish() {
    if (file === null) return;
    setPhase({ name: "publishing" });
    setError(null);

    const form = new FormData();
    form.set("file", file);
    form.set("categoryId", categoryId);
    // Only edited fields become overrides; untouched ones let the server's
    // own extraction stand.
    if (edited.title !== undefined) form.set("title", edited.title);
    if (edited.description !== undefined) form.set("description", edited.description);
    if (edited.tags !== undefined) {
      form.set(
        "tags",
        JSON.stringify(
          edited.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag !== ""),
        ),
      );
    }

    try {
      const result = await adminRequest<PublishResult>("/api/admin/documents", {
        method: "POST",
        body: form,
      });
      setPhase({ name: "published", result });
    } catch (cause: unknown) {
      if (cause instanceof Error && cause.name === "SessionExpiredError") {
        onSessionExpired();
        return;
      }
      // The chosen file and every edit are deliberately kept, so a failed
      // publish never costs the operator their work.
      setError(cause instanceof Error ? cause.message : "Publishing failed.");
      setPhase({ name: "reviewing" });
    }
  }

  if (phase.name === "published") {
    return <PublishedPanel result={phase.result} onPublishAnother={() => {
      setFile(null);
      setEdited({});
      setPhase({ name: "choosing" });
    }} />;
  }

  return (
    <div className="space-y-7">
      <div>
        <label htmlFor="file" className="block text-sm font-black text-[#071e4a]">
          HTML file
        </label>
        <input
          id="file"
          type="file"
          accept=".html"
          className="mt-2 block w-full border-2 border-dashed border-[#071e4a]/55 bg-white px-3 py-3 text-sm text-[#27416c] file:mr-3 file:border-0 file:bg-[#071e4a] file:px-3 file:py-2 file:text-sm file:font-bold file:text-[#f7f5ef]"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void chooseFile(chosen);
          }}
        />
      </div>

      {error !== null && (
        <p role="alert" className="border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {phase.name !== "choosing" && file !== null && (
        <>
          <Field
            id="title"
            label="Title"
            edited={edited.title !== undefined}
            value={edited.title ?? extracted.title}
            onChange={(value) => setEdited((current) => ({ ...current, title: value }))}
          />
          <Field
            id="description"
            label="Description"
            multiline
            edited={edited.description !== undefined}
            value={edited.description ?? extracted.description}
            onChange={(value) => setEdited((current) => ({ ...current, description: value }))}
          />
          <Field
            id="tags"
            label="Tags (comma separated)"
            edited={edited.tags !== undefined}
            value={edited.tags ?? extracted.keywords.join(", ")}
            onChange={(value) => setEdited((current) => ({ ...current, tags: value }))}
          />

          <div>
            <label htmlFor="category" className="block text-sm font-black text-[#071e4a]">
              Category
            </label>
            <select
              id="category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="mt-2 block w-full border-2 border-[#071e4a] bg-white px-3 py-3 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-[#0e9e85]"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={phase.name === "publishing" || categoryId === ""}
            onClick={() => void publish()}
            className="w-full bg-[#f26b21] px-4 py-3 text-sm font-black text-[#071e4a] transition hover:bg-[#ff873f] disabled:cursor-not-allowed disabled:bg-[#f4c3a6] disabled:text-[#071e4a] disabled:hover:bg-[#f4c3a6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a] sm:w-auto"
          >
            {phase.name === "publishing" ? "Publishing…" : "Publish"}
          </button>
        </>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  edited,
  multiline = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  edited: boolean;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const shared =
    "mt-2 block w-full border-2 border-[#071e4a] bg-white px-3 py-3 text-sm text-[#071e4a] focus:outline-2 focus:outline-offset-2 focus:outline-[#0e9e85]";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="block text-sm font-black text-[#071e4a]">
          {label}
        </label>
        <span className="text-xs font-medium text-[#526889]">{edited ? "edited" : "read from the file"}</span>
      </div>
      {multiline ? (
        <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={shared} />
      ) : (
        <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} className={shared} />
      )}
    </div>
  );
}

function PublishedPanel({
  result,
  onPublishAnother,
}: {
  result: PublishResult;
  onPublishAnother: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-[#27416c]">
        Published as version {result.versionNo}. This URL is permanent — updating the document later
        will not change it.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="flex-1 truncate border border-[#071e4a]/30 bg-white px-3 py-2 text-xs text-[#071e4a]">
          {result.url}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(result.url).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
          className="border border-[#071e4a] px-3 py-2 text-sm font-bold text-[#071e4a] hover:bg-[#d9f4eb]"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <div className="flex gap-3">
        <a
          href={`/docs/${result.slug}`}
          className="text-sm font-bold text-[#071e4a] underline decoration-[#f26b21] decoration-2 underline-offset-4"
        >
          Open in the Reader
        </a>
        <button type="button" onClick={onPublishAnother} className="text-sm font-semibold text-[#27416c] underline">
          Publish another
        </button>
      </div>
      <dl className="border-t-2 border-[#071e4a] pt-3 text-xs text-[#27416c]">
        <div className="flex gap-2">
          <dt className="font-medium">Title</dt>
          <dd>{result.title}</dd>
        </div>
        <div className="mt-1 flex gap-2">
          <dt className="font-medium">Tags</dt>
          <dd>{result.tags.length === 0 ? "none" : result.tags.join(", ")}</dd>
        </div>
      </dl>
    </div>
  );
}
