---
version: 1
slug: "src-app-routes-library-tsx"
primary_target: "src/app/routes/library.tsx"
related_targets: ["src/app/components/DocumentCard.tsx","src/app/features/browse/CategorySidebar.tsx","src/app/features/browse/TagExplorer.tsx","src/app/features/search/SearchBox.tsx","src/app/routes/reader.tsx","src/app/styles/app.css","index.html","public/manifest.webmanifest","public/sw.js"]
---

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
public API. Preserve route-level admin code splitting, the Reader's sandboxed
iframe, and the separate content origin. The PWA caches only the same-origin
application shell; it deliberately excludes untrusted content-origin HTML.

Large taxonomies must remain usable without rendering the entire index into the
page flow. Show a compact set of category routes and commonly used topics, then
let readers search the complete fetched index. The mobile category index opens
as a drawer; the desktop index stays beside the document stream.

## Chosen direction and memorable moment

**Civic Reading Index**: public-information wayfinding translated into an open
reading library. Ink-blue rules organize a mineral-white field; orange, mint,
and violet route markers make categories scannable. Search is the first large
interaction. The memorable moment is scanning a route on the left and seeing
the corresponding reading path appear in the document stream.

The installed PWA keeps a compact, safe-area-aware masthead. On mobile,
document rows remain dense index records: category and date establish context
before title and description, with one consistent arrow control opening the
source.

Approved composition: `.impeccable/mocks/library-comp-2.png` (delegated choice
recorded in its sidecar).

## Implementation inventory

| Ingredient | Medium | Commitment |
| --- | --- | --- |
| Masthead, search, routes, document stream | Semantic HTML + Tailwind | Thin ink rules, asymmetrical two-column desktop layout, single mobile flow |
| Category and topic indices | React + semantic controls | Bounded initial lists with local search over the complete public metadata response |
| Category markers | CSS geometry | 10px solid route nodes; never a decorative image |
| Document opening control and offline check | Inline SVG | Consistent stroked geometry, not Unicode icons |
| PWA launcher mark | Generated raster | `public/icons/alexandria-192.png` and `alexandria-512.png` |
| PWA shell | Manifest + service worker | Same-origin runtime cache with navigation fallback; no content-origin caching |
