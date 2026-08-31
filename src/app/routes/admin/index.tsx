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
    <div className="min-h-[100dvh] bg-[#071e4a] px-5 py-6 text-[#071e4a] sm:px-8 sm:py-10">
      <div className="mx-auto max-w-3xl bg-[#f7f5ef] px-5 py-6 shadow-[14px_16px_32px_rgba(0,0,0,0.24)] sm:px-8 sm:py-9">
      <header className="flex items-baseline justify-between border-b-2 border-[#071e4a] pb-4">
        <h1 className="text-3xl font-black tracking-[-0.04em]">Alexandria Admin</h1>
        <Link to="/" className="text-sm font-bold text-[#27416c] underline decoration-[#f26b21] decoration-2 underline-offset-4">
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
              className="mt-10 text-xs font-semibold text-[#526889] underline"
            >
              Sign out
            </button>
          </>
        ) : (
          <LoginForm onSignedIn={() => setSignedIn(true)} />
        )}
      </div>
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
