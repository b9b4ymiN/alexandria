// Admin session storage and authenticated requests.
//
// Written by node G1.11.
//
// WHY sessionStorage AND NEVER A COOKIE
// The content origin and the app origin are two subdomains of
// `workers.dev`, which sits on the Public Suffix List. A cookie set by the
// content origin for `.vcp-scanner.workers.dev` would be sent to the app
// origin — so an uploaded document could plant a session for the Admin UI.
// `sessionStorage` is strictly origin-scoped and unreachable from the
// sandboxed frame, which is why SPEC.md §17 puts the token there and why
// IMPLEMENTATION_PLAN.md Architecture Constraint 2 forbids cookies outright.
// The token travels only in an Authorization header, never in a URL.

const TOKEN_KEY = "alexandria.admin.token";

export function readToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A browser with site data blocked cannot hold a session. The caller
    // still gets a usable token for the current page.
  }
}

export function clearToken(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("The admin session has expired.");
    this.name = "SessionExpiredError";
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/**
 * Performs an authenticated admin request.
 *
 * A 401 clears the stored token and raises SessionExpiredError so the
 * caller can return the operator to the login screen without losing what
 * they were doing.
 */
export async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken();
  const headers = new Headers(init.headers);
  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...init, headers });

  if (response.status === 401) {
    clearToken();
    throw new SessionExpiredError();
  }

  const envelope = (await response.json()) as Envelope<T>;
  if (!envelope.ok || envelope.data === undefined) {
    const error = envelope.error ?? { code: "UNKNOWN", message: "The request failed." };
    const failure = new Error(error.message) as Error & { code: string };
    failure.code = error.code;
    throw failure;
  }
  return envelope.data;
}

export async function login(password: string): Promise<void> {
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const envelope = (await response.json()) as Envelope<{ token: string }>;
  if (!envelope.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message ?? "Sign-in failed.");
  }
  storeToken(envelope.data.token);
}
