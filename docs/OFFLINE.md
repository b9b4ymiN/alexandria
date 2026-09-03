# Offline Shell — Alexandria Phase 1

Written by node G2.7. Describes `public/sw.js` and `src/app/lib/pwa.ts`.
The behaviour here is proven by `tests/browser/pwa/*.spec.ts`, not merely
documented — if this file and the tests ever disagree, trust the tests.

---

## What is offline-capable

The **public library shell only**: the app's own HTML/CSS/JS bundle and the
web app manifest/icons. A reader who has visited once can reopen the app
offline and see the shell render.

Nothing else is offline-capable, deliberately:

- **`/api/*` is never cached.** Library and document metadata must stay
  fresh; a stale category tree or a stale document list is worse than a
  clear "you're offline" state. An `/api/*` request made while offline
  fails normally — it is never faked from cache.
- **The content origin (`alexandria-content.*`) is never cached.** Uploaded
  document bytes are served from a separate, sandboxed origin
  (AGENT.md §8, SPEC.md §16). Caching them here would let a reader see an
  old version of a document after a restore or update, which breaks the
  "the published version is what readers see" guarantee.
- **A request carrying an `Authorization` header bypasses the worker
  entirely.** An admin response can never be served from, or written to,
  the public cache.
- **The Admin surface has no offline story.** Admin work needs the
  network; this is an explicit non-goal (IMPLEMENTATION_PLAN.md Node
  G2.7, Out of Scope).

## Cache versioning

The cache is named `alexandria-public-shell-v2` (see `CACHE_NAME` in
`public/sw.js`). On `activate`, the worker deletes every cache under the
`alexandria-public-shell-` prefix that is not the current name. A redeploy
that bumps this name therefore leaves no reader stranded on an old bundle
talking to a newer API — the old cache is removed the next time the new
worker activates.

## Where this is proven

- `tests/browser/pwa/offline.spec.ts` — the shell boots offline after a
  first visit.
- `tests/browser/pwa/service-worker-boundaries.spec.ts` — the three
  exclusions above, the Reader rendering with the worker active, and the
  redeploy cache-versioning path.
