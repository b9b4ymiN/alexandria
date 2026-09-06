// Shared admin sign-in for browser specs.
//
// WHY THIS EXISTS
// Node G1.6 rate-limits POST /api/admin/login to 10 attempts per 60 seconds
// per client IP, deliberately, as defence in depth around a single-password
// admin model. Every browser spec runs against one dev server from one IP,
// so specs that each sign in through the UI exhaust that budget: the admin
// specs alone attempt more than twenty logins inside a minute, and every
// login past the tenth returns 429. The symptom is confusing — a spec fails
// with "the upload form never appeared" rather than "you were rate limited"
// — which is exactly why it went unnoticed until the whole suite ran on a
// stable tree.
//
// The rate limiter is correct and must not be relaxed for tests. What is
// wrong is signing in through the UI in specs that are not testing sign-in.
// This helper obtains ONE token per worker process over the API and injects
// it into sessionStorage, so a spec exercises the screen it is actually
// about.
//
// SESSION STORAGE, NOT A COOKIE
// The token lives in sessionStorage because the content origin and the app
// origin are subdomains of workers.dev, a Public Suffix List entry: a cookie
// set by uploaded content would be sent to the app origin. That is why
// Playwright's `storageState` cannot be used here — it persists cookies and
// localStorage, neither of which this app uses for auth — and why the token
// is planted with an init script instead.
import type { Page } from "@playwright/test";

const TOKEN_KEY = "alexandria.admin.token";
const PASSWORD = "local-dev-password-not-a-real-secret";

/** One token per worker process, fetched on first use. */
let cachedToken: Promise<string> | null = null;

async function fetchToken(baseURL: string): Promise<string> {
  const response = await fetch(new URL("/api/admin/login", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });

  if (response.status === 429) {
    throw new Error(
      "Admin login was rate limited while preparing a browser spec. Another " +
        "suite is probably running against the same dev server; wait a minute " +
        "and retry. Do not relax the limiter to make tests pass.",
    );
  }

  const envelope = (await response.json()) as
    | { ok: true; data: { token: string } }
    | { ok: false; error: { code: string; message: string } };

  if (!envelope.ok) {
    throw new Error(`Admin login failed in test setup: ${envelope.error.code}`);
  }
  return envelope.data.token;
}

/**
 * Signs in without touching the login screen, then navigates to `path`.
 *
 * Use this in every spec EXCEPT the ones that are genuinely about
 * authentication — those must keep driving the real form, or the login
 * screen would lose its coverage entirely.
 */
export async function signInAs(page: Page, path: string, baseURL = "http://localhost:5173"): Promise<void> {
  cachedToken ??= fetchToken(baseURL);
  const token = await cachedToken;

  // addInitScript runs before any of the page's own scripts on every
  // navigation, so the session is present the first time the admin shell
  // reads it — no flash of the login screen, and no race.
  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value);
    },
    [TOKEN_KEY, token] as const,
  );

  await page.goto(path);
}

export { PASSWORD, TOKEN_KEY };
