// Admin route group entry point.
//
// The code-split boundary is owned by node G1.10; the screens are owned by
// node G1.11 (login, upload), G2.5 (categories, tags, document metadata)
// and later G3.5. Everything admin stays behind this lazy boundary so
// opening the public Library never downloads a byte of it (TECHSTACK.md
// §22, AGENT.md §25) — every G2.5 screen is imported only from here, so it
// rides the same chunk rather than adding a second entry point.
//
// G2.5 adds real sub-routes (/admin/categories, /admin/tags,
// /admin/documents/:slug) with a <Routes> nested inside the "/admin/*"
// splat route main.tsx already mounts. Login and Upload behave exactly as
// before: `signedIn` still gates everything, and a session expiring
// mid-operation drops back to LoginForm WITHOUT touching the URL, so
// signing back in re-renders the very screen the operator was on (edge
// case: "session expiry mid-operation returns to login and then back to
// the same screen").
import { useCallback, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate } from "react-router";
import { clearToken, login, readToken } from "../../lib/admin-session";
import { UploadForm } from "../../features/upload/UploadForm";
import { CategoriesPage } from "./categories";
import { TagsPage } from "./tags";
import { DocumentEditPage } from "./document-edit";

export function AdminRoot() {
  const [signedIn, setSignedIn] = useState(() => readToken() !== null);

  const handleSessionExpired = useCallback(() => {
    clearToken();
    setSignedIn(false);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#071e4a] px-5 py-6 text-[#071e4a] sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl bg-[#f7f5ef] px-5 py-6 shadow-[14px_16px_32px_rgba(0,0,0,0.24)] sm:px-8 sm:py-9">
      <header className="flex items-baseline justify-between border-b-2 border-[#071e4a] pb-4">
        <h1 className="text-3xl font-black tracking-[-0.04em]">Alexandria Admin</h1>
        <Link to="/" className="text-sm font-bold text-[#27416c] underline decoration-[#f26b21] decoration-2 underline-offset-4">
          Library
        </Link>
      </header>

      {signedIn ? (
        <>
          <AdminNav
            onSignOut={() => {
              clearToken();
              setSignedIn(false);
            }}
          />
          <div className="pt-6">
            <Routes>
              <Route index element={<UploadForm onSessionExpired={handleSessionExpired} />} />
              <Route path="categories" element={<CategoriesPage onSessionExpired={handleSessionExpired} />} />
              <Route path="tags" element={<TagsPage onSessionExpired={handleSessionExpired} />} />
              <Route path="documents/:slug" element={<DocumentEditPage onSessionExpired={handleSessionExpired} />} />
              <Route path="*" element={<UploadForm onSessionExpired={handleSessionExpired} />} />
            </Routes>
          </div>
        </>
      ) : (
        <div className="pt-8">
          <LoginForm onSignedIn={() => setSignedIn(true)} />
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * Always-visible admin navigation, reachable with no hover (Implementation
 * Requirement 5). The slug box is how an operator reaches
 * /admin/documents/:slug without a document-list screen — G2.5's Scope
 * lists only categories, tags and the edit screen itself, and a
 * just-published document is already one slug away from its own
 * "Open in the Reader" link on the Upload screen; this box covers every
 * other document.
 */
function AdminNav({ onSignOut }: { onSignOut: () => void }) {
  const [slugQuery, setSlugQuery] = useState("");
  const navigate = useNavigate();

  function goToDocument(event: React.FormEvent) {
    event.preventDefault();
    const slug = slugQuery.trim();
    if (slug === "") return;
    navigate(`/admin/documents/${encodeURIComponent(slug)}`);
    setSlugQuery("");
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `border-b-2 pb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a] ${
      isActive ? "border-[#f26b21] text-[#071e4a]" : "border-transparent text-[#27416c] hover:text-[#071e4a]"
    }`;

  return (
    <nav
      aria-label="Admin sections"
      className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#071e4a]/20 pb-4 pt-5 text-sm font-bold"
    >
      <NavLink to="/admin" end className={linkClass}>
        Upload
      </NavLink>
      <NavLink to="/admin/categories" className={linkClass}>
        Categories
      </NavLink>
      <NavLink to="/admin/tags" className={linkClass}>
        Tags
      </NavLink>

      <form onSubmit={goToDocument} className="flex items-center gap-2">
        <label htmlFor="find-document-slug" className="sr-only">
          Edit a document by slug
        </label>
        <input
          id="find-document-slug"
          type="text"
          value={slugQuery}
          onChange={(event) => setSlugQuery(event.target.value)}
          placeholder="document-slug"
          className="w-40 border-2 border-[#071e4a] bg-white px-2 py-1.5 text-xs font-normal focus:outline-2 focus:outline-offset-2 focus:outline-[#0e9e85]"
        />
        <button
          type="submit"
          disabled={slugQuery.trim() === ""}
          className="border border-[#071e4a] px-2.5 py-1.5 text-xs font-bold text-[#071e4a] hover:bg-[#d9f4eb] disabled:opacity-50"
        >
          Edit
        </button>
      </form>

      <button type="button" onClick={onSignOut} className="ml-auto text-xs font-semibold text-[#526889] underline">
        Sign out
      </button>
    </nav>
  );
}

function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      setPassword("");
      onSignedIn();
    } catch (cause: unknown) {
      // Deliberately generic: never hint at whether the password was close.
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-sm space-y-5">
      <div>
        <label htmlFor="password" className="block text-sm font-bold text-[#071e4a]">
          Admin password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1.5 block w-full border-2 border-[#071e4a] bg-white px-3 py-3 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-[#0e9e85]"
        />
      </div>

      {error !== null && (
        <p role="alert" className="border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || password === ""}
        className="w-full bg-[#f26b21] px-4 py-3 text-sm font-black text-[#071e4a] transition hover:bg-[#ff873f] disabled:cursor-not-allowed disabled:bg-[#f4c3a6] disabled:text-[#071e4a] disabled:hover:bg-[#f4c3a6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#071e4a]"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default AdminRoot;
