// Admin route group entry point.
//
// The code-split boundary is owned by node G1.10; the screens are owned by
// node G1.11 (login, upload) and later by G2.5 and G3.5. Everything admin
// stays behind this lazy boundary so opening the public Library never
// downloads a byte of it (TECHSTACK.md §22, AGENT.md §25).
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { clearToken, login, readToken } from "../../lib/admin-session";
import { UploadForm } from "../../features/upload/UploadForm";

export function AdminRoot() {
  const [signedIn, setSignedIn] = useState(() => readToken() !== null);

  const handleSessionExpired = useCallback(() => {
    clearToken();
    setSignedIn(false);
  }, []);

  return (
    <div className="mx-auto min-h-[100dvh] max-w-2xl px-5 py-10 sm:px-8">
      <header className="flex items-baseline justify-between border-b border-stone-300 pb-4">
        <h1 className="font-serif text-2xl text-stone-900">Alexandria Admin</h1>
        <Link to="/" className="text-sm text-stone-600 underline">
          Library
        </Link>
      </header>

      <div className="pt-8">
        {signedIn ? (
          <>
            <UploadForm onSessionExpired={handleSessionExpired} />
            <button
              type="button"
              onClick={() => {
                clearToken();
                setSignedIn(false);
              }}
              className="mt-10 text-xs text-stone-500 underline"
            >
              Sign out
            </button>
          </>
        ) : (
          <LoginForm onSignedIn={() => setSignedIn(true)} />
        )}
      </div>
    </div>
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
    <form onSubmit={(event) => void submit(event)} className="max-w-sm space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-stone-800">
          Admin password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1.5 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </div>

      {error !== null && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || password === ""}
        className="w-full rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default AdminRoot;
