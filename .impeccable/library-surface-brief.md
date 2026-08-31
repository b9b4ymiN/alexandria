# Library surface

## Scope and mode

Public Library home (`/`) in **Read** mode.

## Audience, job, and action

Public readers need to locate and open an original document without an account.
The primary actions are searching metadata, narrowing by a category route, and
opening a document. The route must never imply that document bodies are fetched
or indexed in the listing.

## Content and constraints

Use real titles, descriptions, category paths, tags, and update dates from the
public API. Preserve route-level admin code splitting and the separate,
sandboxed content origin. The PWA caches only the same-origin application
shell; it deliberately excludes untrusted content-origin HTML.

## Chosen direction and memorable moment

**Civic Reading Index**: public-information wayfinding translated into an open
reading library. Ink-blue rules organize a mineral-white field; orange, mint,
and violet route markers make categories scannable. Search is the first large
interaction. The memorable moment is scanning a route on the left and seeing
the corresponding reading path appear in the document stream.

Approved composition: `.impeccable/mocks/library-comp-2.png` (delegated choice
recorded in its sidecar).

## Implementation inventory

| Ingredient | Medium | Commitment |
| --- | --- | --- |
| Masthead, search, routes, document stream | Semantic HTML + Tailwind | Thin ink rules, asymmetrical two-column desktop layout, single mobile flow |
| Category markers | CSS geometry | 10px solid route nodes; never a decorative image |
| Document opening control and offline check | Inline SVG | Consistent stroked geometry, not Unicode icons |
| PWA launcher mark | Generated raster | `public/icons/alexandria-192.png` and `alexandria-512.png` |
| PWA shell | Manifest + service worker | Same-origin runtime cache with navigation fallback; no content-origin caching |
