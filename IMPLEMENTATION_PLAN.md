# Implementation Plan — Alexandria Phase 1

## Metadata

```text
Project:      Alexandria
Plan Version: 1.0
Created:      2026-08-30
Planner:      Opus Graph Architect
Status:       EXECUTING
Approved By:  THP (Thitipat)
Approved At:  2026-08-30
```

---

## 1. Goal

Deliver **Alexandria Phase 1 complete** — a public HTML reading library that Admin and authorized Agents publish to, deployed and verified on Cloudflare, with Dria remaining an un-built future phase that the architecture can accept later without rework.

Execution strategy is **vertical slice first**: Milestone 1 produces a genuinely usable publish→read path on production, then Milestones 2–6 extend it to full Phase 1 scope without rewriting M1.

---

## 2. Scope

- Repo, toolchain, two-Worker Cloudflare architecture, D1 schema, R2 immutable storage
- Domain Services: Document, Version, Category, Tag, MetadataSearch
- Admin password auth, admin web upload, metadata review and override
- Public Library: browse, category browse, tag filter, metadata search, pagination
- Reader Shell with sandboxed iframe on a separate content origin
- Stable slug, immutable versions, append-only restore, guarded deletes
- Agent HTTP API and local stdio MCP server exposing exactly 9 tools
- Invariant/negative test suite, mobile verification, secret audit, production deploy, Phase 1 Release Gate

---

## 3. Non-Goals

Explicitly out of scope. Any node that begins implementing these must STOP and report.

| Non-Goal | Reason |
|---|---|
| Dria, Ask This Document, Summarize, Ask My Library, Recommendation | Phase 1.5 (AGENT.md §3, §19) |
| AI Search index, indexing-state columns, `src/dria/` scaffolding | Phase 1.5; no future-phase schema and no dead code (AGENT.md §3) |
| Workers AI, Agents SDK, Durable Objects | Phase 1.5 |
| Google Login, user accounts, community, likes, reading status, comments, social feed | Phase 2 (GOAL.md §9) |
| Web research, external MCP, deep research | Phase 3 |
| Cover images, screenshot generation, OG image extraction | AGENT.md §23 |
| HTML editor, ZIP/folder upload, local asset bundles, PDF/DOCX/Markdown ingestion | GOAL.md §4 |
| Full-text search of HTML body, embeddings in Library search | GOAL.md §6, AGENT.md §15 |
| GitHub Actions CI/CD | Deferred by explicit decision; `wrangler deploy` stays manual in Phase 1 |
| Custom domain | Account has zero zones; workers.dev hostnames used, swappable via configuration |
| Analytics product, billing | GOAL.md §9 |

---

## 4. Source-of-Truth References

```text
GOAL.md      §3 Phase 1 features, §4 document rules, §5 organization, §6 search,
             §7 reader, §8 security, §9 non-goals, §10 success criteria
SPEC.md      §2 architecture, §5 data model, §7 R2, §8 metadata, §9 create flow,
             §10 slug, §11 update, §12 restore, §13 delete, §14 library, §15 reader,
             §16 iframe, §17 auth, §18 API, §19 MCP, §24 errors, §25 mobile,
             §26 testing, §27 DoD, §28 fixture
TECHSTACK.md §2 stack, §5 router, §8 Hono, §9 Zod, §11 D1, §12 R2, §14 MCP,
             §19 domain layer, §21 testing, §22 performance, §25 version policy
AGENT.md     §5 invariants, §6 agent boundary, §7 HTML rules, §8 iframe security,
             §9 domain-first, §11 D1, §12 R2, §13 auth, §26 dependencies,
             §28 testing workflow, §29 negative tests, §30 Phase 1 DoD
```

---

## 5. Architecture Constraints

Non-negotiable. A node that cannot satisfy these must STOP and report rather than work around them.

1. **Two Workers, two origins.** `alexandria` serves the SPA and `/api/*`; `alexandria-content` serves uploaded HTML only. One Worker gets one workers.dev hostname, so separate origins require separate Workers.
2. **No cookies for authentication, ever.** workers.dev is on the Public Suffix List, so the content origin can set cookies scoped to `.vcp-scanner.workers.dev` that the browser would then send to the app origin. The Admin token lives in `sessionStorage` and travels only in an `Authorization` header.
3. **The Content Worker has a D1 binding, but its implementation is strictly read-only: no mutation routes and no INSERT/UPDATE/DELETE code paths.** A binding does not enforce read-only permission, so this is enforced by an automated source assertion.
4. **Uploaded bytes are never rewritten.** No CSS injection, no script rewriting, no Markdown conversion, no re-hosting of external assets.
5. **The iframe sandbox never gains `allow-same-origin`.**
6. **R2 objects are immutable**, keyed `documents/{document_id}/versions/{version_id}.html`. New bytes always mean a new version.
7. **Slug never changes automatically**, and no Admin or Agent route may change it.
8. **Business rules live in Domain Services.** Hono routes validate, authorize, delegate, and wrap the response. MCP duplicates no domain logic.
9. **Secrets are Worker secrets only.** Never in git, never `VITE_`-prefixed, never printed to chat, logs, iframe URLs, or MCP output.
10. **The Agent has no destructive capability at router level**, not merely at tool level.
11. **`version_no` is computed inside SQL**, never read-then-write in application code.
12. **No new runtime dependency** without first checking whether the Workers platform or an existing dependency already provides the capability.

---

## 6. Requirement Traceability

| Requirement | Source | Node(s) / Non-Goal | Verification |
|---|---|---|---|
| Public Library browse without login | GOAL §3 | G1.10, G2.6, G4.2 | Playwright anonymous browse |
| Metadata search over title/description/category/tags | GOAL §6, SPEC §14 | G4.1, G4.2 | Vitest query tests plus Playwright |
| No HTML body text search | GOAL §6 | G4.1 | Test asserts body bytes are never queried |
| Dynamic category tree, arbitrary depth | GOAL §5, SPEC §5 | G2.1, G2.5 | Recursive CTE tests, admin UI test |
| Category created by Admin with no code change | GOAL §10 | G2.1, G2.5 | Playwright creates a nested category |
| Tags, many per document | GOAL §5 | G2.2, G2.5 | Vitest link/unlink and merge tests |
| Admin password auth, 8 hour session | SPEC §17 | G1.6 | Token expiry and timing-safe tests |
| Admin web upload | GOAL §3 | G1.11 | Playwright upload of the fixture |
| Agent MCP upload | GOAL §3 | G5.2 | MCP protocol test |
| One `.html` per version, bytes preserved | GOAL §4, AGENT §7 | G1.4, G1.5 | sha256 of R2 object equals source file |
| Stable slug, never auto-changes | GOAL §4, SPEC §10 | G1.3, G2.3 | Negative test: move category, slug unchanged |
| Slug immutable through the API | SPEC §10 | G2.3 | `SLUG_IMMUTABLE` negative test |
| Immutable versions | GOAL §4, SPEC §11 | G1.5, G3.1 | R2 key uniqueness and no-overwrite test |
| `UNCHANGED` on identical bytes | SPEC §11 | G3.1 | Re-upload of the same file |
| Version history list and old-version preview | GOAL §3, SPEC §12 | G3.1, G3.4, G3.5 | API test plus Playwright preview |
| Restore is append-only | GOAL §4, SPEC §12 | G3.2 | Restore v2 over v4 creates v5 |
| Cannot delete the current version | SPEC §13 | G3.2 | `VERSION_IS_CURRENT` negative test |
| Cannot delete the last remaining version | SPEC §13 | G3.2 | `LAST_VERSION_CANNOT_DELETE` negative test |
| Delete document hard, R2 cleanup, orphan log | SPEC §13, decision D3 | G3.3 | Cascade test plus injected R2 failure log assertion |
| Reader Shell at `/docs/:slug` | SPEC §15 | G1.10 | Playwright |
| Isolated sandboxed iframe on a separate origin | GOAL §8, SPEC §16, AGENT §8 | G1.9, G1.10, G6.2 | Browser test: iframe cannot read admin session |
| External CSS, fonts, images and JS render | GOAL §4, SPEC §28 | G1.9, G1.12, G6.3 | Fixture renders Google Fonts and external image |
| Mobile 375 / 768 / 1440 | SPEC §25, AGENT §24 | G6.3, spot-checked in G1.12 | Playwright viewports plus one real device |
| R2 immutable key convention | SPEC §7, AGENT §12 | G1.5 | Key format assertion |
| R2/D1 compensation on partial failure | SPEC §9, AGENT §12 | G1.5 | Injected D1 failure test |
| Deterministic metadata extraction | SPEC §8 | G1.4 | Fallback-chain unit tests |
| Category must already exist for the Agent | SPEC §8, AGENT §32 | G5.1 | `CATEGORY_NOT_FOUND` negative test |
| Error envelope and error codes | SPEC §18, §24 | G1.2 | Type union plus route error tests |
| Public, Admin and Agent HTTP API surface | SPEC §18 | G1.7, G1.8, G2.1, G2.2, G2.4, G3.1–G3.4, G5.1 | Route inventory test |
| Agent auth via `Authorization: Bearer` | SPEC §18, correction 1 | G5.1 | Cross-token rejection tests |
| Exactly 9 MCP tools, 8 forbidden absent | SPEC §19, AGENT §6 | G5.2, G5.3 | Tool-list assertion test |
| Public cannot write | AGENT §29 | G6.1 | Negative suite |
| Invalid agent key cannot write | AGENT §29 | G6.1 | Negative suite |
| Agent cannot create category, delete, or restore | AGENT §29 | G5.1, G6.1 | Route and tool absence tests |
| Content iframe cannot access Admin session | AGENT §29 | G6.2 | Browser isolation test |
| Secrets absent from client bundle and repo | GOAL §10, AGENT §13 | G6.2 | Built-bundle scan and git history scan |
| Hono stays thin, domain owns logic | TECHSTACK §8, §19, AGENT §9, §10 | G6.1 | Route line-budget and layering review |
| No AI call on Library load, lazy admin chunk, paginated lists, no HTML body in list responses | TECHSTACK §22, AGENT §25 | G6.3 | Bundle and network assertions |
| Stack version families | TECHSTACK §2, §25 | G1.0 | Resolved versions recorded as node evidence |
| Cloudflare-first deployment | GOAL §3, TECHSTACK §10 | G1.12, G6.4 | Live URLs respond |
| Dria disabled does not break Reader | AGENT §29 | Non-Goal, Phase 1.5 | Dria not built; condition trivially holds |
| Dria document-scope retrieval grounding | AGENT §29 | Non-Goal, Phase 1.5 | Deferred to the Phase 1.5 plan |

---

## 7. Execution Graph

```text
M1 — VERTICAL SLICE
G1.0 Repo & Toolchain Scaffold
├── G1.1 D1 Schema, Migrations & Seed
└── G1.2 Shared Types, Error Model & API Skeleton
    ├── G1.3 Slug Service
    ├── G1.4 HTML Validation & Metadata Extraction
    └── G1.6 Admin Auth & Login Rate Limit
G1.1 + G1.3 + G1.4  ──> G1.5  Document Create & Version Write Path
G1.5 + G1.6         ──> G1.7  Admin API — Create Document
G1.5                ──> G1.8  Public API — List & Get Document
G1.1                ──> G1.9  Content Worker — Serve Current Version
G1.8                ──> G1.10 SPA Shell, Library List & Reader
G1.7 + G1.10        ──> G1.11 Admin UI — Login, Upload, Review, Publish
G1.9+G1.10+G1.11    ──> G1.12 M1 Deploy & Acceptance          [CHECKPOINT A]

M2 — CATEGORY TREE & TAGS                        (gated by CHECKPOINT A)
├── G2.1 Category Management (service + admin API)
└── G2.2 Tag Management (service + admin API)
G2.1                ──> G2.3 Document Metadata Update & Move
G2.1 + G2.2         ──> G2.4 Public API — Tree, Tags, Filters
G2.1 + G2.2 + G2.3  ──> G2.5 Admin UI — Categories, Tags, Edit Metadata
G2.4                ──> G2.6 Public UI — Category Browse & Tag Filter
                                                              [CHECKPOINT B]

M3 — VERSIONING                                  (gated by CHECKPOINT B)
G3.1 Update Document & Version History
├── G3.2 Restore & Version Delete Guards
│     └── G3.3 Delete Document & R2 Cleanup
└── G3.4 Signed Historical Preview URLs
G3.2 + G3.3 + G3.4  ──> G3.5 Admin UI — Version History      [CHECKPOINT C]

M4 — SEARCH                                      (gated by CHECKPOINT C)
G4.1 Metadata Search Service & Public Search API
└── G4.2 Library UI — Search, Pagination, Recently Updated   [CHECKPOINT D]

M5 — AGENT API & MCP                             (gated by CHECKPOINT D)
G5.1 Agent Auth & Agent API Routes
└── G5.2 MCP Server — Core & Write Tools
      └── G5.3 MCP Read Tools & Tool-Contract Suite          [CHECKPOINT E]

M6 — SECURITY, QA & RELEASE                      (gated by CHECKPOINT E)
├── G6.1 Invariant & Negative Test Suite
├── G6.2 Security Audit — Secrets, CORS, iframe Isolation
└── G6.3 Mobile & Performance Verification
G6.1 + G6.2 + G6.3  ──> G6.4 Production Release & Phase 1 Gate
                                                            [RELEASE GATE]
```

---

## 8. Critical Path

```text
G1.0 → G1.2 → G1.4 → G1.5 → G1.7 → G1.11 → G1.12
     → G2.1 → G2.3 → G2.5
     → G3.1 → G3.2 → G3.3 → G3.5
     → G4.1 → G4.2
     → G5.1 → G5.2 → G5.3
     → G6.1 → G6.4
```

Reasoning: every write path in the system funnels through `G1.5`, which owns document and version creation together with R2/D1 compensation. `G1.5` cannot start until `G1.4` defines what a valid document is and what metadata is extracted from it. `G1.4` rather than `G1.3` sits on the critical path because slug generation is pure and quickly testable, while extraction must run inside the Workers runtime on `HTMLRewriter` and carries the fixture-compatibility risk. From `G1.5` the chain is transport → admin UI → first real deployment.

M2 through M6 are gated milestone by milestone in the sequence the project owner specified (Category and Tags → Versioning → Search → MCP → QA), so from `CHECKPOINT A` onward the critical path follows each milestone's own longest chain.

---

## 9. Parallel Candidates

```text
G1.1 || G1.2
G1.3 || G1.4 || G1.6
G1.7 || G1.8 || G1.9
G2.1 || G2.2
G2.5 || G2.6
G3.2 || G3.4
G6.1 || G6.2 || G6.3
```

Why each pairing is safe:

- **G1.1 || G1.2** — `migrations/` versus `src/shared/` and `src/api/app.ts`. Disjoint files and no shared schema decision.
- **G1.3 || G1.4 || G1.6** — three separate modules under `src/domain/` and `src/api/middleware/`, each with its own test file, all depending only on the types frozen by `G1.2`.
- **G1.7 || G1.8 || G1.9** — safe **only because `G1.2` creates `src/api/app.ts` with empty public and admin routers already mounted**. `G1.7` writes `routes/admin/documents.ts`, `G1.8` writes `routes/public/documents.ts`, `G1.9` writes a different Worker entrypoint with its own wrangler config. No node in this set edits `app.ts`.
- **G2.1 || G2.2** — `CategoryService` with `routes/admin/categories.ts` versus `TagService` with `routes/admin/tags.ts`. Each mounts itself into the admin router through its own file.
- **G2.5 || G2.6** — admin surface under `src/app/routes/admin/` versus public surface under `src/app/routes/`. Shared layout files are not modified by either node.
- **G3.2 || G3.4** — version guards live in `VersionService` and admin routes; signed-URL work lives in `src/shared/signing.ts` and the content Worker.
- **G6.1 || G6.2 || G6.3** — three distinct test suites; none is expected to modify production source. Any node that must change production code stops and reports so the change is reviewed once, serially.

Conflict analysis:

- **Migrations never run in parallel.** Only `G1.1` creates the base migration. If `G2.1` or `G2.2` need an added index they must be serialized against each other, and the orchestrator assigns migration numbers.
- **`src/api/app.ts` is written by `G1.2` and by no one else.** Any later node needing to change it must STOP and report a plan bug.
- **Binding additions to `wrangler.jsonc`** (D1 in `G1.1`, R2 in `G1.5`, rate limiter in `G1.6`) are serialized by the dependency chain; no two parallel nodes add a binding at the same time.
- **Admin UI nodes are never parallel with each other** because they share routing and layout files.
- **`G1.12` is never parallel with anything.** It touches live Cloudflare resources.

---

## 10. High-Risk Nodes

| Node | Risk | Why | Extra Verification |
|---|---|---|---|
| G1.5 Document create and version write | High | R2 and D1 are not one transaction; a partial failure corrupts the library. Also owns the immutability invariant. | Injected D1 failure triggers R2 cleanup; injected R2 failure leaves zero D1 rows; concurrent create does not duplicate `version_no`; R2 object sha256 equals source bytes |
| G1.6 Admin auth | High | One password, no second factor, no recovery. Token forgery or a timing leak compromises every write path. | Timing-safe comparison test; tampered signature rejected; expired token rejected; payload substitution rejected; rate limiter reads only the trusted Cloudflare client IP |
| G1.9 Content Worker | High | Both the origin-isolation boundary and the read-only constraint live here. | Source assertion that no INSERT/UPDATE/DELETE appears anywhere in the content Worker; no admin or agent secret in its bindings; response header assertions; browser test proving the sandbox lacks `allow-same-origin` |
| G1.12 M1 deploy and acceptance | High | First contact with real Cloudflare resources, real R2 enablement, real remote migrations, and a real phone. | Live URL checks; remote migration status recorded; real-device read of the Mauboussin fixture; rollback note recorded before deploying |
| G2.1 Category management | High | A cycle or a non-empty deletion corrupts the tree and can orphan documents. | Cycle attempt rejected; self-parent rejected; move into own descendant rejected; delete of non-empty category rejected; sibling slug conflict rejected |
| G3.2 Restore and version delete | High | Append-only semantics and delete guards are core invariants that degrade silently when wrong. | Restore creates a new highest version carrying `restored_from_version_no`; the current pointer never moves backwards; current-version and last-version deletes rejected |
| G3.3 Delete document | High | Irreversible data loss plus R2 orphan handling. | Cascade verified; injected R2 delete failure still removes metadata and logs `document_id` with the failed keys; explicit confirmation required at API level |
| G3.4 Signed preview URLs | High | A weak signature exposes non-current versions publicly. | Expired signature rejected; tampered payload rejected; a signature issued for document A rejected on document B; signing secret never appears in a URL |
| G5.1 Agent API | High | This is the entire Agent permission boundary. | Router inventory contains no destructive agent route; an admin token is rejected on agent routes and an agent key is rejected on admin routes; agent cannot create a category; agent cannot alter a slug |
| G5.3 MCP tool contract | High | A convenience tool added later silently widens agent power. | The exposed tool list equals exactly the 9 allowed names; all 8 forbidden names absent; the test fails loudly if the set changes |

---

## 11. Checkpoints

### CHECKPOINT A — Vertical slice live

Required nodes:

```text
G1.0 G1.1 G1.2 G1.3 G1.4 G1.5 G1.6 G1.7 G1.8 G1.9 G1.10 G1.11 G1.12
```

Gate DoD:

- [ ] `mauboussin-expectations-investing-summary.html` uploaded through the deployed Admin UI
- [ ] Document reachable at a stable public URL without login, from a different device and network
- [ ] HTML renders byte-identical to the source, including Google Fonts, the external image, tables and SVG
- [ ] Reader usable on a real mobile phone, not only an emulated viewport
- [ ] `document_id`, `slug`, `version_id`, D1 metadata and the immutable R2 key all present and correct
- [ ] Content served from `alexandria-content.vcp-scanner.workers.dev`, app from `alexandria.vcp-scanner.workers.dev`
- [ ] Admin session token unreachable from inside the iframe
- [ ] No secret present in the built client bundle

### CHECKPOINT B — Organization complete

Required nodes: `G2.1 … G2.6`

- [ ] Nested categories created, renamed, moved and deleted from the Admin UI with no code change
- [ ] Cycle, self-parent and non-empty-delete attempts all rejected with the specified error codes
- [ ] Tags created, renamed, merged and unlinked
- [ ] A document moved between categories keeps its slug and public URL
- [ ] Public category browse and tag filter work anonymously

### CHECKPOINT C — Versioning complete

Required nodes: `G3.1 … G3.5`

- [ ] Re-upload of identical bytes returns `UNCHANGED` and creates no version
- [ ] A modified upload creates a new immutable version and the public URL does not change
- [ ] Version history lists every version with author, size and timestamp
- [ ] An old version is previewable by Admin only through a signed, expiring URL
- [ ] Restore appends a new highest version carrying `restored_from_version_no`
- [ ] Current-version and last-version deletions are rejected
- [ ] Document deletion cascades in D1 and best-effort cleans R2, logging any orphan keys

### CHECKPOINT D — Search complete

Required nodes: `G4.1 G4.2`

- [ ] Search returns correct results for Thai and English queries across title, description, category and tags
- [ ] Search and list responses never contain HTML body bytes
- [ ] Listing is paginated with a stable, documented ordering contract

### CHECKPOINT E — Agent integration complete

Required nodes: `G5.1 G5.2 G5.3`

- [ ] Agent API authenticates only with `Authorization: Bearer <AGENT_API_KEY>`
- [ ] MCP server exposes exactly the 9 allowed tools
- [ ] All 8 forbidden tool names are absent, asserted by test
- [ ] An Agent can publish and update a document end to end through MCP
- [ ] An Agent cannot create a category, delete anything, restore, or change a slug

### RELEASE GATE — Phase 1 complete

- [ ] Every SPEC.md §27 Phase 1 checkbox satisfied with evidence
- [ ] Every AGENT.md §29 negative test applicable to Phase 1 passing
- [ ] Full suite green: unit, Worker integration, browser, MCP
- [ ] Production build succeeds with no type errors and no lint errors
- [ ] 375 / 768 / 1440 verified plus one real mobile device
- [ ] No secret in repo, git history, client bundle, logs, iframe URL, or MCP output
- [ ] No Phase 1.5 or Phase 2 feature present anywhere in the codebase
- [ ] Both Workers deployed and healthy; remote migrations applied and recorded
- [ ] The §6 traceability table is fully satisfied or explicitly marked Non-Goal

---

## 12. Graph State Summary

| Node | Status | Depends On | Blocks | Parallel With |
|---|---|---|---|---|
| G1.0 | IN_PROGRESS | — | G1.1, G1.2 | — |
| G1.1 | BLOCKED | G1.0 | G1.5, G1.9 | G1.2 |
| G1.2 | BLOCKED | G1.0 | G1.3, G1.4, G1.6 | G1.1 |
| G1.3 | BLOCKED | G1.2 | G1.5 | G1.4, G1.6 |
| G1.4 | BLOCKED | G1.2 | G1.5 | G1.3, G1.6 |
| G1.5 | BLOCKED | G1.1, G1.3, G1.4 | G1.7, G1.8 | G1.6 |
| G1.6 | BLOCKED | G1.2 | G1.7 | G1.3, G1.4, G1.5 |
| G1.7 | BLOCKED | G1.5, G1.6 | G1.11 | G1.8, G1.9 |
| G1.8 | BLOCKED | G1.5 | G1.10 | G1.7, G1.9 |
| G1.9 | BLOCKED | G1.1 | G1.12 | G1.7, G1.8 |
| G1.10 | BLOCKED | G1.8 | G1.11, G1.12 | — |
| G1.11 | BLOCKED | G1.7, G1.10 | G1.12 | — |
| G1.12 | BLOCKED | G1.9, G1.10, G1.11 | CHECKPOINT A | — |
| G2.1 | BLOCKED | CHECKPOINT A | G2.3, G2.4, G2.5 | G2.2 |
| G2.2 | BLOCKED | CHECKPOINT A | G2.4, G2.5 | G2.1 |
| G2.3 | BLOCKED | G2.1 | G2.5 | — |
| G2.4 | BLOCKED | G2.1, G2.2 | G2.6 | G2.3 |
| G2.5 | BLOCKED | G2.1, G2.2, G2.3 | CHECKPOINT B | G2.6 |
| G2.6 | BLOCKED | G2.4 | CHECKPOINT B | G2.5 |
| G3.1 | BLOCKED | CHECKPOINT B | G3.2, G3.4 | — |
| G3.2 | BLOCKED | G3.1 | G3.3, G3.5 | G3.4 |
| G3.3 | BLOCKED | G3.2 | G3.5 | G3.4 |
| G3.4 | BLOCKED | G3.1 | G3.5 | G3.2, G3.3 |
| G3.5 | BLOCKED | G3.2, G3.3, G3.4 | CHECKPOINT C | — |
| G4.1 | BLOCKED | CHECKPOINT C | G4.2 | — |
| G4.2 | BLOCKED | G4.1 | CHECKPOINT D | — |
| G5.1 | BLOCKED | CHECKPOINT D | G5.2 | — |
| G5.2 | BLOCKED | G5.1 | G5.3 | — |
| G5.3 | BLOCKED | G5.2 | CHECKPOINT E | — |
| G6.1 | BLOCKED | CHECKPOINT E | G6.4 | G6.2, G6.3 |
| G6.2 | BLOCKED | CHECKPOINT E | G6.4 | G6.1, G6.3 |
| G6.3 | BLOCKED | CHECKPOINT E | G6.4 | G6.1, G6.2 |
| G6.4 | BLOCKED | G6.1, G6.2, G6.3 | RELEASE GATE | — |

Allowed states:

```text
BLOCKED
READY
IN_PROGRESS
REVIEW
DONE
FAILED
```

Total execution nodes: **33**

---

# Nodes

---

## Node G1.0 — Repo & Toolchain Scaffold

### Status

```text
IN_PROGRESS
```

### Goal

A running Alexandria skeleton: pnpm workspace, private GitHub repo, React SPA served by the app Worker, a second content Worker entrypoint, and green `typecheck` / `lint` / `test` / `build` commands.

### Why

Every later node needs a verified toolchain and the two-Worker layout. Getting the version families and the dual wrangler configuration wrong here would force a rebuild of everything downstream.

### Dependencies

```text
depends_on: —
blocks:     G1.1, G1.2
can_parallel_with: —
```

### Scope

- `git init`, `.gitignore`, initial commit, private GitHub repo `alexandria` under account `b9b4ymiN`, first push
- `pnpm-workspace.yaml` listing the root package and `mcp` (the `mcp` directory itself is created later by G5.2)
- Install and pin: React 19.2.x, Vite 8.2.x, React Router 8.3.x, Tailwind CSS 4.3.x, TypeScript 6.0.x, Hono, Zod, `@cloudflare/vite-plugin`, Wrangler (upgrade to current 4.x), Vitest, `@cloudflare/vitest-pool-workers`, Playwright
- Directory skeleton per SPEC §4: `src/app/`, `src/api/`, `src/domain/`, `src/content/`, `src/shared/`, `migrations/`, `tests/{unit,integration,browser}/`
- `wrangler.jsonc` (app Worker `alexandria`, SPA assets) and `wrangler.content.jsonc` (content Worker `alexandria-content`)
- `tsconfig.json` with `strict: true`, `module: ESNext`, `moduleResolution: Bundler`, separate browser and Worker type environments
- Tailwind 4 CSS-first configuration for the app shell only
- npm scripts: `dev`, `dev:content`, `build`, `typecheck`, `lint`, `test`, `test:browser`, `db:migrate:local`, `db:migrate:remote`
- One smoke test per layer so the test commands are meaningful rather than vacuous

### Out of Scope

- Any domain logic, route, table, or UI beyond a placeholder page
- D1 or R2 bindings (added by G1.1 and G1.5)
- Any deployment to Cloudflare
- GitHub Actions

### Read First

- `TECHSTACK.md` §2, §4, §5, §6, §7, §10, §20, §21, §25
- `SPEC.md` §4
- `AGENT.md` §4, §26, §27

### Files

Create:

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.gitignore`, `.npmrc`
- `tsconfig.json`, `tsconfig.worker.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`
- `wrangler.jsonc`, `wrangler.content.jsonc`
- `index.html`, `src/app/main.tsx`, `src/app/routes/root.tsx`, `src/app/styles/app.css`
- `src/index.ts` (app Worker entry), `src/content/index.ts` (content Worker entry, placeholder response)
- `tests/unit/smoke.test.ts`

Modify: none

Read: `START_HERE.md`, `TECHSTACK.md`

### Interfaces / Contracts

Produces:

```text
pnpm scripts: dev, dev:content, build, typecheck, lint, test, test:browser
Worker entry: src/index.ts          (app)
Worker entry: src/content/index.ts  (content)
Config:       wrangler.jsonc, wrangler.content.jsonc
```

Must not change: nothing yet.

### Implementation Requirements

1. Resolve each pinned family from the npm registry at install time and record the exact resolved versions in this node's Evidence. If a required family is unpublished or incompatible, STOP and report rather than substituting a different major version.
2. `.gitignore` must exclude `node_modules`, `dist`, `.wrangler`, `.dev.vars`, `*.local`, Playwright artifacts.
3. No secret, token, account ID, or `.dev.vars` file is committed. `.dev.vars.example` may be committed with empty values.
4. The two wrangler configs are separate files deployed with `-c`; do not use wrangler environments to fake a second Worker.
5. `compatibility_date` is set to the current date in both configs and `nodejs_compat` is enabled only if a dependency actually requires it.
6. The content Worker entry returns a placeholder 404 for now and declares no D1, R2, or secret binding yet.
7. Tailwind is wired into the app shell only. No Tailwind or app CSS may ever reach uploaded HTML.
8. Commit and push to the private GitHub repo, on a branch, not directly on `main` if `main` is protected.

### Edge Cases

- A pinned family is not yet published → STOP, report, do not silently downgrade
- Vite 8 plus Cloudflare plugin requiring a newer Wrangler than installed → upgrade Wrangler, record the version
- Windows path or line-ending issues → set `.gitattributes` to normalize `LF` for source files
- `pnpm` workspace warning about the missing `mcp` directory → acceptable, must not fail installation

### Tests Required

Positive:

- `tests/unit/smoke.test.ts` asserts the shared module graph loads and TypeScript strict mode is active

Negative:

- none applicable at this node

Regression:

- none applicable at this node

### Verification Commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec wrangler --version
git log --oneline -1 && git remote -v
```

Expected:

```text
exit 0 for every command
build emits SPA assets plus a Worker bundle
remote points at the private GitHub repo alexandria under b9b4ymiN
```

### Definition of Done

- [ ] `pnpm install`, `typecheck`, `lint`, `test`, `build` all exit 0
- [ ] Resolved versions of React, Vite, React Router, Tailwind, TypeScript, Wrangler recorded in Evidence
- [ ] `wrangler.jsonc` and `wrangler.content.jsonc` both present, naming Workers `alexandria` and `alexandria-content`
- [ ] Directory skeleton matches SPEC §4
- [ ] Private GitHub repo `alexandria` exists under `b9b4ymiN` and the initial commit is pushed
- [ ] No secret and no `.dev.vars` in git history
- [ ] No dependency added beyond the approved list

### Stop Conditions

- A pinned version family is unavailable or mutually incompatible
- The Cloudflare Vite plugin cannot serve the SPA and the Worker together
- GitHub repo creation fails or the account has no permission
- Any requirement would force a change to `TECHSTACK.md`

### Suggested Commit

```text
chore(scaffold): initialize alexandria workspace, workers and toolchain
```

### Evidence

> Executor fills, Opus verifies

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.1 — D1 Schema, Migrations & Seed

### Status

```text
BLOCKED
```

### Goal

The complete Phase 1 relational model exists as versioned migrations, applies cleanly to a local D1 database, enforces every documented constraint, and ships four initial categories as data.

### Why

Every domain service reads and writes this schema. Constraints that are missing here become application-level bugs that no amount of service code can fully prevent.

### Dependencies

```text
depends_on: G1.0
blocks:     G1.5, G1.9
can_parallel_with: G1.2
```

### Scope

- `migrations/0001_init.sql` creating `categories`, `documents`, `document_versions`, `tags`, `document_tags` exactly as specified in SPEC §5
- Supporting indexes for the queries this plan actually issues
- A partial unique index closing the root-category slug hole described below
- `migrations/0002_seed_categories.sql` inserting `Stocks`, `Books`, `Research`, `Uncategorized` as ordinary rows
- D1 binding `DB` added to `wrangler.jsonc`
- Migration scripts for local and remote application
- Schema tests running against a real local D1 through `@cloudflare/vitest-pool-workers`

### Out of Scope

- Any domain service or query helper
- Any Phase 1.5 column such as indexing state
- Remote (production) migration application, which belongs to G1.12
- Category or tag business logic

### Read First

- `SPEC.md` §5, §7
- `AGENT.md` §11, §12
- `TECHSTACK.md` §11
- `wrangler.jsonc`

### Files

Create:

- `migrations/0001_init.sql`
- `migrations/0002_seed_categories.sql`
- `tests/integration/schema.test.ts`

Modify:

- `wrangler.jsonc` (add the D1 binding)
- `package.json` (migration scripts)

Read: `SPEC.md`

### Interfaces / Contracts

Produces:

```text
D1 binding name: DB
Tables: categories, documents, document_versions, tags, document_tags
Seed categories: Stocks, Books, Research, Uncategorized (ordinary rows, no reserved ids)
```

Must not change:

```text
Column names and types given in SPEC §5
```

### Implementation Requirements

1. Reproduce the SPEC §5 DDL exactly. Do not add, rename, or retype a column.
2. Add these indexes: `documents(category_id)`, `documents(updated_at DESC)`, `document_versions(document_id, version_no DESC)`, `document_tags(tag_id)`.
3. **Close the root-slug hole.** SQLite treats `NULL` as distinct in a `UNIQUE` constraint, so `UNIQUE (parent_id, slug)` does not prevent two root categories sharing a slug. Add `CREATE UNIQUE INDEX ux_categories_root_slug ON categories(slug) WHERE parent_id IS NULL;`. This is an additive index, not a change to the specified table definition.
4. Seed rows use generated ids with no special meaning; no application code may reference a seed category by name or id.
5. Timestamps are ISO-8601 UTC strings written by the application, not SQLite defaults, so that every writer is consistent.
6. Verify foreign key enforcement is actually active in the D1 test environment and assert it rather than assuming it.

### Edge Cases

- Two root categories with the same slug → rejected by the partial unique index
- Two sibling categories under the same parent with the same slug → rejected by `UNIQUE (parent_id, slug)`
- Deleting a category that still has children → rejected by `ON DELETE RESTRICT`
- Deleting a category that still has documents → rejected by `ON DELETE RESTRICT`
- Deleting a document → its versions and tag links cascade away
- Two versions claiming the same `version_no` for one document → rejected by `UNIQUE (document_id, version_no)`
- Two versions sharing an `r2_key` → rejected by `UNIQUE`
- `created_by` outside `('admin','agent')` → rejected by the CHECK constraint

### Tests Required

Positive:

- All five tables exist with the specified columns
- The four seed categories exist and are ordinary, deletable rows
- Inserting a valid document, version and tag link succeeds

Negative:

- Duplicate root slug rejected
- Duplicate sibling slug rejected
- Category delete with a child rejected
- Category delete with a document rejected
- Duplicate `version_no` rejected
- Duplicate `r2_key` rejected
- Invalid `created_by` rejected
- Document referencing a non-existent category rejected

Regression:

- Applying all migrations twice is a no-op, not an error

### Verification Commands

```bash
pnpm db:migrate:local
pnpm test -- tests/integration/schema.test.ts
pnpm exec wrangler d1 migrations list alexandria-db --local
```

Expected:

```text
exit 0
all schema tests pass, including every negative constraint test
migrations list shows 0001 and 0002 applied
```

### Definition of Done

- [ ] Migrations apply cleanly to a fresh local D1
- [ ] Schema matches SPEC §5 column for column
- [ ] All eight negative constraint tests pass
- [ ] Root-slug partial unique index present and proven by test
- [ ] Seed categories present with no reserved identifiers
- [ ] D1 binding `DB` declared in `wrangler.jsonc`
- [ ] No Phase 1.5 column present

### Stop Conditions

- D1 rejects a constraint the SPEC requires
- Foreign keys cannot be enforced in the D1 test environment
- A required query would need a schema change beyond an added index

### Suggested Commit

```text
feat(db): add phase 1 schema, indexes and category seed migrations
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.2 — Shared Types, Error Model & API Skeleton

### Status

```text
BLOCKED
```

### Goal

One canonical error vocabulary, one response envelope, and a Hono application skeleton whose route files can be written independently and in parallel by later nodes.

### Why

This node exists specifically so that `G1.7`, `G1.8` and `G5.1` never have to edit the same file. It also prevents three different error shapes from appearing across API, MCP and UI.

### Dependencies

```text
depends_on: G1.0
blocks:     G1.3, G1.4, G1.6
can_parallel_with: G1.1
```

### Scope

- `ErrorCode` union covering every Phase 1 code in SPEC §24, excluding the `DRIA_*` and `AI_*` families
- `AppError` carrying a code, a human message and an optional detail payload
- Mapping from error code to HTTP status
- `ok(data)` and `fail(error)` envelope helpers producing exactly the SPEC §18 shapes
- Shared DTO types for document, version, category, tag and pagination
- `src/api/app.ts` mounting three empty routers at `/api/public`, `/api/admin`, `/api/agent`
- **The complete Phase 1 routing skeleton**: each of the three routers mounts a fixed set of empty per-domain route files, so that every later node writes only its own file and no two nodes ever edit a shared router. This is routing plumbing only — no handler, no feature, no future-phase surface
- Global error handler, JSON 404 handler, and a deliberate absence of any CORS middleware
- App Worker entry wiring static assets plus the Hono app

### Out of Scope

- Any actual route handler
- Any authentication logic
- Any domain service
- Any Dria or AI error code

### Read First

- `SPEC.md` §18, §24
- `TECHSTACK.md` §8, §9
- `AGENT.md` §10, §27

### Files

Create:

- `src/shared/errors.ts`, `src/shared/envelope.ts`, `src/shared/types.ts`
- `src/api/app.ts`
- `src/api/routes/public/index.ts` mounting empty `documents.ts`, `categories.ts`, `tags.ts`
- `src/api/routes/admin/index.ts` mounting empty `auth.ts`, `documents.ts`, `versions.ts`, `categories.ts`, `tags.ts`
- `src/api/routes/agent/index.ts` mounting empty `documents.ts`, `categories.ts`, `tags.ts`
- `tests/unit/errors.test.ts`, `tests/integration/app-skeleton.test.ts`

Modify:

- `src/index.ts`

Read: `SPEC.md`

### Interfaces / Contracts

Produces:

```ts
type ErrorCode = 'AUTH_REQUIRED' | 'AUTH_INVALID' | ... // Phase 1 codes only
class AppError extends Error { code: ErrorCode; status: number; detail?: unknown }
function ok<T>(data: T): Response
function fail(error: AppError): Response
const app: Hono<{ Bindings: Env }>
```

Must not change:

```text
The response envelope shape { ok, data } / { ok, error: { code, message } }
The mount points /api/public, /api/admin, /api/agent
src/api/app.ts and the three routes/*/index.ts files —
no later node may edit them; each later node writes only its own leaf route file
```

### Implementation Requirements

1. Every Phase 1 error code from SPEC §24 is present in the union; no `DRIA_*` or `AI_*` code is present.
2. The status mapping is explicit and total: auth codes to 401, permission and immutability codes to 403, not-found codes to 404, conflict codes to 409, validation codes to 400, size to 413, storage and database failures to 500.
3. The global error handler converts an `AppError` into the envelope, and converts any unexpected throw into a generic 500 with no internal detail leaked to the client while still logging the real cause server-side.
4. No CORS middleware is registered anywhere. If a future node believes it needs CORS it must STOP and report, because the content origin must never be trusted by the API.
5. The three routers are mounted but empty, and each mounts its fixed set of empty leaf route files. An unrouted path under any of them returns the JSON 404 envelope, not an HTML page.
6. Each leaf route file exports an empty Hono router and carries a header comment naming the node that owns it, so ownership is visible at the point of edit.
7. `Env` type declares the bindings that exist so far plus the secret names, typed but never read here.

### Edge Cases

- Unknown route under `/api/**` returns a JSON envelope, not the SPA shell
- Unknown route outside `/api/**` falls through to the SPA for client-side routing
- A thrown non-`AppError` never leaks a stack trace to the client
- A `Response` returned by a handler passes through the error middleware untouched

### Tests Required

Positive:

- Every `ErrorCode` maps to a status
- `ok()` and `fail()` produce the exact SPEC envelope shapes
- `/api/public/anything-unknown` returns a JSON 404 envelope

Negative:

- No `DRIA_*` or `AI_*` code exists in the union
- No CORS header is present on any API response
- An unexpected throw produces a 500 with no stack trace in the body

Regression:

- SPA routes still render for non-API paths

### Verification Commands

```bash
pnpm typecheck
pnpm test -- tests/unit/errors.test.ts tests/integration/app-skeleton.test.ts
```

Expected:

```text
exit 0, all assertions pass
```

### Definition of Done

- [ ] Phase 1 error codes complete and Phase 1.5 codes absent, asserted by test
- [ ] Envelope helpers match SPEC §18 exactly
- [ ] Three routers mounted, each mounting its fixed set of empty leaf route files with ownership comments; JSON 404 proven
- [ ] No CORS middleware anywhere, asserted by test
- [ ] Unexpected errors do not leak internals
- [ ] `src/api/app.ts` documented in-file as single-writer

### Stop Conditions

- SPEC §24 and SPEC §18 conflict in a way that cannot be resolved by reading
- A binding or secret name in the `Env` type contradicts `AGENT.md` §13

### Suggested Commit

```text
feat(api): add error model, response envelope and hono app skeleton
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.3 — Slug Service

### Status

```text
BLOCKED
```

### Goal

Deterministic, collision-free slug generation and validation that satisfies the SPEC §10 pattern and never changes an existing slug.

### Why

The slug is the permanent public identity of a document. A slug that can drift or collide breaks every shared link, which is the single promise Alexandria makes to readers.

### Dependencies

```text
depends_on: G1.2
blocks:     G1.5
can_parallel_with: G1.4, G1.6
```

### Scope

- `generateSlug(input)` implementing the SPEC §10 fallback chain: title, then filename, then `doc-{shortId}`
- `isValidSlug(value)` enforcing `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- `resolveCollision(base, exists)` producing `base`, `base-2`, `base-3`, … using an injected existence predicate so the service stays pure and independently testable
- Unicode handling: strip diacritics, lowercase, replace runs of non-alphanumeric characters with a single hyphen, trim leading and trailing hyphens

### Out of Scope

- Any database access (the existence predicate is injected)
- Any transliteration library or new dependency
- Any route or UI

### Read First

- `SPEC.md` §10
- `GOAL.md` §4
- `AGENT.md` §5

### Files

Create:

- `src/domain/documents/slug.ts`
- `tests/unit/slug.test.ts`

Modify: none

Read: `src/shared/errors.ts`

### Interfaces / Contracts

Produces:

```ts
function generateSlug(input: { title?: string; filename?: string; documentId: string }): string
function isValidSlug(value: string): boolean
async function resolveCollision(base: string, exists: (s: string) => Promise<boolean>): Promise<string>
```

Must not change:

```text
The SPEC §10 slug pattern
```

### Implementation Requirements

1. Latin titles produce a readable slug: `Expectations Investing` becomes `expectations-investing`.
2. A title with no usable Latin characters — a purely Thai title, for example — yields an empty candidate and must fall through to the filename, then to `doc-{shortId}`. Do not transliterate Thai, and do not add a dependency to attempt it.
3. `shortId` is derived from the already-generated `document_id`, so the same document always produces the same fallback slug.
4. Cap slug length at 80 characters, trimming at a hyphen boundary so the result never ends with a hyphen.
5. Collision suffixes start at `-2` and increment; the loop is bounded and raises `SLUG_CONFLICT` after 50 attempts rather than looping forever.
6. The service never mutates or regenerates a slug for an existing document. There is no code path from metadata update to slug change.

### Edge Cases

- Title is only punctuation or emoji → falls through to filename
- Title and filename both unusable → `doc-{shortId}`
- Title with leading, trailing or repeated separators → collapsed cleanly
- Title longer than 80 characters → truncated at a hyphen boundary
- Filename with uppercase or spaces → normalized
- Candidate already taken 3 times → returns `base-4`
- Candidate equal to an existing slug of the same document → still treated as a collision because create always makes a new document

### Tests Required

Positive:

- Latin title, mixed case, punctuation, accents
- Filename fallback when the title yields nothing
- `doc-{shortId}` fallback when both yield nothing
- Collision chain `base` → `base-2` → `base-3`
- Length truncation never leaves a trailing hyphen

Negative:

- Every generated slug satisfies `isValidSlug`
- `isValidSlug` rejects uppercase, leading hyphen, trailing hyphen, double hyphen, empty string, and non-ASCII input
- Collision resolution raises `SLUG_CONFLICT` when exhausted

Regression:

- Generation is deterministic: the same input yields the same output across 100 runs

### Verification Commands

```bash
pnpm test -- tests/unit/slug.test.ts
pnpm typecheck
```

Expected:

```text
exit 0, all slug tests pass
```

### Definition of Done

- [ ] Fallback chain implemented exactly as SPEC §10 describes
- [ ] Thai-only title case proven to fall through, with a test
- [ ] Every generated slug validates against the SPEC pattern
- [ ] Collision resolution bounded and tested
- [ ] No new dependency added
- [ ] No code path exists that changes an existing document's slug

### Stop Conditions

- SPEC §10 is ambiguous about a case encountered in practice
- A readable slug would require adding a transliteration dependency

### Suggested Commit

```text
feat(domain): add deterministic slug generation and validation
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.4 — HTML Validation & Metadata Extraction

### Status

```text
BLOCKED
```

### Goal

Deterministic server-side validation of an uploaded `.html` file and deterministic extraction of title, description and suggested tags using the Workers-native `HTMLRewriter`, without modifying a single byte of the document.

### Why

This node defines what Alexandria will accept and what it claims a document is about. It is also the guard that keeps uploaded bytes untouched, which AGENT.md §7 treats as an invariant.

### Dependencies

```text
depends_on: G1.2
blocks:     G1.5
can_parallel_with: G1.3, G1.6
```

### Scope

- `validateHtmlUpload(file, limits)` returning a typed result or raising the correct `AppError`
- `extractMetadata(bytes, filename)` returning `{ title, description, keywords }`
- Streaming implementation on `HTMLRewriter`, no DOM library, no new dependency
- Configurable maximum upload size, defaulting to 20 MiB, read from the environment

### Out of Scope

- Writing anything to R2 or D1
- Slug generation
- Any rewriting, sanitizing, prettifying or re-encoding of the uploaded bytes
- Client-side extraction, which belongs to G1.11

### Read First

- `SPEC.md` §7, §8, §24, §28
- `AGENT.md` §7, §14, §26
- `mauboussin-expectations-investing-summary.html`

### Files

Create:

- `src/domain/documents/html-validation.ts`
- `src/domain/documents/metadata.ts`
- `tests/integration/html-metadata.test.ts`
- `tests/fixtures/` with small purpose-built HTML fixtures

Modify: none

Read: `src/shared/errors.ts`

### Interfaces / Contracts

Produces:

```ts
interface UploadLimits { maxBytes: number }
interface ExtractedMetadata { title: string; description: string; keywords: string[] }
function validateHtmlUpload(input: { filename: string; bytes: ArrayBuffer }, limits: UploadLimits): void
async function extractMetadata(bytes: ArrayBuffer, filename: string): Promise<ExtractedMetadata>
```

Must not change:

```text
The uploaded bytes — extraction reads a copy and never emits a transformed document
```

### Implementation Requirements

1. Validation is exactly this deterministic chain, in order, each failure raising its own code:
   - filename ends with `.html` → otherwise `INVALID_FILE_EXTENSION`
   - byte length greater than zero → otherwise `FILE_REQUIRED`
   - byte length at most `maxBytes` (default 20 MiB, environment-configurable) → otherwise `FILE_TOO_LARGE`
   - bytes decode as UTF-8 with `fatal: true` → otherwise `INVALID_HTML`
   - a structural marker appears within the **first 64 KiB**: `<!doctype html`, `<html`, or `<body`, matched case-insensitively → otherwise `INVALID_HTML`
   - an `HTMLRewriter` pass over the document completes without throwing → otherwise `INVALID_HTML`
2. Title fallback chain: first non-empty `<title>` text, then the first `<h1>` whose trimmed text is non-empty, then the filename with its extension removed.
3. Description fallback chain: `meta[name="description"]`, then `meta[property="og:description"]`, then the first `<p>` whose trimmed text is at least 20 characters, truncated to 300 characters at a word boundary, then an empty string.
4. Keywords come from `meta[name="keywords"]`, split on commas, trimmed, empties dropped, de-duplicated case-insensitively, each capped at 50 characters, at most 20 returned.
5. Extraction is streaming so that a 20 MiB document never materializes as a parsed tree.
6. Extraction is total: it never throws for merely unusual markup; only a genuinely undecodable or unparseable document fails, and that failure happens in validation, not extraction.
7. Whitespace in extracted text is collapsed and trimmed; the stored value contains no leading, trailing or repeated whitespace.

### Edge Cases

- The Mauboussin fixture, containing inline CSS, media queries, tables, SVG, external Google Fonts, an external image and long-form Thai text
- Multiple `<title>` elements → first wins
- `<title>` present but whitespace-only → falls through to `<h1>`
- `<h1>` containing nested markup → text content only
- Missing `<head>` entirely
- Uppercase `<META NAME="DESCRIPTION">` → matched case-insensitively
- A `<p>` inside `<script>` or `<template>` → not treated as a description candidate
- Thai text with no spaces → truncation must not split a character
- A file with a `.html` name but binary content → `INVALID_HTML`
- A file exactly at the size limit → accepted; one byte over → `FILE_TOO_LARGE`
- A structural marker appearing only after 64 KiB of comments → `INVALID_HTML`, documented as intentional

### Tests Required

Positive:

- Each fallback level of the title chain
- Each fallback level of the description chain
- Keyword parsing, de-duplication and capping
- The Mauboussin fixture yields a sensible title and description
- A 20 MiB synthetic document extracts without exhausting memory

Negative:

- `.htm`, `.txt`, `.zip`, and extensionless names rejected with `INVALID_FILE_EXTENSION`
- Empty file rejected with `FILE_REQUIRED`
- Oversized file rejected with `FILE_TOO_LARGE`
- Invalid UTF-8 rejected with `INVALID_HTML`
- Plain text with no structural marker rejected with `INVALID_HTML`
- Marker beyond 64 KiB rejected with `INVALID_HTML`

Regression:

- The bytes handed to extraction are byte-identical afterwards, asserted by sha256 before and after

### Verification Commands

```bash
pnpm test -- tests/integration/html-metadata.test.ts
pnpm typecheck
```

Expected:

```text
exit 0
sha256 of the fixture is identical before and after extraction
```

### Definition of Done

- [ ] The full validation chain implemented in the specified order with the specified codes
- [ ] Structural-marker window is 64 KiB, not 4 KiB
- [ ] Both fallback chains implemented per SPEC §8 and covered test by test
- [ ] Extraction is streaming and handles a 20 MiB document
- [ ] Byte-preservation proven by a sha256 before-and-after assertion
- [ ] `HTMLRewriter` used; no HTML parsing dependency added
- [ ] The Mauboussin fixture passes validation and yields usable metadata

### Stop Conditions

- `HTMLRewriter` cannot express one of the required extractions
- The fixture fails validation for a reason the SPEC does not anticipate
- Extraction would require buffering the whole document as a tree

### Suggested Commit

```text
feat(domain): add html upload validation and deterministic metadata extraction
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.5 — Document Create & Version Write Path

### Status

```text
BLOCKED
```

### Goal

`DocumentService.create` and `VersionService.appendVersion` write an immutable HTML object to R2 and a consistent metadata record to D1, with correct compensation when the two storage systems disagree.

### Why

This is the heart of Alexandria and the highest-risk node in the plan. R2 and D1 cannot share a transaction, so the failure behaviour must be designed rather than discovered. Every later write path — update, restore, agent upload — reuses `appendVersion`.

### Dependencies

```text
depends_on: G1.1, G1.3, G1.4
blocks:     G1.7, G1.8
can_parallel_with: G1.6
```

### Scope

- `DocumentService.create` covering the SPEC §9 flow end to end
- `VersionService.appendVersion` as the single reusable version-writing primitive
- SHA-256 content hashing via WebCrypto
- Immutable R2 key construction
- Atomic D1 batch for document, version, current-version pointer and tag links
- Best-effort R2 compensation when the D1 batch fails, with structured logging
- Minimal tag normalization and upsert needed by the create flow
- R2 binding `DOCS` added to `wrangler.jsonc`

### Out of Scope

- Updating an existing document, restore, or any delete — those are M3
- Category management — the service only validates that a category id exists
- Full `TagService` behaviour such as rename and merge — that is G2.2
- HTTP routing and authentication

### Read First

- `SPEC.md` §7, §9, §11 (only the parts describing version creation), §24
- `AGENT.md` §5, §7, §9, §12, §32
- `src/domain/documents/slug.ts`, `src/domain/documents/metadata.ts`, `migrations/0001_init.sql`

### Files

Create:

- `src/domain/documents/document-service.ts`
- `src/domain/versions/version-service.ts`
- `src/domain/versions/r2-keys.ts`
- `src/domain/versions/hash.ts`
- `src/domain/tags/normalize.ts`
- `src/domain/tags/tag-write.ts`
- `tests/integration/document-create.test.ts`
- `tests/integration/write-compensation.test.ts`

Modify:

- `wrangler.jsonc` (add the R2 binding)

Read: `src/shared/errors.ts`, `src/shared/types.ts`

### Interfaces / Contracts

Produces:

```ts
interface CreateDocumentInput {
  bytes: ArrayBuffer
  filename: string
  categoryId: string
  createdBy: 'admin' | 'agent'
  overrides?: { title?: string; description?: string; tags?: string[] }
  note?: string
}
interface CreateDocumentResult {
  documentId: string; slug: string; versionId: string; versionNo: number
  title: string; description: string; tags: string[]
}
DocumentService.create(input): Promise<CreateDocumentResult>
VersionService.appendVersion(input): Promise<{ versionId: string; versionNo: number; unchanged: boolean }>
function buildR2Key(documentId: string, versionId: string): string
function sha256Hex(bytes: ArrayBuffer): Promise<string>
function normalizeTagName(raw: string): string
```

Must not change:

```text
The R2 key convention documents/{document_id}/versions/{version_id}.html
The uploaded bytes
The SPEC §5 schema
```

### Implementation Requirements

1. Identifiers are generated before any write: `document_id` and `version_id` come from `crypto.randomUUID()`, so the R2 key is known before the object is stored.
2. Order of operations is strictly: validate, extract, resolve category, resolve slug, hash, **write R2 first, then D1**. A failed R2 write must leave zero D1 rows.
3. The D1 batch is a single `db.batch()` containing: insert document with a null current version, insert version, update the document's `current_version_id` and `updated_at`, upsert tags, insert tag links.
4. `version_no` is computed inside SQL — `SELECT COALESCE(MAX(version_no), 0) + 1 FROM document_versions WHERE document_id = ?` — inside the insert statement. Never read the maximum into application code and write it back.
5. If the D1 batch throws, delete the R2 object best-effort. If that delete also fails, log `document_id`, `version_id` and the R2 key in a single structured line and still return `DATABASE_ERROR`. An orphan object is acceptable; inconsistent metadata is not.
6. A non-existent `categoryId` raises `CATEGORY_NOT_FOUND` before anything is written. The service never creates a category.
7. Metadata precedence: explicit overrides win over extracted values; extraction wins over defaults. An override of empty string for description is honoured as an intentional empty description, while an absent override falls through to extraction.
8. Tag names are normalized by trimming, collapsing internal whitespace and lower-casing into `normalized_name`, while `name` preserves the caller's original casing. Existing tags are reused by `normalized_name`, never duplicated.
9. `appendVersion` returns `unchanged: true` without writing anything when the incoming sha256 equals the document's current version hash. `create` never returns unchanged because it always makes a new document.
10. The R2 object is written with `httpMetadata.contentType = 'text/html; charset=utf-8'` and a custom metadata field carrying the sha256. The bytes themselves are written exactly as received.
11. Slug collisions are resolved through `resolveCollision`. If the D1 insert still fails on the slug unique constraint because of a concurrent writer, retry the whole slug resolution once, then raise `SLUG_CONFLICT`.

### Edge Cases

- Category id does not exist → `CATEGORY_NOT_FOUND`, nothing written anywhere
- R2 write fails → no D1 rows, error surfaced as `R2_WRITE_FAILED`
- D1 batch fails → R2 object deleted, error surfaced as `DATABASE_ERROR`
- Both the D1 batch and the compensating R2 delete fail → orphan logged with ids, `DATABASE_ERROR` returned
- Two documents created concurrently from the same title → distinct slugs, no unique-constraint crash surfaced to the caller
- The same tag supplied twice with different casing → one tag row, one link
- Twenty tags supplied → all linked; duplicates collapsed
- Empty tag list → document created with no tag links
- A 20 MiB document → hashing and upload complete within Worker limits
- Title override provided but empty string → treated as absent, extraction used, because a document must always have a non-empty title

### Tests Required

Positive:

- Create from the Mauboussin fixture produces a document, a version numbered 1, a current-version pointer, and an R2 object at the specified key
- The stored R2 object's sha256 equals the source file's sha256
- Overrides beat extracted metadata
- Tags are normalized, de-duplicated and linked
- Two documents with the same title receive `slug` and `slug-2`

Negative:

- Non-existent category rejected with `CATEGORY_NOT_FOUND` and no writes
- Injected R2 failure leaves zero rows in `documents` and `document_versions`
- Injected D1 failure removes the R2 object and returns `DATABASE_ERROR`
- Injected D1 failure combined with an injected R2 delete failure logs the orphan key and still returns `DATABASE_ERROR`
- Attempting to write a second object to an existing R2 key never happens, asserted by key uniqueness across 50 sequential creates

Regression:

- The R2 key always matches `documents/{uuid}/versions/{uuid}.html`
- `version_no` is 1 for a first version, computed by SQL, verified by a concurrent double-create against one document id

### Verification Commands

```bash
pnpm test -- tests/integration/document-create.test.ts tests/integration/write-compensation.test.ts
pnpm typecheck
```

Expected:

```text
exit 0
compensation tests demonstrate zero orphaned metadata in every injected-failure case
```

### Definition of Done

- [ ] Create writes R2 before D1 and never leaves metadata pointing at a missing object
- [ ] All five injected-failure scenarios pass
- [ ] `version_no` computed inside SQL, proven by a concurrency test
- [ ] Stored bytes byte-identical to the source, proven by sha256
- [ ] R2 key convention matches SPEC §7 exactly
- [ ] `CATEGORY_NOT_FOUND` raised before any write
- [ ] Orphan logging includes `document_id` and the failed R2 key
- [ ] `appendVersion` is reusable by update and restore without modification

### Stop Conditions

- D1 `batch()` does not provide the atomicity this design assumes
- The Workers runtime cannot hash or upload a 20 MiB body within limits
- Compensation cannot be tested because failures cannot be injected

### Suggested Commit

```text
feat(domain): add document creation and immutable version write path
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.6 — Admin Auth & Login Rate Limit

### Status

```text
BLOCKED
```

### Goal

Password login that issues a signed, expiring bearer token, a middleware that protects every admin route, and a rate limit on the login endpoint that uses only the trusted Cloudflare client IP.

### Why

A single password with no second factor and no recovery is the entire write-side security model in Phase 1. Token forgery, a timing leak, or an unthrottled login endpoint would compromise every document in the library.

### Dependencies

```text
depends_on: G1.2
blocks:     G1.7
can_parallel_with: G1.3, G1.4, G1.5
```

### Scope

- `POST /api/admin/login` and `POST /api/admin/logout`
- HMAC-SHA256 token signing and verification with `ADMIN_SESSION_SIGNING_SECRET`
- 8 hour default expiry, configurable by environment
- `requireAdmin` middleware
- Workers Rate Limiting binding applied to the login route
- `.dev.vars.example` documenting the required secret names with empty values

### Out of Scope

- Any account system, password reset, refresh token, or remember-me
- Agent authentication, which is G5.1
- Any cookie
- Storing sessions in D1

### Read First

- `SPEC.md` §17, §18, §24
- `AGENT.md` §13
- `GOAL.md` §8
- Architecture Constraint 2 in this plan

### Files

Create:

- `src/api/middleware/admin-auth.ts`
- `src/shared/token.ts`
- `.dev.vars.example`
- `tests/integration/admin-auth.test.ts`

Modify:

- `src/api/routes/admin/auth.ts`
- `wrangler.jsonc` (rate limiting binding)

Read: `src/shared/errors.ts`, `src/api/app.ts`

### Interfaces / Contracts

Produces:

```ts
POST /api/admin/login   { password: string } -> { token: string, expiresAt: string }
POST /api/admin/logout  -> { ok: true }
function signToken(payload, secret): Promise<string>
function verifyToken(token, secret): Promise<{ sub: 'admin', iat: number, exp: number }>
middleware requireAdmin  // rejects with AUTH_REQUIRED | AUTH_INVALID | AUTH_EXPIRED
```

Must not change:

```text
No Set-Cookie header is ever emitted by any route
```

### Implementation Requirements

1. The password is never compared with `===`. Compare the SHA-256 digest of the supplied password against the digest of `ADMIN_PASSWORD` using `crypto.subtle.timingSafeEqual`.
2. The token is `base64url(payload).base64url(hmacSha256(payload, secret))` with payload `{ sub: 'admin', iat, exp }`. Verification recomputes the HMAC and compares in constant time, then checks `exp`.
3. Distinguish the failure modes: a missing header is `AUTH_REQUIRED`, a malformed or badly signed token is `AUTH_INVALID`, a well-formed but expired token is `AUTH_EXPIRED`.
4. The rate limiter keys on `request.headers.get('CF-Connecting-IP')`, which Cloudflare sets and overwrites at the edge. `X-Forwarded-For` is never read. If the header is absent, fall back to a single shared bucket rather than skipping the limit.
5. The rate limit is defence in depth, not a brute-force guarantee. On limit, return HTTP 429 with the envelope and no information about whether the password was correct.
6. Login failures never reveal whether the password was close, and the response time does not vary with correctness beyond normal noise.
7. Logout is stateless: it returns success and the client discards the token. No server-side revocation list in Phase 1.
8. No secret value is ever logged, echoed in an error message, or returned in a response body.
9. The token payload contains no secret material and is signed but not encrypted, so nothing sensitive may be placed in it.

### Edge Cases

- Missing `Authorization` header → `AUTH_REQUIRED`
- `Authorization` present but not `Bearer` → `AUTH_INVALID`
- Token with a valid payload and a tampered signature → `AUTH_INVALID`
- Token signed with a different secret → `AUTH_INVALID`
- Token whose payload has been swapped for another valid payload → `AUTH_INVALID`
- Token expired one second ago → `AUTH_EXPIRED`
- Empty password submitted → `AUTH_INVALID`, still rate limited
- Eleven login attempts inside a minute → the eleventh is 429
- `ADMIN_PASSWORD` not configured → the endpoint fails closed with a 500 and a server-side log, never open

### Tests Required

Positive:

- Correct password yields a token that `requireAdmin` accepts
- `expiresAt` is approximately 8 hours ahead
- A protected route succeeds with a valid token

Negative:

- Wrong password rejected
- Missing, malformed, tampered, foreign-signed and expired tokens each rejected with the correct code
- Rate limit triggers on the configured threshold
- No response in any of these paths contains a `Set-Cookie` header
- No response body or log line contains the password or the signing secret

Regression:

- Timing-safe comparison is used, asserted by inspecting the implementation for the absence of naive string equality on the secret path

### Verification Commands

```bash
pnpm test -- tests/integration/admin-auth.test.ts
pnpm typecheck
grep -rn "Set-Cookie" src/ || echo "no Set-Cookie in source"
```

Expected:

```text
exit 0
grep finds no Set-Cookie usage anywhere in src/
```

### Definition of Done

- [ ] Login issues a signed 8 hour token; logout is stateless
- [ ] Timing-safe password comparison implemented and asserted
- [ ] All five token-rejection cases covered with distinct error codes
- [ ] Rate limiting active on login using the trusted Cloudflare client IP only
- [ ] No cookie is ever set, proven by grep and by response assertions
- [ ] Secrets absent from all logs and responses
- [ ] Fails closed when `ADMIN_PASSWORD` is unset

### Stop Conditions

- `crypto.subtle.timingSafeEqual` is unavailable in the target runtime
- The Rate Limiting binding is unavailable on this account or plan
- SPEC §17 conflicts with the no-cookie constraint

### Suggested Commit

```text
feat(auth): add admin password login, signed session token and login rate limit
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.7 — Admin API: Create Document

### Status

```text
BLOCKED
```

### Goal

An authenticated multipart endpoint that publishes an uploaded HTML file, plus the category listing the upload form needs.

### Why

This is the first transport binding of the write path, and the place where the thin-route discipline is either established or lost for the rest of the project.

### Dependencies

```text
depends_on: G1.5, G1.6
blocks:     G1.11
can_parallel_with: G1.8, G1.9
```

### Scope

- `POST /api/admin/documents` accepting `multipart/form-data`
- `GET /api/admin/categories` returning the flat category list for the upload form
- Zod validation of all non-file fields
- Route-level wiring only: validate, authorize, delegate to `DocumentService`, wrap the response

### Out of Scope

- Any business rule, SQL or R2 call inside the route
- Update, versions, restore, delete
- Category or tag management endpoints
- The admin user interface

### Read First

- `SPEC.md` §9, §18, §24
- `TECHSTACK.md` §8, §9
- `AGENT.md` §10
- `src/domain/documents/document-service.ts`

### Files

Create:

- `tests/integration/admin-documents-api.test.ts`

Modify:

- `src/api/routes/admin/documents.ts`
- `src/api/routes/admin/categories.ts` (read-only listing only)

Read: `src/api/middleware/admin-auth.ts`, `src/shared/envelope.ts`

### Interfaces / Contracts

Produces:

```text
POST /api/admin/documents
  multipart: file, categoryId, title?, description?, tags?(JSON array), note?
  201 -> { documentId, slug, url, versionId, versionNo, title, description, tags }

GET /api/admin/categories
  200 -> { categories: [{ id, parentId, name, slug, sortOrder }] }
```

Must not change:

```text
The response envelope
Domain service signatures
```

### Implementation Requirements

1. The route body stays under roughly 40 lines. All decisions belong to the domain service. If the handler grows past that, it is a signal the logic is in the wrong layer and the node must report it.
2. Every non-file field is parsed by Zod: `categoryId` a non-empty string, `title` and `description` optional strings, `tags` an optional JSON array of strings capped at 20 entries, `note` an optional string capped at 500 characters.
3. The `url` in the response is the absolute public reader URL derived from configuration, not hard-coded, and not the content origin.
4. Domain errors propagate as `AppError` and are rendered by the global handler; the route contains no `try/catch` that swallows them.
5. `requireAdmin` protects both routes.
6. A missing file part yields `FILE_REQUIRED` before any other work.
7. Content-Type must be `multipart/form-data`; anything else is a 400 with a clear code.

### Edge Cases

- No file part in the multipart body → `FILE_REQUIRED`
- File present but named `report.txt` → `INVALID_FILE_EXTENSION`
- `categoryId` missing → `CATEGORY_REQUIRED`
- `categoryId` present but unknown → `CATEGORY_NOT_FOUND`
- `tags` sent as a comma-joined string rather than JSON → 400 with a validation code, not a silent partial parse
- 25 tags supplied → rejected by validation rather than silently truncated
- Valid request with no token → `AUTH_REQUIRED`
- Body larger than the Worker request limit → surfaced as `FILE_TOO_LARGE`, not an opaque platform error

### Tests Required

Positive:

- Authenticated upload of the fixture returns 201 with a slug and an absolute reader URL
- `GET /api/admin/categories` returns the four seeded categories
- Optional overrides are passed through to the created document

Negative:

- Unauthenticated upload rejected with `AUTH_REQUIRED` and nothing written
- Each validation failure returns its documented code
- Unknown category rejected with `CATEGORY_NOT_FOUND`
- Non-multipart content type rejected

Regression:

- The handler contains no SQL, no R2 call, and no direct binding access, asserted by a source check

### Verification Commands

```bash
pnpm test -- tests/integration/admin-documents-api.test.ts
pnpm typecheck
```

Expected:

```text
exit 0
source check confirms no SQL or storage access inside route files
```

### Definition of Done

- [ ] Upload endpoint publishes the fixture end to end through the domain service
- [ ] Category listing available for the form
- [ ] All Zod validation cases covered by tests
- [ ] Unauthenticated and invalid-token requests rejected before any work
- [ ] Route files contain no SQL, no R2 access and no business rules
- [ ] Absolute reader URL derived from configuration

### Stop Conditions

- Multipart parsing in Workers cannot handle a 20 MiB part
- Route logic cannot stay thin without a domain service change outside this node's scope

### Suggested Commit

```text
feat(api): add admin document upload and category listing endpoints
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.8 — Public API: List & Get Document

### Status

```text
BLOCKED
```

### Goal

Anonymous read endpoints returning library metadata and a single document's details including the absolute content URL, never including HTML body bytes.

### Why

This is the contract the Reader and the Library UI are built against, and the place where the no-body-in-lists performance rule is enforced.

### Dependencies

```text
depends_on: G1.5
blocks:     G1.10
can_parallel_with: G1.7, G1.9
```

### Scope

- `GET /api/public/documents` with pagination
- `GET /api/public/documents/:slug`
- `GET /api/public/categories`
- Absolute `contentUrl` construction from configuration

### Out of Scope

- Search and filtering, which are M4
- Tag listing endpoint, which is G2.4
- Any authentication
- Any HTML body content in a response

### Read First

- `SPEC.md` §14, §18, §24
- `TECHSTACK.md` §22
- `AGENT.md` §25

### Files

Create:

- `src/domain/documents/document-read.ts`
- `tests/integration/public-api.test.ts`

Modify:

- `src/api/routes/public/documents.ts`
- `src/api/routes/public/categories.ts`

Read: `src/shared/envelope.ts`, `src/shared/types.ts`

### Interfaces / Contracts

Produces:

```text
GET /api/public/documents?page=1&pageSize=20
  200 -> { items: [{ slug, title, description, categoryPath[], tags[], updatedAt }],
           page, pageSize, total }

GET /api/public/documents/:slug
  200 -> { documentId, slug, title, description, category{...}, categoryPath[],
           tags[], updatedAt, currentVersionId, contentUrl }
  404 -> DOCUMENT_NOT_FOUND

GET /api/public/categories
  200 -> { categories: [{ id, parentId, name, slug, sortOrder, documentCount }] }
```

Must not change:

```text
No endpoint in this group ever returns HTML body bytes
```

### Implementation Requirements

1. `contentUrl` is built from a configured content origin plus the document slug, returned absolute so no client hard-codes an origin.
2. Pagination defaults to page 1 and page size 20, with page size capped at 100. Ordering is `updated_at DESC, id ASC` so paging is stable when timestamps tie.
3. `categoryPath` is an ordered array from root to leaf, resolved with a recursive CTE or from the category list, whichever measures simpler; the response shape is fixed regardless.
4. No endpoint reads from R2. The list query selects only metadata columns.
5. Unknown slug returns `DOCUMENT_NOT_FOUND` with the standard envelope, never an empty 200.
6. Documents whose `current_version_id` is null are excluded from public listings, since they have nothing readable.
7. Responses carry a short public cache header for metadata, and the value is chosen deliberately rather than copied.

### Edge Cases

- Empty library → `items: []`, `total: 0`, not a 404
- Page beyond the last page → empty items with correct `total`
- `pageSize=0` or negative → clamped to the default rather than erroring
- `pageSize=1000` → clamped to 100
- Slug with different casing → not found, because slugs are lowercase by contract
- Category deleted out from under a document → impossible by `ON DELETE RESTRICT`, asserted as a regression test
- Document with no tags → empty array, not null

### Tests Required

Positive:

- List returns seeded documents with stable ordering
- Get by slug returns full metadata plus an absolute `contentUrl`
- Category list includes accurate document counts

Negative:

- Unknown slug returns `DOCUMENT_NOT_FOUND`
- No response in this group contains HTML body content, asserted by scanning the serialized payload for the fixture's marker text
- Pagination parameters out of range are clamped, not fatal

Regression:

- The list endpoint issues no R2 operation, asserted by a spy on the binding

### Verification Commands

```bash
pnpm test -- tests/integration/public-api.test.ts
pnpm typecheck
```

Expected:

```text
exit 0
R2 spy records zero calls during list and get-metadata requests
```

### Definition of Done

- [ ] Three public endpoints implemented with the documented shapes
- [ ] `contentUrl` absolute and configuration-driven
- [ ] Pagination clamped, ordering stable and documented
- [ ] No HTML body bytes in any response, proven by test
- [ ] Zero R2 access from list and metadata endpoints, proven by spy
- [ ] Unknown slug returns the correct error envelope

### Stop Conditions

- The content origin cannot be resolved from configuration at request time
- Category path resolution requires a schema change

### Suggested Commit

```text
feat(api): add public document listing, detail and category endpoints
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.9 — Content Worker: Serve Current Version

### Status

```text
BLOCKED
```

### Goal

A second Worker on a separate origin that resolves a slug to its current version and streams the original bytes from R2, with a strictly read-only implementation and no access to any admin or agent secret.

### Why

This Worker is the browser-security boundary of the whole product. Uploaded HTML executes here, in an origin that must never be able to reach admin state.

### Dependencies

```text
depends_on: G1.1
blocks:     G1.12
can_parallel_with: G1.7, G1.8
```

### Scope

- `GET /d/:slug` resolving the current version and streaming the R2 object
- `GET /health` returning a minimal liveness response
- Response headers: content type, `X-Content-Type-Options`, `Content-Security-Policy: frame-ancestors`, `Cache-Control`, `ETag`
- `wrangler.content.jsonc` bindings: D1 read use and the R2 bucket only
- An automated source assertion proving the read-only constraint

### Out of Scope

- Signed historical preview URLs, which are G3.4
- Any write path of any kind
- Any admin, agent or session awareness
- Any modification of the served bytes

### Read First

- `SPEC.md` §2 content delivery boundary, §7, §16
- `AGENT.md` §8, §7
- Architecture Constraints 1, 3, 4, 5 in this plan
- `migrations/0001_init.sql`

### Files

Create:

- `src/content/handler.ts`
- `tests/integration/content-worker.test.ts`
- `tests/integration/content-worker-readonly.test.ts`

Modify:

- `src/content/index.ts`
- `wrangler.content.jsonc`

Read: `src/shared/errors.ts`

### Interfaces / Contracts

Produces:

```text
GET /d/:slug   200 text/html, original bytes, ETag = sha256
               404 when the slug is unknown or has no current version
GET /health    200 text/plain
```

Must not change:

```text
The served bytes
The absence of allow-same-origin in the embedding page's sandbox
```

### Implementation Requirements

1. **The Worker has a D1 binding, but its implementation is strictly read-only: no mutation routes and no INSERT, UPDATE or DELETE code paths.** A test asserts the absence of those keywords, case-insensitively, across the content Worker's source tree.
2. Bindings are exactly the D1 database and the R2 bucket. No `ADMIN_PASSWORD`, no `ADMIN_SESSION_SIGNING_SECRET`, no `AGENT_API_KEY`. A test asserts the binding list.
3. The slug is resolved with a prepared statement joining `documents` to `document_versions` on `current_version_id`; user input is never concatenated into SQL.
4. The R2 object is streamed to the response, not buffered, and the body is never transformed.
5. Headers: `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors <app origin>`, `Cache-Control: public, max-age=60`, and `ETag` set to the version's sha256 with correct 304 handling on `If-None-Match`.
6. No CSP directive restricts external stylesheets, fonts, images or scripts, because SPEC allows uploaded documents to load external resources.
7. The app origin used in `frame-ancestors` comes from configuration so the value changes with the deployment rather than being hard-coded.
8. Unknown slug returns a plain, minimal 404 page with no library branding and no information about other documents.
9. The Worker never emits `Set-Cookie` and never reads a cookie.

### Edge Cases

- Slug exists but `current_version_id` is null → 404
- Version row exists but the R2 object is missing → 404 with `R2_READ_FAILED` logged server-side
- `If-None-Match` matching the ETag → 304 with no body
- Slug containing path traversal characters → parameterized query, no file-system semantics, 404
- Extremely long slug → 404 rather than an unhandled error
- A 20 MiB document → streamed without buffering
- Concurrent requests for the same document → no shared mutable state

### Tests Required

Positive:

- Known slug returns the original bytes with the correct headers
- ETag round-trip produces a 304
- The fixture is served byte-identically, asserted by sha256

Negative:

- Unknown slug returns 404
- Missing R2 object returns 404 and logs the failure
- The content Worker source contains no INSERT, UPDATE or DELETE
- The content Worker declares no admin or agent secret binding
- No `Set-Cookie` header is ever emitted

Regression:

- Served bytes equal stored bytes equal uploaded bytes across the whole chain

### Verification Commands

```bash
pnpm test -- tests/integration/content-worker.test.ts tests/integration/content-worker-readonly.test.ts
pnpm exec wrangler deploy -c wrangler.content.jsonc --dry-run
grep -riE "insert |update |delete " src/content/ || echo "content worker is read-only"
```

Expected:

```text
exit 0
grep finds no mutation keyword in src/content/
dry-run succeeds and lists only D1 and R2 bindings
```

### Definition of Done

- [ ] `/d/:slug` serves the current version byte-identically
- [ ] Read-only constraint enforced by an automated source assertion, not by convention
- [ ] Bindings limited to D1 and R2, asserted by test and by dry-run output
- [ ] All required headers present with configuration-driven `frame-ancestors`
- [ ] No CSP directive blocks external resources
- [ ] 404 paths return no information about other documents
- [ ] No cookie read or written

### Stop Conditions

- Origin isolation cannot be achieved with two workers.dev hostnames
- Streaming from R2 with an ETag is not expressible in the runtime
- Any requirement would need a write path in this Worker

### Suggested Commit

```text
feat(content): add read-only content worker serving current document versions
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.10 — SPA Shell, Library List & Reader

### Status

```text
BLOCKED
```

### Goal

The public application shell: a routed React SPA with a Library listing and a Reader that displays a document inside a sandboxed cross-origin iframe, usable at 375, 768 and 1440 pixels.

### Why

This is the reading experience Alexandria exists to provide, and the node where the iframe sandbox contract is expressed in the markup that actually ships.

### Dependencies

```text
depends_on: G1.8
blocks:     G1.11, G1.12
can_parallel_with: —
```

### Scope

- React Router routes for `/` and `/docs/:slug`, with the admin route group lazily loaded
- Library list rendering title, category path, tags and updated date
- Reader Shell: back control, title, category, updated date, share control, and the document iframe
- Loading, empty and error states for both routes
- Responsive layout using `100dvh` for the Reader
- Application-shell styling only, never applied to iframe content

### Out of Scope

- Search, filtering, and pagination controls, which are M4
- Any admin screen
- Any Dria affordance
- Any attempt to resize the iframe to its content height

### Read First

- `SPEC.md` §14, §15, §16, §25
- `GOAL.md` §7
- `TECHSTACK.md` §5, §6, §22
- `AGENT.md` §22, §24, §25

### Files

Create:

- `src/app/routes/library.tsx`, `src/app/routes/reader.tsx`
- `src/app/components/DocumentCard.tsx`, `src/app/components/DocumentFrame.tsx`, `src/app/components/ShareButton.tsx`
- `src/app/lib/api-client.ts`
- `tests/browser/library.spec.ts`, `tests/browser/reader.spec.ts`

Modify:

- `src/app/main.tsx`, `src/app/routes/root.tsx`, `src/app/styles/app.css`

Read: `src/shared/types.ts`

### Interfaces / Contracts

Consumes:

```text
GET /api/public/documents
GET /api/public/documents/:slug
GET /api/public/categories
```

Produces:

```text
Routes: / and /docs/:slug
<iframe src={contentUrl}
        sandbox="allow-scripts allow-popups allow-downloads"
        referrerpolicy="strict-origin-when-cross-origin" />
```

Must not change:

```text
The sandbox attribute must never gain allow-same-origin
```

### Implementation Requirements

1. The iframe `src` is the `contentUrl` returned by the API. The application never constructs a content origin itself and never passes a token, key or session value in that URL.
2. The sandbox attribute is exactly `allow-scripts allow-popups allow-downloads`. A code comment states why `allow-same-origin` is forbidden, and a browser test asserts the attribute value.
3. The Reader lays out as a sticky header plus an iframe filling the remaining height using `100dvh`, so the document scrolls inside the frame. Do not attempt content-height auto-resizing, since that would require injecting a script into uploaded HTML, which AGENT.md §7 forbids.
4. No application CSS, class name or theme variable is applied to or inherited by the iframe document.
5. The admin route group is a lazily loaded chunk so that opening the Library never downloads admin code.
6. Share uses the Web Share API when available and falls back to copying the URL, with a visible confirmation. No action is hover-only.
7. Loading states are skeletons rather than layout-shifting spinners; the empty library renders an explanatory state rather than a blank page.
8. A document that fails to load renders an error state that keeps the header usable, so the reader can navigate back.

### Edge Cases

- Empty library → explanatory empty state
- Unknown slug → not-found state with a route back to the Library
- API unreachable → error state, no infinite spinner
- Very long title → truncated in the header with the full value available as a tooltip and as the document title
- Document with no tags or an empty description → layout stays intact
- 375 pixel viewport → header remains usable and the reading area is not shrunk further
- iframe blocked or slow → header renders immediately, frame shows its own loading affordance
- Browser without the Web Share API → copy fallback

### Tests Required

Positive:

- Library lists documents and links to the Reader
- Reader renders the header and an iframe pointing at the content origin
- The fixture visibly renders inside the frame, including its Google Font and external image
- Layout verified at 375, 768 and 1440

Negative:

- The iframe sandbox attribute never contains `allow-same-origin`, asserted in the DOM
- No admin JavaScript chunk is requested while browsing the Library, asserted from network requests
- No application stylesheet is present inside the iframe document
- Unknown slug renders the not-found state rather than crashing

Regression:

- No console error is produced during a normal Library-to-Reader-to-back journey

### Verification Commands

```bash
pnpm test:browser -- tests/browser/library.spec.ts tests/browser/reader.spec.ts
pnpm build
pnpm typecheck
```

Expected:

```text
exit 0
browser tests pass at all three viewports
build output shows the admin chunk split from the public entry
```

### Definition of Done

- [ ] Library and Reader routes implemented with loading, empty and error states
- [ ] Sandbox attribute exact and asserted, without `allow-same-origin`
- [ ] `contentUrl` consumed from the API, never constructed client-side
- [ ] Reader fills the viewport with `100dvh` and the document scrolls inside the frame
- [ ] Admin chunk lazily loaded and absent from public navigation
- [ ] Three viewports verified by browser test
- [ ] No application styling reaches the iframe document

### Stop Conditions

- The fixture cannot render inside the sandbox without weakening it
- The API contract from G1.8 proves insufficient for the Reader header
- Meeting the layout requirement would need script injection into the document

### Suggested Commit

```text
feat(app): add library listing and reader shell with sandboxed content frame
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.11 — Admin UI: Login, Upload, Review, Publish

### Status

```text
BLOCKED
```

### Goal

An admin surface that authenticates, previews extracted metadata locally, lets the operator correct it, publishes in a single upload, and shows the resulting stable URL.

### Why

This closes the vertical slice into something a person can actually use, and it is where the single-upload contract from the approved design is implemented.

### Dependencies

```text
depends_on: G1.7, G1.10
blocks:     G1.12
can_parallel_with: —
```

### Scope

- `/admin` login screen storing the token in `sessionStorage`
- `/admin/documents` with an upload form
- Client-side metadata preview using the browser's own `DOMParser`
- Editable title, description and tags, plus a category selector
- Single publish request carrying the file and any explicit overrides
- Success state showing the stable public URL with a copy control
- Session expiry handling that returns the operator to login without losing the page

### Out of Scope

- Category and tag management screens, which are M2
- Version history, restore and delete screens, which are M3
- Editing an existing document
- Uploading the file twice, once for preview and once for publish

### Read First

- `SPEC.md` §8, §9, §17, §18
- `AGENT.md` §22
- Correction 3 in the approved design: client preview, server authority
- `src/api/routes/admin/documents.ts`

### Files

Create:

- `src/app/routes/admin/login.tsx`, `src/app/routes/admin/documents.tsx`
- `src/app/features/upload/UploadForm.tsx`, `src/app/features/upload/client-metadata.ts`
- `src/app/lib/admin-session.ts`
- `tests/unit/client-metadata.test.ts`, `tests/browser/admin-upload.spec.ts`

Modify:

- `src/app/routes/root.tsx` (admin route group registration only)

Read: `src/app/lib/api-client.ts`

### Interfaces / Contracts

Consumes:

```text
POST /api/admin/login
GET  /api/admin/categories
POST /api/admin/documents
```

Produces:

```ts
function extractClientMetadata(file: File): Promise<{ title: string; description: string; keywords: string[] }>
// preview only — never authoritative
```

Must not change:

```text
The token is stored in sessionStorage and sent only in an Authorization header.
No cookie, no localStorage, no URL parameter carries the token.
```

### Implementation Requirements

1. **The file is uploaded exactly once.** The browser reads it locally with `DOMParser` to preview metadata; the bytes go to the server only when the operator publishes.
2. **The server remains authoritative.** The client preview is a convenience. On publish, the server re-validates and re-extracts, and any field the operator edited is sent as an explicit override. A field left untouched is not sent, so the server's own extraction wins.
3. The form marks each previewed field as either extracted or edited, so the operator can see which values they are overriding.
4. The token lives in `sessionStorage` under a single key and is attached by the API client as `Authorization: Bearer`. No cookie is created and no token appears in any URL.
5. A 401 response clears the session and routes to login, preserving the current path so the operator returns to where they were.
6. The category selector lists the flat category set from the API. There is no create-category affordance in this milestone.
7. Client-side validation mirrors the server's rules for a fast failure, but never replaces them: extension, non-empty, and size are checked before upload to avoid a pointless 20 MiB round trip.
8. Upload shows progress and disables double submission; a failed publish keeps the chosen file and the edited fields so the operator does not start over.
9. The success state shows the public URL, a copy control, and a link that opens the Reader.

### Edge Cases

- Session expires while the form is filled → login, then return to the form
- The chosen file is rejected client-side → clear message naming the rule that failed
- The operator clears the title entirely → the server treats an empty title override as absent and uses its own extraction, so the document always has a title
- Thai-language document with no `<title>` → preview shows the filename fallback, and the server agrees
- Slow upload → progress visible, submit disabled, no duplicate request
- Server rejects with `CATEGORY_NOT_FOUND` because the category was deleted mid-session → the selector refreshes and the operator is told why
- Publish succeeds but the browser navigates away → the document is still published, since the server owns the transaction
- Client and server extraction disagree → the server value is used and displayed in the success state

### Tests Required

Positive:

- Login with the correct password reaches the upload form
- Preview shows extracted title, description and keywords for the fixture
- Publishing produces a stable URL that opens the document in the Reader
- An edited title is honoured as an override

Negative:

- Wrong password shows an error and stores no token
- Publishing without a file is blocked before any request
- An expired token returns the operator to login rather than showing a broken page
- The token never appears in `document.cookie`, in `localStorage`, or in any request URL, asserted in the browser test
- The file is transmitted exactly once, asserted by counting upload requests

Regression:

- Admin code is not downloaded while browsing the public Library

### Verification Commands

```bash
pnpm test -- tests/unit/client-metadata.test.ts
pnpm test:browser -- tests/browser/admin-upload.spec.ts
pnpm build
```

Expected:

```text
exit 0
network log for a publish shows exactly one request carrying the file body
```

### Definition of Done

- [ ] Login, upload, preview, override and publish all work against the real API
- [ ] The file is uploaded once, proven by a request count assertion
- [ ] Server-side extraction remains authoritative, with overrides explicit
- [ ] Token in `sessionStorage` only, never a cookie, never a URL, proven by test
- [ ] Session expiry handled without data loss
- [ ] Success state shows the stable public URL with a copy control
- [ ] No category creation affordance present in this milestone

### Stop Conditions

- `DOMParser` preview and server extraction disagree in a way that would mislead the operator
- Single-upload publishing is not achievable with the chosen form handling
- Any requirement pushes the token out of `sessionStorage`

### Suggested Commit

```text
feat(admin): add login, upload with local metadata preview and publish flow
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G1.12 — M1 Deploy & Acceptance

### Status

```text
BLOCKED
```

### Goal

Alexandria M1 running on Cloudflare with real D1 and R2, the Mauboussin fixture published through the deployed Admin UI, and the document readable at its stable public URL on a real phone.

### Why

Origin isolation across real hostnames, external resource loading under a real sandbox, and mobile reading cannot be honestly verified anywhere except production. Discovering a problem here is cheap; discovering it after five more milestones is not.

### Dependencies

```text
depends_on: G1.9, G1.10, G1.11
blocks:     CHECKPOINT A
can_parallel_with: —
```

### Scope

- Create the remote D1 database `alexandria-db` and the R2 bucket `alexandria-docs`
- Configure secrets on both Workers
- Apply migrations to the remote database
- Deploy `alexandria` and `alexandria-content`
- Publish the fixture through the deployed Admin UI
- Verify reading on desktop and on a real mobile device
- Record a rollback procedure

### Out of Scope

- Any feature work; this node changes configuration and deployment only
- GitHub Actions
- A custom domain
- Performance tuning

### Read First

- `TECHSTACK.md` §10, §11, §12, §13
- `SPEC.md` §2, §16, §28
- `AGENT.md` §13, §30
- `wrangler.jsonc`, `wrangler.content.jsonc`

### Files

Create:

- `docs/DEPLOYMENT.md` recording resources, commands, configuration values and the rollback procedure

Modify:

- `wrangler.jsonc`, `wrangler.content.jsonc` (production bindings and vars)

Read: everything produced by M1

### Interfaces / Contracts

Produces:

```text
https://alexandria.vcp-scanner.workers.dev
https://alexandria-content.vcp-scanner.workers.dev
D1: alexandria-db     R2: alexandria-docs
Vars: APP_ORIGIN, CONTENT_ORIGIN, MAX_UPLOAD_BYTES
Secrets: ADMIN_PASSWORD, ADMIN_SESSION_SIGNING_SECRET,
         AGENT_API_KEY, CONTENT_PREVIEW_SIGNING_SECRET
```

Must not change:

```text
Secret values must never appear in chat, logs, commits, command echoes, or this document
```

### Implementation Requirements

1. **Precondition, owned by the project owner, not the executor:** R2 must be enabled in the Cloudflare dashboard, and `wrangler login` re-run so the OAuth token gains the `r2` scope. The account currently returns `code 10042` and its token has no `r2` scope. If either is still missing, STOP and report; do not attempt to work around it.
2. `ADMIN_PASSWORD` is set by the project owner personally. The executor never generates it, never sees it, and never writes it anywhere.
3. `ADMIN_SESSION_SIGNING_SECRET`, `AGENT_API_KEY` and `CONTENT_PREVIEW_SIGNING_SECRET` are generated with a cryptographically secure source and piped directly into `wrangler secret put` without ever being echoed to a terminal, a log, a commit or a chat message. `AGENT_API_KEY` is additionally written to the git-ignored `.dev.vars` so that local development and the future MCP client can read it from disk rather than from a person's memory.
4. `CONTENT_PREVIEW_SIGNING_SECRET` is set now even though it is first consumed in G3.4, so that secret provisioning happens once.
5. Remote migrations are applied with the wrangler migrations command and the resulting state is recorded. Take a `wrangler d1 export` snapshot before applying, so there is a restore point.
6. `APP_ORIGIN` and `CONTENT_ORIGIN` are configuration variables, not constants in source. Confirm no source file hard-codes either hostname.
7. Deploy the content Worker before the app Worker, so the Reader never points at a hostname that does not yet answer.
8. Publish the fixture through the deployed Admin UI, not through a script, because the point is to exercise the real path.
9. Verify on a genuine mobile device on a different network, not only an emulated viewport.
10. `docs/DEPLOYMENT.md` records every resource name, every command, both origins, the migration state, and how to roll back. It contains no secret values.

### Edge Cases

- R2 still not enabled → STOP with a clear report; this is the only external blocker in the plan
- The OAuth token lacks the `r2` scope even after enabling R2 → re-login required, report it
- A Worker name collides with an existing Worker on the account → STOP rather than overwriting `vcp-scanner`, `pe-hub-api-prod` or `pe-hub-api-staging`
- Remote migration partially applies → restore from the pre-migration export and report
- The fixture renders locally but its external font or image is blocked in production → investigate headers before weakening any security control, and report rather than adding `allow-same-origin`
- Mobile Safari renders `100dvh` differently from Chrome → fix in CSS, not by shrinking the reading area
- The published document loads but the Admin UI cannot reach the API from the phone → check origins and configuration, never CORS-open the API to the content origin

### Tests Required

Positive:

- Both deployed Workers respond, and `/health` on the content Worker returns 200
- The fixture publishes through the deployed Admin UI and returns a stable URL
- The document renders in the Reader with its Google Font, external image, tables and SVG intact
- The document reads correctly on a real phone

Negative:

- The published document's bytes match the local file's sha256 exactly
- The Admin session token is unreachable from inside the iframe, checked in a real browser
- No secret string appears in the deployed client bundle, checked against the built asset files
- Reading the document requires no login

Regression:

- The full local suite still passes against the deployed configuration values

### Verification Commands

```bash
pnpm exec wrangler d1 create alexandria-db
pnpm exec wrangler r2 bucket create alexandria-docs
pnpm exec wrangler d1 export alexandria-db --remote --output ./backup-pre-migration.sql
pnpm db:migrate:remote
pnpm exec wrangler d1 migrations list alexandria-db --remote
pnpm exec wrangler deploy -c wrangler.content.jsonc
pnpm exec wrangler deploy -c wrangler.jsonc
curl -sI https://alexandria-content.vcp-scanner.workers.dev/health
curl -s https://alexandria.vcp-scanner.workers.dev/api/public/documents | head -c 400
grep -rE "ADMIN_|AGENT_API_KEY|SIGNING_SECRET" dist/ || echo "no secret in built assets"
```

Expected:

```text
all commands exit 0
migrations list shows 0001 and 0002 applied remotely
health returns 200
public documents endpoint returns a JSON envelope
grep finds no secret in dist/
```

### Definition of Done

- [ ] Remote D1 and R2 created, migrations applied and recorded
- [ ] All four secrets set on the correct Workers, none ever printed
- [ ] `ADMIN_PASSWORD` set by the project owner personally
- [ ] Both Workers deployed and answering on their own hostnames
- [ ] Fixture published through the deployed Admin UI with a stable public URL
- [ ] Document renders with all external resources intact
- [ ] Verified on a real mobile device on a different network
- [ ] Admin token unreachable from inside the iframe in a real browser
- [ ] No secret present in the built client bundle
- [ ] `docs/DEPLOYMENT.md` written, with a rollback procedure and no secret values
- [ ] CHECKPOINT A gate items all satisfied with recorded evidence

### Stop Conditions

- R2 is not enabled or the token lacks the `r2` scope
- A deployment would overwrite an unrelated Worker on the account
- The fixture cannot render in production without weakening the sandbox
- Remote migration fails or partially applies

### Suggested Commit

```text
chore(deploy): provision cloudflare resources and deploy m1 vertical slice
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G2.1 — Category Management

### Status

```text
BLOCKED
```

### Goal

`CategoryService` plus its admin endpoints, providing an arbitrary-depth category tree that Admin can create, rename, move and delete without a cycle, a duplicate sibling slug, or an orphaned document ever becoming possible.

### Why

The category tree is the organizational backbone of the library, and it is owned exclusively by Admin. A cycle or a permitted non-empty deletion corrupts navigation for every document underneath.

### Dependencies

```text
depends_on: CHECKPOINT A
blocks:     G2.3, G2.4, G2.5
can_parallel_with: G2.2
```

### Scope

- `CategoryService`: create, rename, move, delete, list tree, resolve path, count documents
- `POST /api/admin/categories`, `PATCH /api/admin/categories/:id`, `POST /api/admin/categories/:id/move`, `DELETE /api/admin/categories/:id`
- Cycle detection with a recursive CTE
- Sibling slug uniqueness including the root level
- Deletion guards for non-empty categories

### Out of Scope

- Any category creation capability for the Agent, which is permanently forbidden
- Tag behaviour
- The admin user interface
- Reordering beyond maintaining `sort_order`

### Read First

- `SPEC.md` §5 categories, §18, §24
- `GOAL.md` §5
- `AGENT.md` §5 category ownership, §6, §32
- `migrations/0001_init.sql`

### Files

Create:

- `src/domain/categories/category-service.ts`
- `tests/integration/category-service.test.ts`, `tests/integration/category-api.test.ts`

Modify:

- `src/api/routes/admin/categories.ts`

Read: `src/shared/errors.ts`

### Interfaces / Contracts

Produces:

```ts
CategoryService.create({ parentId, name, slug?, sortOrder? })
CategoryService.rename(id, name)
CategoryService.move(id, newParentId)
CategoryService.remove(id)
CategoryService.tree(): CategoryNode[]
CategoryService.path(id): CategoryNode[]
```

Must not change:

```text
Category ownership stays with Admin. No agent-reachable route may create,
rename, move or delete a category.
```

### Implementation Requirements

1. A move is rejected when the target parent is the category itself or any of its descendants, detected with a recursive CTE, raising `CATEGORY_CYCLE`.
2. Sibling slug uniqueness is enforced at both the database level and the service level so the error surfaces as `CATEGORY_SLUG_CONFLICT` rather than a raw constraint failure. The root level relies on the partial unique index added in G1.1.
3. Deleting a category that has any child category or any document raises `CATEGORY_NOT_EMPTY`. The service never cascades, never reparents, and never moves documents on the operator's behalf.
4. A category slug is generated from its name using the same slug rules as documents, then made unique within its parent.
5. Renaming changes `name` only. It never changes the category slug, and it never changes any document slug.
6. `tree()` returns the whole tree in one query, ordered by `sort_order` then `name`, because the tree is small and the client builds paths from it.
7. Depth is unlimited by design, but the service refuses a move that would exceed a configured maximum depth of 10 to protect the UI from pathological trees, raising a validation error rather than corrupting anything.

### Edge Cases

- Move a category into its own subtree → `CATEGORY_CYCLE`
- Move a category into itself → `CATEGORY_CYCLE`
- Move to a non-existent parent → `CATEGORY_NOT_FOUND`
- Move to root when a root sibling has the same slug → `CATEGORY_SLUG_CONFLICT`
- Delete a category holding one document → `CATEGORY_NOT_EMPTY`
- Delete a category holding one empty child → `CATEGORY_NOT_EMPTY`
- Delete a genuinely empty leaf → succeeds
- Create two roots named the same → second gets a suffixed slug or a conflict, deterministically
- Rename to an existing sibling name → allowed, because names are not unique; slugs are

### Tests Required

Positive:

- Create nested categories three levels deep
- Move a subtree to a new parent and confirm the paths of its documents update
- Rename without touching any slug
- Delete an empty leaf

Negative:

- Every cycle variant rejected
- Non-empty deletion rejected in both the child and the document case
- Sibling and root slug conflicts rejected
- Unauthenticated calls to all four endpoints rejected

Regression:

- Moving a category never changes any document slug or public URL

### Verification Commands

```bash
pnpm test -- tests/integration/category-service.test.ts tests/integration/category-api.test.ts
pnpm typecheck
```

Expected:

```text
exit 0, every cycle and non-empty guard test passing
```

### Definition of Done

- [ ] Create, rename, move, delete and tree implemented in the service
- [ ] Four admin endpoints wired thinly to the service
- [ ] Cycle detection proven for self, child and deep-descendant cases
- [ ] Non-empty deletion rejected for both children and documents
- [ ] Root and sibling slug uniqueness proven
- [ ] Document slugs demonstrably unaffected by any category operation
- [ ] No agent-reachable category mutation exists

### Stop Conditions

- Recursive CTE support is insufficient in D1 for cycle detection
- A required guard cannot be expressed without a schema change

### Suggested Commit

```text
feat(categories): add category tree service with cycle and deletion guards
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G2.2 — Tag Management

### Status

```text
BLOCKED
```

### Goal

`TagService` plus its admin endpoints, giving tags a stable normalized identity, a merge operation that never loses a document link, and clean unlinking.

### Why

Tags are the flexible axis of organization and the one taxonomy an Agent may extend. Without normalization and merge, the tag set degrades into near-duplicates within weeks.

### Dependencies

```text
depends_on: CHECKPOINT A
blocks:     G2.4, G2.5
can_parallel_with: G2.1
```

### Scope

- `TagService`: create, rename, merge, delete, list with counts, link and unlink to documents
- `POST /api/admin/tags`, `PATCH /api/admin/tags/:id`, `POST /api/admin/tags/:id/merge`, `DELETE /api/admin/tags/:id`
- Reuse and extension of `normalizeTagName` created in G1.5

### Out of Scope

- Category behaviour
- The admin user interface
- Automatic tag suggestion by any model

### Read First

- `SPEC.md` §5 tags, §8, §18, §24
- `GOAL.md` §5
- `AGENT.md` §5 flexible tags
- `src/domain/tags/normalize.ts`

### Files

Create:

- `src/domain/tags/tag-service.ts`
- `tests/integration/tag-service.test.ts`, `tests/integration/tag-api.test.ts`

Modify:

- `src/api/routes/admin/tags.ts`
- `src/domain/tags/normalize.ts` (extend only; do not change existing behaviour)

Read: `src/domain/tags/tag-write.ts`

### Interfaces / Contracts

Produces:

```ts
TagService.create(name)
TagService.rename(id, name)
TagService.merge(sourceId, targetId)
TagService.remove(id)
TagService.list(): { id, name, normalizedName, documentCount }[]
TagService.setDocumentTags(documentId, names[])
```

Must not change:

```text
normalizeTagName behaviour established in G1.5, since existing rows depend on it
```

### Implementation Requirements

1. `normalized_name` is the unique identity: trimmed, internal whitespace collapsed to a single space, lower-cased. `name` preserves the operator's casing for display.
2. Creating a tag whose normalized name already exists returns the existing tag rather than raising, because tag creation is idempotent by design.
3. Merge moves every document link from source to target, skips links that would duplicate an existing pair, then deletes the source tag, all inside one D1 batch.
4. Deleting a tag removes its document links through the existing cascade. Deletion is allowed even when the tag is in use, since a tag carries no structural meaning, but the response reports how many links were removed.
5. `setDocumentTags` replaces a document's tag set atomically: it creates any missing tags, links what is new, and unlinks what is gone, in one batch.
6. Renaming to a name whose normalized form collides with another tag is rejected with a conflict rather than silently merging; merging must be explicit.
7. Tag names are capped at 50 characters and a document is capped at 20 tags.

### Edge Cases

- `  Value   Investing  ` and `value investing` → one tag
- Merge where both tags share a document → one surviving link, no duplicate-key failure
- Merge a tag into itself → rejected as a validation error
- Merge with a non-existent source or target → not found
- Rename that collides after normalization → conflict, not a silent merge
- Delete a tag linked to 50 documents → succeeds, reports 50 links removed
- `setDocumentTags` with an empty array → all links removed
- 21 tags supplied → rejected by validation

### Tests Required

Positive:

- Normalization collapses casing and whitespace into one tag
- Merge preserves every distinct document link and removes the source
- `setDocumentTags` adds and removes in one operation
- List returns accurate document counts

Negative:

- Self-merge rejected
- Colliding rename rejected
- Over-length name and over-count tag list rejected
- Unauthenticated calls rejected on all four endpoints

Regression:

- Tags created during G1.5 upload remain valid and are not duplicated by the new service

### Verification Commands

```bash
pnpm test -- tests/integration/tag-service.test.ts tests/integration/tag-api.test.ts
pnpm typecheck
```

Expected:

```text
exit 0, merge tests show zero lost or duplicated document links
```

### Definition of Done

- [ ] Normalization is the single source of tag identity and is unchanged from G1.5
- [ ] Merge is atomic and loses no document link, proven by test
- [ ] Colliding rename rejected rather than implicitly merging
- [ ] `setDocumentTags` replaces a tag set atomically
- [ ] Counts accurate in listings
- [ ] Four admin endpoints wired thinly to the service

### Stop Conditions

- Merge cannot be made atomic within one D1 batch
- Changing normalization would be required, which would invalidate existing rows

### Suggested Commit

```text
feat(tags): add tag service with normalization, merge and document linking
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G2.3 — Document Metadata Update & Move

### Status

```text
BLOCKED
```

### Goal

`PATCH /api/admin/documents/:slug` and `POST /api/admin/documents/:slug/move`, changing title, description, tags and category while proving the slug and the public URL never move.

### Why

This is where the stable-slug invariant is most likely to be broken by a well-meaning change, so it gets its own node and its own negative tests.

### Dependencies

```text
depends_on: G2.1
blocks:     G2.5
can_parallel_with: G2.4
```

### Scope

- Metadata update for title, description and tags
- Category move for a document
- Explicit rejection of any attempt to change a slug
- `updated_at` maintenance

### Out of Scope

- Uploading new content, which is G3.1
- Category tree operations
- Any slug regeneration under any circumstance

### Read First

- `SPEC.md` §10, §11 metadata paragraph, §18
- `AGENT.md` §5 stable slug, §32
- `src/domain/documents/document-service.ts`

### Files

Create:

- `tests/integration/document-metadata.test.ts`

Modify:

- `src/domain/documents/document-service.ts` (add update and move only)
- `src/api/routes/admin/documents.ts`

Read: `src/domain/categories/category-service.ts`, `src/domain/tags/tag-service.ts`

### Interfaces / Contracts

Produces:

```text
PATCH /api/admin/documents/:slug  { title?, description?, tags? } -> updated document
POST  /api/admin/documents/:slug/move  { categoryId } -> updated document
```

Must not change:

```text
documents.slug — no route, service method or SQL statement in the codebase updates it
```

### Implementation Requirements

1. A request body containing `slug` is rejected with `SLUG_IMMUTABLE`. Ignoring the field silently is not acceptable, because a caller must learn that the operation is impossible.
2. Only supplied fields change. An absent field is untouched; an explicitly empty description is honoured; an empty title is rejected with `TITLE_REQUIRED`.
3. Moving to a non-existent category raises `CATEGORY_NOT_FOUND` and changes nothing.
4. Tag updates go through `TagService.setDocumentTags` so that creation, linking and unlinking stay atomic and consistent with tags created at upload time.
5. `updated_at` changes on any successful update; `created_at` never changes.
6. Neither operation touches R2, creates a version, or changes `current_version_id`.
7. A source-level assertion proves no `UPDATE documents SET slug` statement exists anywhere in the codebase.

### Edge Cases

- Body contains `slug` → `SLUG_IMMUTABLE`
- Title supplied as an empty string → `TITLE_REQUIRED`
- Description supplied as an empty string → accepted, description cleared
- Tags supplied as an empty array → all tags unlinked
- Move to the category the document is already in → succeeds as a no-op, `updated_at` still refreshed
- Move to a non-existent category → `CATEGORY_NOT_FOUND`
- Unknown document slug → `DOCUMENT_NOT_FOUND`
- Concurrent metadata updates → last write wins, no partial tag state

### Tests Required

Positive:

- Title, description and tags update independently and together
- Move relocates the document and updates its category path
- `updated_at` advances

Negative:

- `SLUG_IMMUTABLE` on any slug-bearing body
- `TITLE_REQUIRED` on an empty title
- `CATEGORY_NOT_FOUND` on an unknown target
- Unauthenticated requests rejected

Regression:

- After title change, category move and tag replacement, the slug, the public URL and the current version id are all unchanged
- No version row is created by either operation
- No R2 operation occurs, asserted by spy

### Verification Commands

```bash
pnpm test -- tests/integration/document-metadata.test.ts
grep -rniE "update +documents +set +[^;]*slug" src/ || echo "no slug mutation in source"
```

Expected:

```text
exit 0
grep finds no statement that updates a document slug
```

### Definition of Done

- [ ] Metadata update and move implemented and thin at the route layer
- [ ] `SLUG_IMMUTABLE` returned rather than silently ignoring the field
- [ ] Stable-slug regression test passes across title, tag and category changes
- [ ] No version created and no R2 access, both proven
- [ ] Tag updates atomic through `TagService`
- [ ] Source assertion confirms no slug-mutating SQL exists

### Stop Conditions

- Any requirement implies regenerating a slug
- Tag replacement cannot be made atomic alongside the metadata update

### Suggested Commit

```text
feat(documents): add metadata update and category move with slug immutability
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G2.4 — Public API: Tree, Tags & Filters

### Status

```text
BLOCKED
```

### Goal

Anonymous endpoints exposing the category tree with counts, the tag list with counts, and document listings filtered by category subtree or by tag.

### Why

Browsing is half of the Library promise, and GOAL.md §3 treats browse and search as equally important.

### Dependencies

```text
depends_on: G2.1, G2.2
blocks:     G2.6
can_parallel_with: G2.3
```

### Scope

- `GET /api/public/categories` extended to a full tree with document counts
- `GET /api/public/tags` with counts
- `GET /api/public/documents` extended with `categoryId` and `tag` filters
- Subtree semantics for category filtering

### Out of Scope

- Free-text search, which is G4.1
- Any write path
- Any authentication

### Read First

- `SPEC.md` §14, §18
- `GOAL.md` §5, §6
- `src/api/routes/public/documents.ts`

### Files

Create:

- `tests/integration/public-browse.test.ts`

Modify:

- `src/api/routes/public/categories.ts`, `src/api/routes/public/tags.ts`, `src/api/routes/public/documents.ts`
- `src/domain/documents/document-read.ts`

Read: `src/domain/categories/category-service.ts`

### Interfaces / Contracts

Produces:

```text
GET /api/public/categories -> nested tree with documentCount and descendantDocumentCount
GET /api/public/tags       -> [{ id, name, documentCount }]
GET /api/public/documents?categoryId=…&tag=…&page=…&pageSize=…
```

Must not change:

```text
The pagination contract and ordering established in G1.8
```

### Implementation Requirements

1. Category filtering includes the whole subtree by default, since a reader browsing `Stocks` expects to see documents filed under `Stocks / Thailand`. A `depth=self` parameter narrows it to direct members only.
2. The tree carries both `documentCount` for direct members and `descendantDocumentCount` for the subtree, computed in one recursive query rather than per node.
3. Tag filtering accepts a tag name, matched by normalized name, so a reader-facing URL stays readable.
4. Combining a category filter and a tag filter narrows with AND semantics.
5. Filters reuse the existing pagination and ordering contract without altering it.
6. Empty result sets return an empty page, never a 404.
7. No endpoint here reads R2 or returns HTML body content.

### Edge Cases

- Category with no documents but populated descendants → appears with a zero direct count and a non-zero descendant count
- Unknown `categoryId` → `CATEGORY_NOT_FOUND`
- Unknown tag name → empty page rather than an error, because a tag may simply have no documents
- Tag name supplied with different casing or spacing → matched through normalization
- Both filters supplied with no overlap → empty page
- Deeply nested tree → one recursive query, not N queries

### Tests Required

Positive:

- Tree returns correct direct and descendant counts at every level
- Category filter includes the subtree; `depth=self` excludes it
- Tag filter matches by normalized name
- Combined filters apply AND semantics

Negative:

- Unknown category rejected with the correct code
- Unknown tag returns an empty page, not an error
- Response never contains HTML body content

Regression:

- Pagination and ordering behave exactly as they did in G1.8

### Verification Commands

```bash
pnpm test -- tests/integration/public-browse.test.ts
pnpm typecheck
```

Expected:

```text
exit 0, counts verified against a fixture tree
```

### Definition of Done

- [ ] Tree with direct and descendant counts in a single query
- [ ] Subtree filtering with an explicit `depth=self` option
- [ ] Tag filtering by normalized name
- [ ] Combined filters use AND semantics
- [ ] Pagination contract unchanged
- [ ] No HTML body content and no R2 access

### Stop Conditions

- Descendant counts cannot be computed without N+1 queries
- Filtering requires a schema change

### Suggested Commit

```text
feat(api): add public category tree, tag list and document filters
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G2.5 — Admin UI: Categories, Tags & Document Metadata

### Status

```text
BLOCKED
```

### Goal

Admin screens for managing the category tree, managing tags, and editing a document's metadata and category, with every guard surfaced as a clear message rather than a raw error.

### Why

GOAL.md §10 requires that Admin can grow the category structure without a code change. That promise is only real once there is a screen for it.

### Dependencies

```text
depends_on: G2.1, G2.2, G2.3
blocks:     CHECKPOINT B
can_parallel_with: G2.6
```

### Scope

- `/admin/categories`: tree view with create, rename, move and delete
- `/admin/tags`: list with create, rename, merge and delete
- `/admin/documents/:slug`: edit title, description, tags and category
- Human-readable handling of every guard error

### Out of Scope

- Version history screens, which are G3.5
- Any public-facing screen
- Drag-and-drop reordering beyond a simple move control

### Read First

- `SPEC.md` §18, §24, §25
- `AGENT.md` §22, §24
- `src/app/lib/api-client.ts`

### Files

Create:

- `src/app/routes/admin/categories.tsx`, `src/app/routes/admin/tags.tsx`, `src/app/routes/admin/document-edit.tsx`
- `src/app/features/categories/CategoryTree.tsx`, `src/app/features/tags/TagTable.tsx`
- `tests/browser/admin-categories.spec.ts`, `tests/browser/admin-tags.spec.ts`

Modify:

- `src/app/routes/admin/documents.tsx` (link to the edit screen only)

Read: `src/shared/errors.ts`

### Interfaces / Contracts

Consumes:

```text
All admin category, tag and document metadata endpoints
```

Must not change:

```text
The admin bundle stays lazily loaded and out of the public entry
```

### Implementation Requirements

1. Every domain guard has a specific message: a cycle attempt explains that a category cannot be moved inside itself; a non-empty delete explains what is still inside and offers to navigate there.
2. Destructive actions require explicit confirmation, and the confirmation names the exact object.
3. The tree view supports arbitrary depth with indentation and keeps the operator's expansion state during an operation.
4. Merging tags shows both the source and the target and states how many documents will be affected before confirming.
5. Every action is reachable without hover, satisfying the mobile requirement.
6. After any mutation the affected data is refetched rather than optimistically patched, because these operations have server-side guards whose outcome the client cannot predict.
7. The document edit screen shows the slug as read-only with a short explanation that it is permanent.

### Edge Cases

- Moving a category into its own descendant → guard message, tree unchanged
- Deleting a non-empty category → message naming the blocking children or documents
- Merging a tag into itself → control disabled with an explanation
- Renaming a tag into an existing one → conflict explained, with merge offered as the alternative
- Session expiry mid-operation → return to login, then back to the same screen
- A category deleted in another tab → refetch shows it is gone rather than failing silently
- A tree 10 levels deep → still navigable at 375 pixels

### Tests Required

Positive:

- Create a nested category from the UI and file a document into it
- Rename and move a category
- Create, rename and merge tags
- Edit a document's title, description, tags and category

Negative:

- Cycle attempt shows the guard message and leaves the tree unchanged
- Non-empty delete shows the guard message
- No destructive action proceeds without confirmation
- No action requires hover, verified at 375 pixels

Regression:

- Editing a document's metadata leaves its slug and public URL unchanged, verified end to end in the browser

### Verification Commands

```bash
pnpm test:browser -- tests/browser/admin-categories.spec.ts tests/browser/admin-tags.spec.ts
pnpm build
```

Expected:

```text
exit 0 at 375, 768 and 1440
```

### Definition of Done

- [ ] Category tree fully manageable from the UI at arbitrary depth
- [ ] Tags creatable, renamable, mergeable and deletable from the UI
- [ ] Document metadata and category editable, slug shown read-only
- [ ] Every guard surfaced as a specific, actionable message
- [ ] Confirmation required for every destructive action
- [ ] No hover-only action, verified at 375 pixels
- [ ] Slug stability verified through the browser, not only through the API

### Stop Conditions

- A guard cannot be explained clearly because the API does not say why it failed
- Tree management is unusable at 375 pixels without a different interaction model

### Suggested Commit

```text
feat(admin): add category tree, tag management and document metadata screens
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G2.6 — Public UI: Category Browse & Tag Filter

### Status

```text
BLOCKED
```

### Goal

Anonymous browsing of the library by category path and by tag, with URLs that are shareable and readable.

### Why

Browse is the half of discovery that does not depend on knowing what to type, and it is the reason the category tree exists at all.

### Dependencies

```text
depends_on: G2.4
blocks:     CHECKPOINT B
can_parallel_with: G2.5
```

### Scope

- `/category/*` routes reflecting the category path
- Category sidebar or drawer on the Library page
- Tag chips on document cards and on the Reader header, linking to a filtered listing
- Breadcrumb showing the current category path

### Out of Scope

- The search box, which is G4.2
- Any admin capability
- Infinite scrolling

### Read First

- `SPEC.md` §14, §25
- `GOAL.md` §5, §7
- `AGENT.md` §22, §24

### Files

Create:

- `src/app/routes/category.tsx`
- `src/app/features/browse/CategorySidebar.tsx`, `src/app/features/browse/TagChips.tsx`, `src/app/components/Breadcrumb.tsx`
- `tests/browser/public-browse.spec.ts`

Modify:

- `src/app/routes/library.tsx`, `src/app/routes/reader.tsx` (tag chips only)

Read: `src/app/lib/api-client.ts`

### Interfaces / Contracts

Consumes:

```text
GET /api/public/categories
GET /api/public/tags
GET /api/public/documents?categoryId=…&tag=…
```

Produces:

```text
/category/stocks/thailand   -> subtree listing
/?tag=valuation             -> tag-filtered listing
```

Must not change:

```text
The Reader route and its iframe contract
```

### Implementation Requirements

1. The category route mirrors the human-readable slug path, so a shared link communicates where the reader is.
2. An unknown category path renders a not-found state with a route back to the Library, not a blank list.
3. On desktop the category tree is a sidebar; on mobile it collapses into a drawer, since a permanent sidebar would shrink the reading area.
4. Tag chips link to a filtered listing and are keyboard reachable.
5. The breadcrumb reflects the full path from root and every level is clickable.
6. Listing pages are paginated with explicit controls rather than infinite scroll, so a reader can return to a position.
7. Browsing performs no request per card and no request per tag; the tree and the tag list are each fetched once per page.

### Edge Cases

- Category with only descendant documents → shows the subtree listing rather than an empty page
- Empty category → explanatory empty state
- Unknown category path → not-found state
- Tag with no documents → empty state, not an error
- Very deep path at 375 pixels → breadcrumb truncates from the middle, keeping root and current level
- Direct navigation to a filtered URL → renders correctly without first visiting the Library

### Tests Required

Positive:

- Browsing to a nested category shows its subtree documents
- Breadcrumb navigation moves up correctly
- Tag chip navigates to a filtered listing
- Deep link to a filtered URL renders directly

Negative:

- Unknown category path renders the not-found state
- Empty results render an empty state rather than an error
- No admin chunk is requested during browsing

Regression:

- The Reader still renders the fixture correctly after the tag chips are added to its header

### Verification Commands

```bash
pnpm test:browser -- tests/browser/public-browse.spec.ts
pnpm build
```

Expected:

```text
exit 0 at 375, 768 and 1440
```

### Definition of Done

- [ ] Category routes browsable and shareable at any depth
- [ ] Sidebar on desktop, drawer on mobile
- [ ] Tag chips filter the listing and are keyboard reachable
- [ ] Breadcrumb complete and clickable
- [ ] Empty and not-found states implemented
- [ ] No per-card or per-tag request
- [ ] Public browsing loads no admin code

### Stop Conditions

- Slug-path routing cannot resolve a category unambiguously
- The mobile drawer cannot be implemented without a new dependency

### Suggested Commit

```text
feat(app): add public category browsing and tag filtering
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G3.1 — Update Document & Version History

### Status

```text
BLOCKED
```

### Goal

Uploading new bytes for an existing slug creates a new immutable version and moves the current pointer, identical bytes return `UNCHANGED` without writing anything, and the full version history is readable.

### Why

This is the promise that makes Alexandria worth using: a report can be revised without its link ever changing. It is also where an accidental overwrite of the current R2 object would destroy history irrecoverably.

### Dependencies

```text
depends_on: CHECKPOINT B
blocks:     G3.2, G3.4
can_parallel_with: —
```

### Scope

- `POST /api/admin/documents/:slug/versions` accepting a new HTML file
- `GET /api/admin/documents/:slug/versions` listing history
- `UNCHANGED` detection by SHA-256 comparison against the current version
- Reuse of `VersionService.appendVersion` from G1.5 without changing its contract

### Out of Scope

- Restore and version deletion, which are G3.2
- Document deletion, which is G3.3
- Signed preview URLs, which are G3.4
- Any admin screen

### Read First

- `SPEC.md` §11, §12, §18, §24
- `AGENT.md` §5 immutable version, §32
- `src/domain/versions/version-service.ts`

### Files

Create:

- `tests/integration/document-update.test.ts`

Modify:

- `src/domain/versions/version-service.ts` (add history reading and update orchestration)
- `src/api/routes/admin/versions.ts`

Read: `src/domain/documents/document-service.ts`

### Interfaces / Contracts

Produces:

```text
POST /api/admin/documents/:slug/versions
  multipart: file, note?
  201 -> { versionId, versionNo, unchanged: false, url }
  200 -> { unchanged: true, versionId: <current>, versionNo: <current> }

GET /api/admin/documents/:slug/versions
  200 -> { versions: [{ versionNo, versionId, sizeBytes, sha256, createdBy,
                        createdAt, note, restoredFromVersionNo, isCurrent }] }
```

Must not change:

```text
The R2 object of any existing version
The document slug
VersionService.appendVersion's signature
```

### Implementation Requirements

1. The update path never writes to an existing R2 key. A new `version_id` is generated for every accepted upload, which makes overwriting structurally impossible rather than merely forbidden.
2. The incoming file passes the same validation chain as a create, since a bad update is as damaging as a bad create.
3. SHA-256 is compared against the current version only. Matching an older, non-current version still creates a new version, because the document's current content genuinely changes.
4. `UNCHANGED` returns HTTP 200 with `unchanged: true` and creates no R2 object, no version row and no `updated_at` change.
5. On success, the D1 batch inserts the version, updates `current_version_id` and refreshes `updated_at`. The same R2-then-D1 ordering and the same compensation as G1.5 apply.
6. The optional note is stored on the version row, capped at 500 characters.
7. History is ordered newest first and flags the current version. It never includes HTML body content.
8. Metadata is not touched by an update unless explicitly supplied, per SPEC §11.

### Edge Cases

- Identical bytes re-uploaded → `UNCHANGED`, nothing written
- Bytes matching version 1 while version 3 is current → new version 4 created
- Update to an unknown slug → `DOCUMENT_NOT_FOUND`
- Invalid HTML on update → same validation errors as create, current version untouched
- D1 failure during update → new R2 object cleaned up, current pointer still on the old version
- Two concurrent updates → both produce distinct version numbers, one of them ends up current, no number is reused
- Document whose current version was created by an agent, updated by admin → `created_by` recorded per version
- Note longer than 500 characters → validation error

### Tests Required

Positive:

- Update creates version 2 and moves the current pointer
- Public URL and slug unchanged after update
- History lists both versions with the correct current flag
- Note stored and returned

Negative:

- Identical bytes return `UNCHANGED` with no writes, asserted against both D1 and R2
- Unknown slug rejected
- Invalid file rejected without touching the current version
- Injected D1 failure leaves the old version current and removes the new R2 object
- Unauthenticated update rejected

Regression:

- The version 1 R2 object is byte-identical before and after the update
- No R2 key is ever reused, asserted across 20 sequential updates

### Verification Commands

```bash
pnpm test -- tests/integration/document-update.test.ts
pnpm typecheck
```

Expected:

```text
exit 0
sha256 of version 1's object unchanged after 20 updates
```

### Definition of Done

- [ ] Update creates a new immutable version and moves the pointer
- [ ] `UNCHANGED` path writes nothing anywhere, proven against both stores
- [ ] Public URL and slug provably unchanged
- [ ] History endpoint complete, ordered and free of body content
- [ ] Compensation behaviour matches G1.5 exactly
- [ ] No existing R2 object is ever overwritten, proven across repeated updates

### Stop Conditions

- `appendVersion` cannot support update without a contract change
- Hash comparison cannot be done without buffering beyond Worker limits

### Suggested Commit

```text
feat(versions): add document update with immutable versioning and history
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G3.2 — Restore & Version Delete Guards

### Status

```text
BLOCKED
```

### Goal

Restoring an old version appends a new highest version created from the old bytes, and version deletion is refused for the current version and for the last remaining version.

### Why

Append-only restore is what makes history trustworthy. If restore rewound the pointer, the record of what was published when would be silently falsified.

### Dependencies

```text
depends_on: G3.1
blocks:     G3.3, G3.5
can_parallel_with: G3.4
```

### Scope

- `POST /api/admin/documents/:slug/restore/:versionNo`
- `DELETE /api/admin/documents/:slug/versions/:versionNo`
- `restored_from_version_no` bookkeeping
- The two delete guards and their error codes

### Out of Scope

- Document deletion, which is G3.3
- Any agent-reachable restore or delete, which is permanently forbidden
- Any admin screen

### Read First

- `SPEC.md` §12, §13, §24
- `GOAL.md` §4
- `AGENT.md` §5 restore append-only, §6, §29
- `src/domain/versions/version-service.ts`

### Files

Create:

- `tests/integration/version-restore.test.ts`, `tests/integration/version-delete.test.ts`

Modify:

- `src/domain/versions/version-service.ts`
- `src/api/routes/admin/versions.ts`

Read: `src/domain/versions/r2-keys.ts`

### Interfaces / Contracts

Produces:

```text
POST   /api/admin/documents/:slug/restore/:versionNo
       201 -> { versionId, versionNo, restoredFromVersionNo }
DELETE /api/admin/documents/:slug/versions/:versionNo
       200 -> { deletedVersionNo }
       403 -> VERSION_IS_CURRENT | LAST_VERSION_CANNOT_DELETE
```

Must not change:

```text
current_version_id never points at a lower version number than it did before
```

### Implementation Requirements

1. Restore reads the source version's bytes from R2, writes them to a **new** R2 key under a new `version_id`, inserts a new version with the next `version_no`, sets `restored_from_version_no` to the source number, and moves the current pointer forward.
2. Restore never mutates, re-keys or deletes the source version.
3. If the restored bytes are identical to the current version's bytes, restore still creates a new version, because restoring is an explicit editorial act and history must record it. This is a deliberate divergence from the `UNCHANGED` rule that applies to uploads, and it is documented in code.
4. Deleting the current version raises `VERSION_IS_CURRENT`.
5. Deleting the only remaining version raises `LAST_VERSION_CANNOT_DELETE`, checked before the current-version check so the error is the more specific one when both apply.
6. A permitted version deletion removes the D1 row and then deletes the R2 object best-effort; a failed R2 delete logs `document_id`, `version_id` and the key, and still reports success, because the metadata is authoritative.
7. Version numbers are never renumbered after a deletion. Gaps in the sequence are expected and correct.
8. Neither operation exists on any agent route, asserted by a route-inventory test.

### Edge Cases

- Restore version 2 while version 4 is current → version 5 created with `restored_from_version_no = 2`
- Restore the current version → new version created, pointer advances, history records it
- Restore a non-existent version number → `VERSION_NOT_FOUND`
- Restore when the source R2 object is missing → `R2_READ_FAILED`, nothing written
- Delete the current version → `VERSION_IS_CURRENT`
- Delete the only version → `LAST_VERSION_CANNOT_DELETE`
- Delete version 2 of five → succeeds, leaving a numbering gap
- Delete a version whose R2 object is already gone → succeeds, logs the orphan
- Restore immediately after a delete that created a gap → next number still follows the maximum, not the count

### Tests Required

Positive:

- Restore appends, sets `restored_from_version_no`, and advances the pointer
- Restored bytes are byte-identical to the source version
- Deleting a non-current, non-last version succeeds and leaves a gap

Negative:

- Current-version delete rejected with `VERSION_IS_CURRENT`
- Last-version delete rejected with `LAST_VERSION_CANNOT_DELETE`
- Both guards enforced when a document has exactly one version
- Unknown version number rejected
- No agent route exposes restore or version deletion, asserted by route inventory
- Unauthenticated calls rejected

Regression:

- After restore, the source version row and its R2 object are unchanged
- `current_version_id` never moves to a lower version number across a full restore and delete sequence

### Verification Commands

```bash
pnpm test -- tests/integration/version-restore.test.ts tests/integration/version-delete.test.ts
pnpm typecheck
```

Expected:

```text
exit 0
pointer-monotonicity assertion passes across a 10 operation sequence
```

### Definition of Done

- [ ] Restore is append-only and records its source version
- [ ] Restored bytes byte-identical to the source
- [ ] Source version untouched by restore
- [ ] Both delete guards enforced with the specified codes and precedence
- [ ] Version numbering never reused and never renumbered
- [ ] R2 orphans logged with identifiers when cleanup fails
- [ ] No agent-reachable restore or delete exists

### Stop Conditions

- Restore cannot read source bytes without buffering beyond Worker limits
- The guard precedence contradicts SPEC §13 on a case found in practice

### Suggested Commit

```text
feat(versions): add append-only restore and guarded version deletion
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G3.3 — Delete Document & R2 Cleanup

### Status

```text
BLOCKED
```

### Goal

Admin can permanently delete a document, removing its metadata, versions and tag links from D1 and best-effort removing every R2 object, with any failed cleanup logged for later reconciliation.

### Why

This is the only irreversible operation in Phase 1. It needs explicit confirmation, a defined orphan policy, and no possibility of leaving metadata that points at nothing.

### Dependencies

```text
depends_on: G3.2
blocks:     G3.5
can_parallel_with: G3.4
```

### Scope

- `DELETE /api/admin/documents/:slug` with explicit confirmation
- Cascade removal of versions and tag links
- Best-effort deletion of every R2 object belonging to the document
- Structured logging of `document_id` and any keys that could not be deleted

### Out of Scope

- Soft delete, trash, or undo
- Any agent-reachable deletion, which is permanently forbidden
- Cleaning up orphan objects from earlier failures, which is an operational task, not a feature

### Read First

- `SPEC.md` §13, §24
- `AGENT.md` §6, §12
- Decision D3 in the approved design
- `src/domain/documents/document-service.ts`

### Files

Create:

- `tests/integration/document-delete.test.ts`

Modify:

- `src/domain/documents/document-service.ts`
- `src/api/routes/admin/documents.ts`

Read: `src/domain/versions/version-service.ts`

### Interfaces / Contracts

Produces:

```text
DELETE /api/admin/documents/:slug   body: { confirmSlug: string }
  200 -> { deleted: true, documentId, versionsDeleted, r2ObjectsDeleted, r2ObjectsFailed }
  400 -> confirmation mismatch
```

Must not change:

```text
Deletion order: D1 first, R2 second. Metadata must never survive its objects.
```

### Implementation Requirements

1. The request body must contain `confirmSlug` exactly equal to the target slug. A mismatch is a validation error and nothing is deleted.
2. D1 rows are removed first, in one batch, relying on the schema's cascade for versions and tag links. Only after that succeeds are R2 objects deleted.
3. This ordering is deliberate and is the mirror image of the create path: on create, an orphaned object is preferable to dangling metadata, and the same preference applies here.
4. Every version's R2 key is collected before the D1 delete, since the rows are the only record of those keys.
5. R2 deletion is best-effort. Failures are counted and logged in one structured line containing `document_id` and every failed key, and the response reports the counts honestly rather than claiming complete success.
6. Tags left with no documents are not deleted automatically, since a tag is independent of any single document.
7. The category is never modified by a document deletion.
8. No agent route can reach this operation, asserted by route inventory.

### Edge Cases

- `confirmSlug` missing or wrong → nothing deleted
- Document with 12 versions → all rows and all objects removed
- Document whose R2 objects are already gone → succeeds, reports the failures honestly
- R2 delete failure for 3 of 12 objects → metadata deleted, 3 keys logged, response reports 3 failures
- Deleting the only document in a category → the category remains and becomes empty
- Deleting a document that is the only user of a tag → the tag survives with a zero count
- Unknown slug → `DOCUMENT_NOT_FOUND`
- Concurrent delete of the same document → the second returns `DOCUMENT_NOT_FOUND` rather than failing loudly

### Tests Required

Positive:

- Delete removes the document, all versions and all tag links
- All R2 objects for the document are removed
- Response reports accurate counts

Negative:

- Wrong or missing `confirmSlug` deletes nothing
- Unknown slug rejected
- Unauthenticated delete rejected
- No agent route exposes document deletion, asserted by route inventory
- Injected R2 delete failure still removes metadata, logs the failed keys and reports the failure count

Regression:

- The category and any shared tags survive the deletion
- No other document's versions or objects are affected

### Verification Commands

```bash
pnpm test -- tests/integration/document-delete.test.ts
pnpm typecheck
```

Expected:

```text
exit 0
orphan-logging assertion finds document_id and every failed key in one structured line
```

### Definition of Done

- [ ] Deletion requires an exact slug confirmation
- [ ] D1 cascade removes versions and tag links
- [ ] Every R2 object attempted, failures counted and logged with identifiers
- [ ] Response reports honest counts rather than assumed success
- [ ] Category and shared tags unaffected
- [ ] No agent-reachable deletion exists

### Stop Conditions

- Version keys cannot be collected reliably before the cascade
- Cascade behaviour differs from the schema's declared intent

### Suggested Commit

```text
feat(documents): add confirmed document deletion with best-effort r2 cleanup
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G3.4 — Signed Historical Preview URLs

### Status

```text
BLOCKED
```

### Goal

Admin can preview any non-current version through a short-lived signed URL on the content origin, while non-current versions remain unreachable to the public.

### Why

Previewing history is required by GOAL.md §3, but exposing every past version at a guessable address would publish content the operator has already replaced. The signature is what keeps history private without giving the content Worker any privileged state.

### Dependencies

```text
depends_on: G3.1
blocks:     G3.5
can_parallel_with: G3.2, G3.3
```

### Scope

- HMAC signing utility shared by both Workers
- App-side issuance endpoint returning a signed preview URL for a specific version
- Content Worker route `/p/:documentId/:versionId` verifying the signature before streaming
- `CONTENT_PREVIEW_SIGNING_SECRET` binding added to the content Worker

### Out of Scope

- Any change to `/d/:slug`, which stays public, unsigned and cacheable
- Any admin screen
- Any signed access for the Agent

### Read First

- `SPEC.md` §16, §17, §24
- `AGENT.md` §8, §13
- Decision D1 in the approved design
- `src/content/handler.ts`

### Files

Create:

- `src/shared/signing.ts`
- `tests/integration/preview-signing.test.ts`

Modify:

- `src/content/handler.ts`, `wrangler.content.jsonc`
- `src/api/routes/admin/versions.ts`

Read: `src/shared/token.ts`

### Interfaces / Contracts

Produces:

```text
GET /api/admin/documents/:slug/versions/:versionNo/preview-url
  200 -> { url, expiresAt }     // url points at the content origin

Content Worker:
GET /p/:documentId/:versionId?exp=<unix>&sig=<hex>
  200 -> original bytes, Cache-Control: private, no-store
  403 -> expired or invalid signature
```

Must not change:

```text
The content Worker remains strictly read-only and holds no admin or agent secret.
The public /d/:slug route is unaffected.
```

### Implementation Requirements

1. The signature covers `documentId`, `versionId` and `exp` together, so a signature issued for one version cannot be replayed for another.
2. Default lifetime is 5 minutes, configurable, and the content Worker rejects anything expired with no grace period.
3. Verification uses a constant-time comparison; a mismatch reveals nothing about why.
4. The secret never appears in the URL, in a log, in an error message, or in any response body.
5. The content Worker gains exactly one new binding, `CONTENT_PREVIEW_SIGNING_SECRET`. The G1.9 assertion that it holds no `ADMIN_PASSWORD`, `ADMIN_SESSION_SIGNING_SECRET` or `AGENT_API_KEY` continues to hold and is re-run.
6. Preview responses are marked `Cache-Control: private, no-store` so a historical version is never cached at the edge or in a shared cache.
7. Issuing a preview URL requires an admin token; the resulting URL is the only thing that crosses to the content origin, and it carries no session material.
8. The read-only source assertion for the content Worker is re-run and must still pass after this change.

### Edge Cases

- Expired signature → 403
- Signature valid but for a different `versionId` → 403
- Signature valid but for a different `documentId` → 403
- Tampered `exp` → 403, since `exp` is inside the signed payload
- Missing `sig` or `exp` → 403
- Preview requested for the current version → allowed, since Admin may legitimately compare
- Version exists in D1 but its R2 object is missing → 404 with the failure logged
- Clock skew → no grace period, documented as intentional

### Tests Required

Positive:

- A freshly issued URL streams the correct historical bytes
- The bytes match that version's stored sha256
- The response is marked private and not cacheable

Negative:

- Expired, tampered, cross-version and cross-document signatures all rejected with 403
- Unsigned access to `/p/...` rejected
- Issuing a preview URL without an admin token rejected
- The content Worker still declares no admin or agent secret
- The content Worker still contains no mutation statement

Regression:

- `/d/:slug` behaviour, headers and caching are unchanged

### Verification Commands

```bash
pnpm test -- tests/integration/preview-signing.test.ts tests/integration/content-worker-readonly.test.ts
grep -riE "insert |update |delete " src/content/ || echo "content worker still read-only"
```

Expected:

```text
exit 0
all four signature-rejection cases return 403
```

### Definition of Done

- [ ] Signature binds document, version and expiry together
- [ ] Five minute default lifetime with no grace period
- [ ] Constant-time verification
- [ ] Historical previews never cached in a shared cache
- [ ] Content Worker still holds no admin or agent secret and no mutation path
- [ ] Public `/d/:slug` behaviour unchanged
- [ ] Secret never present in a URL, log or response

### Stop Conditions

- Signature verification would require the content Worker to read privileged state
- SPEC's intended use of `CONTENT_PREVIEW_SIGNING_SECRET` conflicts with this design

### Suggested Commit

```text
feat(content): add signed short-lived preview urls for historical versions
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G3.5 — Admin UI: Version History

### Status

```text
BLOCKED
```

### Goal

An admin screen showing a document's full version history, with update, preview, restore and delete actions, each guard and each irreversible step surfaced clearly.

### Why

Versioning is only useful if the operator can see and act on it. This screen is also where an accidental destructive click must be made hard.

### Dependencies

```text
depends_on: G3.2, G3.3, G3.4
blocks:     CHECKPOINT C
can_parallel_with: —
```

### Scope

- Version history table on `/admin/documents/:slug`
- Upload-new-version control with an optional note
- Preview of a historical version through the signed URL
- Restore with confirmation
- Version delete with confirmation and disabled states for guarded versions
- Document delete with slug confirmation

### Out of Scope

- Any diff or comparison view
- Any public-facing history
- Bulk operations

### Read First

- `SPEC.md` §11, §12, §13, §25
- `AGENT.md` §22, §24
- `src/app/routes/admin/document-edit.tsx`

### Files

Create:

- `src/app/features/versions/VersionTable.tsx`, `src/app/features/versions/VersionPreview.tsx`
- `tests/browser/admin-versions.spec.ts`

Modify:

- `src/app/routes/admin/document-edit.tsx`

Read: `src/app/lib/api-client.ts`

### Interfaces / Contracts

Consumes:

```text
GET    /api/admin/documents/:slug/versions
POST   /api/admin/documents/:slug/versions
POST   /api/admin/documents/:slug/restore/:versionNo
DELETE /api/admin/documents/:slug/versions/:versionNo
DELETE /api/admin/documents/:slug
GET    /api/admin/documents/:slug/versions/:versionNo/preview-url
```

Must not change:

```text
The preview iframe uses the same sandbox contract as the Reader
```

### Implementation Requirements

1. The current version is visually distinct, and its delete control is disabled with an explanation rather than hidden, so the rule is learnable.
2. When only one version exists, its delete control is disabled with the last-version explanation.
3. Restore states plainly that it will create a new version rather than rewind, and names the source version in the confirmation.
4. Historical preview opens in a sandboxed iframe using a freshly requested signed URL, never a stored one, so an expired link is never reused.
5. Document deletion requires typing the slug, matching the API contract.
6. An `UNCHANGED` result from an upload is reported as a clear, non-alarming outcome, not as an error.
7. The table shows version number, created by, size, timestamp, note and restore provenance.
8. All controls are reachable without hover and usable at 375 pixels.

### Edge Cases

- Upload of identical bytes → `UNCHANGED` message, table unchanged
- Preview link expiring while open → re-request rather than showing a broken frame
- Restore of the current version → allowed, explained, history shows the new entry
- Delete attempt on the current version → control disabled with a reason
- Single-version document → delete disabled with the last-version reason
- Numbering gap after a deletion → displayed as-is, not renumbered
- Session expiry mid-operation → login, then return to the same document
- Very long note → truncated with the full text available

### Tests Required

Positive:

- Upload a new version and see the table grow with the current flag moving
- Preview a historical version inside the sandboxed frame
- Restore and see a new highest version appear with its provenance
- Delete a non-current version and see the numbering gap remain

Negative:

- Current-version delete control disabled with an explanation
- Last-version delete control disabled with an explanation
- Document deletion refuses to proceed until the slug is typed correctly
- `UNCHANGED` reported as an outcome rather than an error
- Preview frame carries the same sandbox attribute as the Reader, without `allow-same-origin`

Regression:

- The public Reader still shows the current version after every operation performed on this screen

### Verification Commands

```bash
pnpm test:browser -- tests/browser/admin-versions.spec.ts
pnpm build
```

Expected:

```text
exit 0 at 375, 768 and 1440
```

### Definition of Done

- [ ] History table complete with provenance and current-version marking
- [ ] Upload, preview, restore and both delete paths usable from the UI
- [ ] Guarded actions disabled with visible explanations, not hidden
- [ ] Preview always uses a freshly issued signed URL
- [ ] Document deletion requires typing the slug
- [ ] `UNCHANGED` presented as an outcome
- [ ] Usable at 375 pixels with no hover-only control

### Stop Conditions

- A signed preview cannot be rendered inside the sandbox without weakening it
- A guard cannot be explained because the API does not report which rule blocked the action

### Suggested Commit

```text
feat(admin): add version history screen with preview, restore and delete
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G4.1 — Metadata Search Service & Public Search API

### Status

```text
BLOCKED
```

### Goal

Deterministic metadata search across title, description, category and tags that works correctly for Thai and English, returns paginated results, and never touches document body content.

### Why

Search is the other half of discovery. It must be built on substring matching rather than a word-boundary tokenizer, because Thai text has no spaces between words and would collapse into a single unusable token.

### Dependencies

```text
depends_on: CHECKPOINT C
blocks:     G4.2
can_parallel_with: —
```

### Scope

- `MetadataSearchService.search(query, filters, pagination)`
- `GET /api/public/documents` extended with a `q` parameter
- Case-insensitive and accent-insensitive matching for Latin text, exact substring matching for Thai
- Result ordering by relevance tier, then recency

### Out of Scope

- SQLite FTS5, embeddings, semantic search, or any AI-assisted ranking
- Searching HTML body content
- A denormalized search column, which would only be justified by measured slowness
- Any Dria retrieval concept

### Read First

- `SPEC.md` §14, §15, §18
- `GOAL.md` §6
- `AGENT.md` §15, §25
- Decision D2 in the approved design

### Files

Create:

- `src/domain/search/metadata-search-service.ts`
- `tests/integration/search.test.ts`

Modify:

- `src/api/routes/public/documents.ts`

Read: `src/domain/documents/document-read.ts`

### Interfaces / Contracts

Produces:

```text
GET /api/public/documents?q=…&categoryId=…&tag=…&page=…&pageSize=…
  200 -> { items: [...], page, pageSize, total, query }
```

Must not change:

```text
The existing pagination, filtering and ordering contracts
No response in this group ever contains HTML body bytes
```

### Implementation Requirements

1. Matching uses `LIKE '%' || ? || '%'` on lower-cased values across title, description, category name and tag name. FTS5 is explicitly rejected because its tokenizer cannot segment Thai, which would make a Thai query match nothing.
2. The query string is passed as a bound parameter. `%` and `_` in user input are escaped so a query containing them is treated literally.
3. Latin input is lower-cased and stripped of accents before comparison, and the stored comparison values are prepared the same way, so `Résumé` matches `resume`.
4. Thai input is matched as an exact substring without normalization, since case and accents do not apply.
5. Results are ordered by a relevance tier — title match first, then tag, then category, then description — and by `updated_at DESC` within a tier, so ordering is deterministic and explainable.
6. A document matching in several fields appears once, not once per match.
7. Query length is capped at 200 characters; an empty or whitespace-only query behaves exactly like the unfiltered listing rather than returning nothing.
8. Search combines with the existing category and tag filters using AND semantics.
9. No denormalized column and no additional index is added at this stage. If search measures slow on a realistic corpus, that is reported as a finding for a future node rather than optimized speculatively.

### Edge Cases

- Thai query such as `มูลค่า` matching a Thai title → found
- Mixed Thai and English query → substring semantics apply uniformly
- Query containing `%` or `_` → treated literally, not as a wildcard
- Query matching a tag but not a title → found, ranked below title matches
- Query matching two fields of one document → returned once
- Empty or whitespace-only query → full listing
- 200-character query → accepted; longer → validation error
- Query with leading and trailing spaces → trimmed
- Search combined with a category filter that excludes every match → empty page

### Tests Required

Positive:

- Title, description, category and tag matches each found
- Thai substring query finds a Thai-titled document
- Accent-insensitive Latin matching
- Relevance tier ordering verified with a crafted corpus
- Search combined with category and tag filters

Negative:

- `%` and `_` treated literally
- Over-length query rejected
- Duplicate results impossible for multi-field matches
- No HTML body content in any response, asserted against the fixture's marker text
- No R2 access during search, asserted by spy

Regression:

- Unfiltered listing behaviour identical to G1.8 when `q` is absent

### Verification Commands

```bash
pnpm test -- tests/integration/search.test.ts
pnpm typecheck
grep -rn "fts5\|FTS5\|MATCH " src/domain/search/ || echo "no fts5 usage"
```

Expected:

```text
exit 0
Thai query test passes
grep confirms no FTS5 usage
```

### Definition of Done

- [ ] Substring search across all four metadata fields
- [ ] Thai query proven to work by test
- [ ] Wildcard characters escaped and treated literally
- [ ] Deterministic relevance tier plus recency ordering
- [ ] No duplicate rows for multi-field matches
- [ ] Combines correctly with existing filters and pagination
- [ ] No FTS5, no embeddings, no body-content search
- [ ] No speculative denormalization added

### Stop Conditions

- `LIKE` cannot express accent-insensitive matching without a new dependency
- Search measures unacceptably slow on a realistic corpus, which is a finding to report rather than a licence to redesign

### Suggested Commit

```text
feat(search): add metadata search with thai-safe substring matching
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G4.2 — Library UI: Search, Pagination & Recently Updated

### Status

```text
BLOCKED
```

### Goal

The Library home becomes a working discovery surface: a search box, paginated results, a recently-updated section, and shareable URLs that carry the query and page.

### Why

SPEC §14 describes this page as search plus categories plus recently updated. Until it exists, the library is navigable only by knowing what is already there.

### Dependencies

```text
depends_on: G4.1
blocks:     CHECKPOINT D
can_parallel_with: —
```

### Scope

- Search input with debounced querying and a clear control
- URL-synchronized query, filters and page
- Paginated results with explicit controls
- Recently updated section when no query is active
- Result count and empty state

### Out of Scope

- Search suggestions, autocomplete or history
- Infinite scroll
- Any admin surface
- Any AI-assisted discovery

### Read First

- `SPEC.md` §14, §25
- `TECHSTACK.md` §22
- `AGENT.md` §24, §25

### Files

Create:

- `src/app/features/search/SearchBox.tsx`, `src/app/components/Pagination.tsx`
- `tests/browser/library-search.spec.ts`

Modify:

- `src/app/routes/library.tsx`, `src/app/routes/category.tsx`

Read: `src/app/lib/api-client.ts`

### Interfaces / Contracts

Consumes:

```text
GET /api/public/documents?q=…&categoryId=…&tag=…&page=…&pageSize=…
```

Produces:

```text
/?q=valuation&page=2   -> shareable, restores exactly the same view
```

Must not change:

```text
The Reader route and the browsing routes from G2.6
```

### Implementation Requirements

1. Query, filters and page live in the URL, so a result view can be shared and restored, and the browser back button behaves as a reader expects.
2. Input is debounced at roughly 250 milliseconds, and an in-flight request is cancelled when a newer one starts, so results never arrive out of order.
3. When no query is active, the page shows the recently updated section; when a query is active, it shows ranked results with a count.
4. The empty state distinguishes an empty library from a query with no matches, because those need different next actions.
5. Pagination controls state the current page and total, and remain usable at 375 pixels.
6. No search request fires on page load when no query is present, so browsing costs one listing request, not two.
7. Search results reuse the same document card as browsing, so the two surfaces stay visually consistent.

### Edge Cases

- Typing quickly → one request per pause, no result flicker from an out-of-order response
- Query with no matches → distinct empty state offering to clear the query
- Empty library → distinct empty state
- Deep link to `?q=…&page=3` → renders directly with the correct page
- Query cleared → returns to the recently updated view without a full reload
- Page beyond the last → shows the empty state with working navigation back
- Thai query typed with an IME → debounce does not fire mid-composition

### Tests Required

Positive:

- Typing a query filters results and updates the URL
- Deep link restores query, filters and page
- Recently updated shows when no query is active
- Pagination navigates and preserves the query

Negative:

- No-match state distinct from empty-library state
- No search request fires when the page loads without a query
- Out-of-order responses never render, verified by delaying one response
- No admin chunk requested

Regression:

- Category browsing and the Reader continue to work unchanged

### Verification Commands

```bash
pnpm test:browser -- tests/browser/library-search.spec.ts
pnpm build
```

Expected:

```text
exit 0 at 375, 768 and 1440
```

### Definition of Done

- [ ] Search box with debounce and cancellation of superseded requests
- [ ] Query, filters and page synchronized to the URL and shareable
- [ ] Recently updated section when idle
- [ ] Distinct empty states for no-match and empty-library
- [ ] Pagination usable at 375 pixels
- [ ] No redundant request on load
- [ ] Browsing and Reader unaffected

### Stop Conditions

- The search contract from G4.1 cannot support the URL-synchronized view
- IME composition cannot be handled without a new dependency

### Suggested Commit

```text
feat(app): add library search, pagination and recently updated sections
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G5.1 — Agent Auth & Agent API Routes

### Status

```text
BLOCKED
```

### Goal

The complete Agent HTTP surface — exactly the nine non-destructive operations — authenticated by `Authorization: Bearer <AGENT_API_KEY>` and provably incapable of reaching any destructive or category-creating path.

### Why

This is the entire Agent permission boundary. Enforcing it at the router, not merely at the MCP tool layer, means a future tool cannot widen agent power by accident.

### Dependencies

```text
depends_on: CHECKPOINT D
blocks:     G5.2
can_parallel_with: —
```

### Scope

- `requireAgent` middleware with timing-safe key comparison
- Agent routes: create document, add version, get document, list documents, update metadata, move document, list categories, list tags
- Search for agents served by the existing metadata search
- A route-inventory test enumerating every registered agent route

### Out of Scope

- Any destructive route
- Any category or slug mutation
- The MCP server itself
- Any admin capability

### Read First

- `SPEC.md` §18 agent section, §19, §24
- `AGENT.md` §6, §29, §32
- Correction 1 in the approved design
- `src/api/middleware/admin-auth.ts`

### Files

Create:

- `src/api/middleware/agent-auth.ts`
- `tests/integration/agent-api.test.ts`, `tests/integration/agent-permission-boundary.test.ts`

Modify:

- `src/api/routes/agent/documents.ts`, `src/api/routes/agent/categories.ts`, `src/api/routes/agent/tags.ts`

Read: `src/domain/documents/document-service.ts`, `src/domain/search/metadata-search-service.ts`

### Interfaces / Contracts

Produces:

```text
POST  /api/agent/documents
POST  /api/agent/documents/:slug/versions
GET   /api/agent/documents
GET   /api/agent/documents/:slug
PATCH /api/agent/documents/:slug
POST  /api/agent/documents/:slug/move
GET   /api/agent/categories
GET   /api/agent/tags
Authentication: Authorization: Bearer <AGENT_API_KEY>
```

Must not change:

```text
No DELETE route, no restore route and no category mutation route may exist
under /api/agent for any reason.
```

### Implementation Requirements

1. Authentication is `Authorization: Bearer <AGENT_API_KEY>`, matching SPEC §18. No custom header is introduced.
2. The key is compared timing-safely by digest, exactly as the admin password is, and a failure returns `AGENT_KEY_INVALID`.
3. Admin and agent credentials are not interchangeable: an admin session token presented to an agent route is rejected, and an agent key presented to an admin route is rejected. Both directions are tested.
4. Agents may create tags implicitly through upload and metadata update, which SPEC §19 permits, but may never create, rename, move or delete a category. An unknown category raises `CATEGORY_NOT_FOUND`.
5. No agent route accepts a slug change; a body containing `slug` raises `SLUG_IMMUTABLE`.
6. All agent operations reuse the same domain services as the admin API. No SQL and no R2 access appears in agent route files.
7. A route-inventory test enumerates every route registered under `/api/agent` and asserts the set equals the eight documented paths, so adding a ninth route fails the build until it is reviewed.
8. Agent-created versions record `created_by = 'agent'`.

### Edge Cases

- Missing `Authorization` header → `AUTH_REQUIRED`
- Wrong key → `AGENT_KEY_INVALID`
- Admin token on an agent route → rejected
- Agent key on an admin route → rejected
- Agent uploads into a non-existent category → `CATEGORY_NOT_FOUND`, nothing created
- Agent supplies a new tag name → tag created implicitly and linked
- Agent attempts `DELETE /api/agent/documents/:slug` → 404, because no such route exists
- Agent sends `slug` in a PATCH body → `SLUG_IMMUTABLE`
- Agent re-uploads identical bytes → `UNCHANGED`, same as admin

### Tests Required

Positive:

- Agent creates a document, adds a version, updates metadata, moves it, and lists categories and tags
- Agent-created versions record `created_by = 'agent'`
- Agent search returns the same results as the public search

Negative:

- Missing, wrong and cross-role credentials each rejected with the correct code
- Category creation is unreachable for an agent by any route
- Document deletion, version deletion and restore are unreachable, each returning 404
- Slug change rejected with `SLUG_IMMUTABLE`
- Route inventory equals exactly the eight documented paths

Regression:

- Admin routes continue to work unchanged and remain closed to agent keys

### Verification Commands

```bash
pnpm test -- tests/integration/agent-api.test.ts tests/integration/agent-permission-boundary.test.ts
grep -rniE "\.delete\(|restore|categories.*post|categories.*patch" src/api/routes/agent/ || echo "no destructive agent route"
```

Expected:

```text
exit 0
route inventory test passes with exactly eight agent paths
grep finds no destructive or category-mutating handler under routes/agent
```

### Definition of Done

- [ ] Bearer authentication implemented with timing-safe comparison
- [ ] Eight agent routes implemented, none destructive
- [ ] Cross-role credential rejection proven in both directions
- [ ] Category creation unreachable for agents
- [ ] Slug change rejected explicitly
- [ ] Route-inventory test locks the agent surface
- [ ] Agent routes contain no SQL and no R2 access

### Stop Conditions

- SPEC §18 and SPEC §19 disagree about an operation the Agent needs
- A required agent capability cannot be served without a destructive route

### Suggested Commit

```text
feat(agent): add bearer-authenticated agent api with locked permission boundary
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G5.2 — MCP Server: Core & Write Tools

### Status

```text
BLOCKED
```

### Goal

A local stdio MCP server that validates a local HTML file and publishes or updates it through the Agent API, exposing the four write tools and nothing more at this stage.

### Why

This is the workflow the project exists to remove friction from: an agent that has just produced a report should be able to publish it without touching git, a build, or a deploy.

### Dependencies

```text
depends_on: G5.1
blocks:     G5.3
can_parallel_with: —
```

### Scope

- `mcp/` workspace package with the MCP TypeScript SDK v2
- stdio transport, server metadata, configuration from environment
- Tools: `upload_document`, `update_document`, `update_metadata`, `move_document`
- Zod input schemas, local file validation, structured results

### Out of Scope

- Read tools, which are G5.3
- Any domain logic, SQL or R2 access
- Any remote or HTTP MCP transport
- Any forbidden tool, under any name

### Read First

- `SPEC.md` §19
- `TECHSTACK.md` §14, §20
- `AGENT.md` §6, §26
- `src/api/routes/agent/documents.ts`

### Files

Create:

- `mcp/package.json`, `mcp/tsconfig.json`, `mcp/src/server.ts`, `mcp/src/config.ts`, `mcp/src/api-client.ts`
- `mcp/src/tools/upload-document.ts`, `mcp/src/tools/update-document.ts`, `mcp/src/tools/update-metadata.ts`, `mcp/src/tools/move-document.ts`
- `mcp/tests/write-tools.test.ts`

Modify:

- `pnpm-workspace.yaml` if the `mcp` glob needs adjustment

Read: `src/shared/types.ts`

### Interfaces / Contracts

Produces:

```text
stdio MCP server "alexandria"
Env: ALEXANDRIA_API_URL, ALEXANDRIA_AGENT_KEY
Tools: upload_document, update_document, update_metadata, move_document
```

Must not change:

```text
Business rules live in the Agent API. The MCP server validates locally,
calls HTTP, and formats results.
```

### Implementation Requirements

1. Configuration comes from `ALEXANDRIA_API_URL` and `ALEXANDRIA_AGENT_KEY`. The server fails fast at startup with a clear message when either is missing, and never prints the key.
2. Local validation before any network call: the path exists, ends with `.html`, is non-empty and is within the size limit. A local failure returns a tool error without contacting the API.
3. All API calls send `Authorization: Bearer <ALEXANDRIA_AGENT_KEY>`. The key never appears in a tool result, a log line, or an error message.
4. Tool inputs are Zod schemas that mirror the Agent API contract; the MCP server does not re-implement any rule the API owns.
5. API error envelopes are surfaced faithfully: the tool result carries the error code and message so the calling agent can react, rather than a generic failure string.
6. Results are structured, including slug, public URL, version number and whether the operation was `UNCHANGED`.
7. No tool in this package may be named any of the eight forbidden names, and no tool may compose two calls to simulate one.
8. The package depends only on the MCP SDK and Zod; no HTTP client library is added when `fetch` is available.

### Edge Cases

- Missing configuration → clear startup failure, no partial server
- File path does not exist → local error, no network call
- File is not `.html` → local error
- File exceeds the limit → local error naming the limit
- API returns `CATEGORY_NOT_FOUND` → surfaced verbatim so the agent can list categories and retry
- API returns `UNCHANGED` → reported as a successful no-op, not an error
- API unreachable → clear transport error, no retry storm
- Invalid agent key → `AGENT_KEY_INVALID` surfaced without echoing the key
- Very large file → streamed or read once, not loaded repeatedly

### Tests Required

Positive:

- `upload_document` publishes a local file and returns a slug and URL
- `update_document` creates a new version
- `update_metadata` and `move_document` behave as the API does
- `UNCHANGED` reported as a successful no-op

Negative:

- Missing configuration prevents startup
- Local validation failures produce no network call, asserted by a request spy
- API error codes surfaced verbatim
- The agent key never appears in any tool result or log line
- None of the eight forbidden tool names is registered

Regression:

- No domain rule is re-implemented in `mcp/`, asserted by the absence of SQL and storage access in the package

### Verification Commands

```bash
pnpm --filter alexandria-mcp test
pnpm --filter alexandria-mcp typecheck
grep -rniE "delete_document|delete_version|restore_version|create_category|rename_category|move_category|delete_category|change_slug" mcp/src/ || echo "no forbidden tool names"
```

Expected:

```text
exit 0
grep finds no forbidden tool name anywhere in mcp/src
```

### Definition of Done

- [ ] stdio MCP server starts with valid configuration and fails fast without it
- [ ] Four write tools implemented and covered by tests
- [ ] Local validation short-circuits before any network call
- [ ] API errors surfaced verbatim with their codes
- [ ] Agent key never printed or returned
- [ ] No forbidden tool name present
- [ ] No domain logic duplicated in the package

### Stop Conditions

- MCP SDK v2 package names or APIs differ materially from what TECHSTACK §14 describes
- A required tool cannot be implemented without duplicating a domain rule

### Suggested Commit

```text
feat(mcp): add stdio mcp server with document write tools
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G5.3 — MCP Read Tools & Tool-Contract Suite

### Status

```text
BLOCKED
```

### Goal

The five read tools complete the nine-tool surface, and a contract test permanently locks that surface so no forbidden tool can be added later without failing the build.

### Why

AGENT.md §6 warns specifically against adding a destructive tool for convenience. A test that compares the exposed tool set against an explicit allowlist is the only durable defence.

### Dependencies

```text
depends_on: G5.2
blocks:     CHECKPOINT E
can_parallel_with: —
```

### Scope

- Tools: `get_document`, `list_documents`, `search_documents`, `list_categories`, `list_tags`
- A tool-contract suite asserting the exact tool set
- An end-to-end MCP test running against a locally served Worker

### Out of Scope

- Any additional tool beyond the nine
- Any write capability not already delivered by G5.2
- Any Dria or retrieval concept

### Read First

- `SPEC.md` §19
- `AGENT.md` §6, §29
- `mcp/src/server.ts`

### Files

Create:

- `mcp/src/tools/get-document.ts`, `mcp/src/tools/list-documents.ts`, `mcp/src/tools/search-documents.ts`, `mcp/src/tools/list-categories.ts`, `mcp/src/tools/list-tags.ts`
- `mcp/tests/tool-contract.test.ts`, `mcp/tests/e2e.test.ts`
- `docs/MCP.md` describing configuration and the tool surface

Modify:

- `mcp/src/server.ts` (registration only)

Read: `src/api/routes/agent/`

### Interfaces / Contracts

Produces:

```text
Complete tool set, exactly:
  upload_document, update_document, get_document, list_documents,
  search_documents, update_metadata, move_document,
  list_categories, list_tags
```

Must not change:

```text
The nine-tool allowlist. Changing it requires a Plan Delta and user approval.
```

### Implementation Requirements

1. The allowlist and the forbidden list are declared as explicit constants in the test file, not derived from the implementation, so the test cannot drift with the code it guards.
2. The contract test asserts set equality with the nine allowed names and asserts that none of the eight forbidden names appears.
3. `get_document` returns metadata and the public URL. It never returns HTML body content, because an agent that wants the content can fetch the public URL directly.
4. `list_documents` and `search_documents` paginate and expose the same contract as the public API, including the query semantics from G4.1.
5. The end-to-end test runs the MCP server against a locally served Worker with a real local D1 and R2, exercising publish, update, search and list in one sequence.
6. `docs/MCP.md` documents configuration, every tool, and states plainly which operations are deliberately unavailable and why.
7. Read tools never require write scope and never mutate anything.

### Edge Cases

- `get_document` for an unknown slug → `DOCUMENT_NOT_FOUND` surfaced verbatim
- `search_documents` with a Thai query → same behaviour as the public API
- `list_documents` with an out-of-range page → clamped, matching the API
- Empty library → empty results, not an error
- `list_categories` on a deep tree → full tree returned in one call
- A newly added tool that is not on the allowlist → contract test fails
- A tool renamed to a forbidden name → contract test fails

### Tests Required

Positive:

- All five read tools return correct data against a live local Worker
- End-to-end sequence: publish, list, search, get, update, get again
- `docs/MCP.md` lists exactly the tools the server registers

Negative:

- Exposed tool set equals exactly the nine allowed names
- None of the eight forbidden names is registered
- No read tool mutates anything, asserted by comparing database state before and after
- `get_document` returns no HTML body content

Regression:

- Write tools from G5.2 still behave correctly after registration changes

### Verification Commands

```bash
pnpm --filter alexandria-mcp test
pnpm --filter alexandria-mcp typecheck
pnpm test -- tests/integration/agent-permission-boundary.test.ts
```

Expected:

```text
exit 0
tool-contract test reports exactly nine tools and zero forbidden names
```

### Definition of Done

- [ ] Nine tools registered, no more and no fewer
- [ ] Contract test locks the surface with explicit allow and forbid lists
- [ ] End-to-end MCP test passes against a local Worker with real D1 and R2
- [ ] Read tools proven non-mutating
- [ ] `get_document` returns no body content
- [ ] `docs/MCP.md` accurate and explicit about what is unavailable

### Stop Conditions

- A read tool cannot be served by the existing agent routes
- The MCP SDK cannot enumerate registered tools for the contract test

### Suggested Commit

```text
feat(mcp): add read tools and lock the nine-tool contract with tests
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G6.1 — Invariant & Negative Test Suite

### Status

```text
BLOCKED
```

### Goal

One consolidated `invariants` suite that proves every AGENT.md §29 requirement applicable to Phase 1, plus the layering discipline, and that fails loudly if any of them regresses.

### Why

These rules are scattered across many nodes, each proven at the time it was built. A single suite makes them a permanent gate rather than a historical claim, and it is the artefact a future contributor will run first.

### Dependencies

```text
depends_on: CHECKPOINT E
blocks:     G6.4
can_parallel_with: G6.2, G6.3
```

### Scope

- A tagged suite gathering every invariant test
- Any missing invariant test written here
- A layering assertion that routes contain no SQL or storage access
- An explicit record of which §29 items are Phase 1.5 and why they are not applicable yet

### Out of Scope

- Production source changes; if a test reveals a defect, that is reported, and the fix is a separate node
- Browser security tests, which are G6.2
- Performance checks, which are G6.3

### Read First

- `AGENT.md` §29, §30
- `SPEC.md` §26, §27
- Every existing test file

### Files

Create:

- `tests/invariants/index.test.ts` and per-invariant files under `tests/invariants/`
- `docs/INVARIANTS.md` mapping each rule to its test

Modify:

- `package.json` (an `invariants` script)

Read: all domain, API and MCP sources

### Interfaces / Contracts

Produces:

```text
pnpm invariants   # runs only the invariant suite
```

Must not change:

```text
No production behaviour changes in this node
```

### Implementation Requirements

1. Cover, each as a named test: public cannot write; an invalid agent key cannot write; an agent cannot create a category; an agent cannot delete a document; an agent cannot restore; the current version cannot be deleted; the last version cannot be deleted; a slug does not change automatically; and content-origin isolation from the admin session, which delegates to the browser test owned by G6.2.
2. Record the two Dria-related §29 items as explicitly not applicable in Phase 1, with a test asserting the absence of any AI dependency, any `src/dria/` directory, and any AI-related environment variable. This turns "we did not build it" into a verified fact.
3. Assert the layering rule: no file under `src/api/routes/` contains SQL keywords or a direct `env.DB` or `env.DOCS` access.
4. Assert that no route handler file exceeds a documented line budget, as a proxy for the thin-transport rule, with the budget stated in `docs/INVARIANTS.md`.
5. Each test names the source rule in its title, so a failure reads as a rule violation rather than an anonymous assertion.
6. The suite runs independently and quickly enough to be used as a pre-commit gate.
7. If any invariant cannot be proven, the node reports it as a finding rather than weakening the assertion.

### Edge Cases

- An invariant already covered elsewhere → referenced, not duplicated, so there is one authoritative test
- An invariant that is only observable in a browser → delegated to G6.2 and linked from the documentation
- A test that passes for the wrong reason, such as a 404 caused by a typo rather than by an absent route → asserted against the route inventory rather than a status code alone

### Tests Required

Positive:

- The suite runs standalone and reports every invariant by name

Negative:

- All nine applicable §29 invariants pass
- No AI dependency, directory or environment variable exists
- No route file contains SQL or a direct binding access
- Deliberately breaking one invariant in a scratch branch makes the suite fail, demonstrating the gate actually bites

Regression:

- The full suite continues to pass unchanged

### Verification Commands

```bash
pnpm invariants
pnpm test
grep -rn "workers-ai\|@cf/\|DRIA_" src/ mcp/ || echo "no ai dependency present"
```

Expected:

```text
exit 0
every invariant reported by name
grep confirms no AI surface exists
```

### Definition of Done

- [ ] All nine Phase 1 invariants proven by named tests
- [ ] Two Dria invariants recorded as not applicable, with absence verified
- [ ] Layering and line-budget assertions in place
- [ ] `docs/INVARIANTS.md` maps every rule to its test
- [ ] Suite runnable standalone
- [ ] Gate demonstrated to fail when an invariant is broken

### Stop Conditions

- An invariant cannot be expressed as an automated test
- A test reveals a genuine defect, which is reported rather than fixed inside this node

### Suggested Commit

```text
test(invariants): consolidate phase 1 invariant and negative test suite
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G6.2 — Security Audit: Secrets, CORS & iframe Isolation

### Status

```text
BLOCKED
```

### Goal

Evidence that no secret escapes the server, that the API trusts no cross-origin caller, and that uploaded HTML cannot reach the admin session in a real browser.

### Why

These are the failures that would matter most and that unit tests cannot see. They need a real browser, a real built bundle, and a real cross-origin request.

### Dependencies

```text
depends_on: CHECKPOINT E
blocks:     G6.4
can_parallel_with: G6.1, G6.3
```

### Scope

- Built-bundle and git-history scan for secret material
- Cross-origin request tests from the content origin to the API
- Browser tests proving iframe isolation from admin session storage
- Response header verification on both Workers

### Out of Scope

- Penetration testing beyond these defined checks
- Production source changes; findings are reported
- Any change to the sandbox contract

### Read First

- `SPEC.md` §16, §17
- `GOAL.md` §8
- `AGENT.md` §8, §13
- Architecture Constraints 2, 3, 5 in this plan

### Files

Create:

- `tests/security/secret-scan.test.ts`, `tests/security/cors.test.ts`
- `tests/browser/iframe-isolation.spec.ts`
- `docs/SECURITY.md`

Modify: none

Read: `dist/`, `src/content/handler.ts`, `src/api/app.ts`

### Interfaces / Contracts

Produces:

```text
docs/SECURITY.md — the boundary, what is verified, and how to re-verify
```

Must not change:

```text
The sandbox attribute, the no-cookie rule, the read-only content Worker
```

### Implementation Requirements

1. Scan every built client asset for the four secret names and for any value resembling a key. The scan runs against the real build output, not against source.
2. Scan git history for secret material and for `.dev.vars`, so a value committed once and removed later is still caught.
3. Prove the API sets no permissive CORS header: a credentialed cross-origin request originating from the content origin must not receive an `Access-Control-Allow-Origin` that names it, and no preflight may succeed for an admin route.
4. In a real browser, load a document whose HTML attempts to read `sessionStorage`, `localStorage` and `document.cookie`, and attempts a credentialed `fetch` to an admin endpoint. Assert every attempt fails and that the page containing the frame keeps its session intact.
5. Verify that a cookie set by the content origin cannot authenticate anything, since authentication never reads cookies. Assert no route reads a cookie.
6. Verify response headers on both Workers: `nosniff`, the `frame-ancestors` value, cache directives, and the absence of `Set-Cookie`.
7. Findings are written up in `docs/SECURITY.md` with the exact command to re-verify each one. No finding is fixed inside this node; a real defect is reported for a dedicated node.

### Edge Cases

- A secret value appearing only in a source map → the scan must include source maps or source maps must not ship
- A secret name appearing as a harmless type declaration → the scan distinguishes a name from a value and does not produce a false alarm that trains people to ignore it
- The content origin attempting a no-credentials fetch → allowed if the endpoint is public, which is correct and must not be reported as a failure
- An uploaded document opening a popup → permitted by the sandbox, must not gain access to the opener's storage
- A document attempting `window.top` access → blocked by the opaque origin
- A document setting a cookie on the shared parent domain → must not authenticate anything

### Tests Required

Positive:

- Both Workers return their documented security headers
- A public cross-origin read works where it is intended to

Negative:

- No secret name or value in any built asset or source map
- No secret in git history
- No permissive CORS header for the content origin on any admin route
- The iframe cannot read the admin session, cannot read cookies usefully, and cannot call an admin endpoint with credentials
- No route anywhere reads a cookie

Regression:

- The fixture still renders correctly with all external resources under these headers

### Verification Commands

```bash
pnpm build
pnpm test -- tests/security/secret-scan.test.ts tests/security/cors.test.ts
pnpm test:browser -- tests/browser/iframe-isolation.spec.ts
git log -p --all | grep -cE "ADMIN_PASSWORD=|AGENT_API_KEY=|SIGNING_SECRET=" || echo "no secret in git history"
```

Expected:

```text
exit 0
zero secret occurrences in dist and in git history
every isolation attempt from inside the iframe fails
```

### Definition of Done

- [ ] Built assets and source maps free of secret material
- [ ] Git history free of secret material
- [ ] No permissive CORS toward the content origin, proven by request
- [ ] iframe isolation proven in a real browser across storage, cookies and credentialed fetch
- [ ] No route reads a cookie
- [ ] Headers verified on both Workers
- [ ] `docs/SECURITY.md` written with re-verification commands

### Stop Conditions

- A real vulnerability is found, which is reported immediately and stops the release rather than being patched inside this node
- Isolation cannot be tested because the sandbox prevents observing the outcome

### Suggested Commit

```text
test(security): add secret scan, cors and iframe isolation verification
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G6.3 — Mobile & Performance Verification

### Status

```text
BLOCKED
```

### Goal

Evidence that Alexandria reads well at 375, 768 and 1440 pixels and on a real device, and that the performance rules in TECHSTACK §22 and AGENT.md §25 hold in the shipped build.

### Why

The library exists to be read, frequently on a phone. The performance rules are architectural promises, and an unenforced promise degrades quietly with every feature.

### Dependencies

```text
depends_on: CHECKPOINT E
blocks:     G6.4
can_parallel_with: G6.1, G6.2
```

### Scope

- Browser tests across all public and admin surfaces at three viewports
- Real-device verification of the Reader
- Network assertions: no HTML body in list responses, lazy admin chunk, paginated lists
- Bundle composition check

### Out of Scope

- Optimization work; measurements that fail become reported findings
- Adding caching infrastructure, which AGENT.md §25 requires measuring first
- Any AI-related measurement

### Read First

- `SPEC.md` §25
- `TECHSTACK.md` §22
- `AGENT.md` §24, §25
- `GOAL.md` §7

### Files

Create:

- `tests/browser/responsive.spec.ts`, `tests/browser/performance-rules.spec.ts`
- `docs/QA-MOBILE.md`

Modify: none

Read: `dist/`, all app routes

### Interfaces / Contracts

Produces:

```text
docs/QA-MOBILE.md — matrix of surface by viewport with evidence
```

Must not change:

```text
No production source changes in this node
```

### Implementation Requirements

1. Verify Library, category browse, search results, Reader, admin login, upload, categories, tags and version history at 375, 768 and 1440.
2. Assert no horizontal scrolling on any public surface at 375, and that the Reader's reading area is not narrowed further on mobile.
3. Assert no essential action is hover-only by driving every primary control through tap and keyboard.
4. Assert list and search responses contain no HTML body content, checked against the fixture's marker text in the network payload.
5. Assert the admin chunk is not requested during any public navigation, and that opening the Reader fetches the document body exactly once.
6. Assert no request is made to any AI or model endpoint on any page load, which is trivially true today and must stay true.
7. Record bundle sizes for the public entry and the admin chunk as a baseline for future comparison.
8. A failed measurement is a reported finding with numbers, not a licence to add caching.

### Edge Cases

- Mobile browser dynamic viewport with a collapsing address bar → `100dvh` behaviour verified rather than assumed
- Very long Thai text without spaces → wraps rather than overflowing horizontally
- A document whose own CSS is wide → scrolls inside the frame without breaking the shell
- 375 pixel admin category tree at depth 10 → usable
- Slow network → skeletons appear, no layout shift on arrival
- A document with a large external image → the shell remains responsive while it loads

### Tests Required

Positive:

- Every listed surface renders correctly at all three viewports
- The Reader is verified on a real device
- Baseline bundle sizes recorded

Negative:

- No horizontal scroll at 375 on any public surface
- No hover-only essential action
- No HTML body content in list or search payloads
- No admin chunk during public navigation
- No AI endpoint requested anywhere

Regression:

- All previously passing browser tests still pass

### Verification Commands

```bash
pnpm build
pnpm test:browser -- tests/browser/responsive.spec.ts tests/browser/performance-rules.spec.ts
du -sh dist/assets/* | sort -h | tail -20
```

Expected:

```text
exit 0
no horizontal overflow at 375 on any public surface
bundle sizes recorded in docs/QA-MOBILE.md
```

### Definition of Done

- [ ] Nine surfaces verified at three viewports
- [ ] Reader verified on a real device
- [ ] No horizontal scroll and no hover-only action at 375
- [ ] List and search payloads free of body content
- [ ] Admin chunk absent from public navigation
- [ ] No AI request on any page load
- [ ] Baseline bundle sizes recorded
- [ ] `docs/QA-MOBILE.md` written with the evidence matrix

### Stop Conditions

- A surface is unusable at 375 and cannot be fixed without a design change, which is reported
- A performance rule is violated by the architecture rather than by an implementation detail

### Suggested Commit

```text
test(qa): add responsive matrix and performance rule verification
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## Node G6.4 — Production Release & Phase 1 Gate

### Status

```text
BLOCKED
```

### Goal

The complete Phase 1 deployed to production, verified against GOAL, SPEC, TECHSTACK and AGENT, and formally reported as `PASS`, `PARTIAL` or `FAIL` with evidence.

### Why

A milestone is not complete because its nodes are marked done. It is complete when the shipped system demonstrably satisfies the source of truth.

### Dependencies

```text
depends_on: G6.1, G6.2, G6.3
blocks:     RELEASE GATE
can_parallel_with: —
```

### Scope

- Full suite run: unit, Worker integration, browser, MCP, invariants, security
- Production deployment of both Workers with migrations applied
- Post-deploy smoke verification including MCP against production
- Traceability re-verification against §6 of this plan
- Documentation updates and the final Phase 1 report

### Out of Scope

- Any new feature
- Any Phase 1.5 preparation
- GitHub Actions

### Read First

- `GOAL.md` §10
- `SPEC.md` §27
- `AGENT.md` §30
- `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/INVARIANTS.md`, `docs/QA-MOBILE.md`

### Files

Create:

- `docs/PHASE1-RELEASE.md`

Modify:

- `README.md` if present, `docs/DEPLOYMENT.md`

Read: everything

### Interfaces / Contracts

Produces:

```text
Deployed: alexandria and alexandria-content
docs/PHASE1-RELEASE.md — PASS | PARTIAL | FAIL with evidence per requirement
```

Must not change:

```text
Nothing functional. This node deploys and verifies.
```

### Implementation Requirements

1. Take a `wrangler d1 export` snapshot before applying any remaining migration, so there is a restore point.
2. Deploy the content Worker first, then the app Worker, matching the M1 ordering.
3. After deploying, run smoke checks against production: publish a throwaway document, read it anonymously, update it, restore it, delete it, and confirm the library returns to its prior state.
4. Run the MCP server against production with the real agent key and exercise publish, update, search and list, then remove the test document.
5. Walk the §6 traceability table row by row and record, for each requirement, the evidence that satisfies it or the explicit reason it is a Non-Goal.
6. Walk `SPEC.md` §27 and `AGENT.md` §30 checklists and record each item.
7. Confirm no Phase 1.5 or Phase 2 surface exists: no AI dependency, no Dria directory, no user or community table, no cover image field.
8. Report `PASS` only when every checklist item is satisfied. If anything is outstanding, report `PARTIAL` with a precise list; never round up.
9. Record the rollback procedure actually used or rehearsed, not a theoretical one.

### Edge Cases

- Production behaves differently from local → investigate before declaring pass, never explain away
- A smoke test leaves a stray document → cleanup is part of the node and is verified
- The MCP production run reveals a configuration gap → reported, not patched silently
- A traceability row has no evidence → the report is `PARTIAL`, not `PASS`
- A migration fails midway → restore from the snapshot and report
- A late finding from G6.1, G6.2 or G6.3 is still open → gate cannot pass

### Tests Required

Positive:

- Full local suite green
- Production smoke sequence completes and cleans up
- MCP against production completes and cleans up

Negative:

- No Phase 1.5 or Phase 2 surface present, asserted
- No secret in the deployed bundle, re-asserted against production assets
- Anonymous read requires no login, verified on production

Regression:

- Existing published documents still read correctly after deployment

### Verification Commands

```bash
pnpm test && pnpm invariants && pnpm test:browser
pnpm --filter alexandria-mcp test
pnpm exec wrangler d1 export alexandria-db --remote --output ./backup-pre-release.sql
pnpm exec wrangler deploy -c wrangler.content.jsonc
pnpm exec wrangler deploy -c wrangler.jsonc
pnpm exec wrangler d1 migrations list alexandria-db --remote
curl -s https://alexandria.vcp-scanner.workers.dev/api/public/documents | head -c 400
```

Expected:

```text
every command exits 0
migrations fully applied remotely
public listing responds anonymously
```

### Definition of Done

- [ ] Every suite green: unit, integration, browser, MCP, invariants, security
- [ ] Both Workers deployed, migrations applied, snapshot taken beforehand
- [ ] Production smoke sequence completed and cleaned up
- [ ] MCP verified against production and cleaned up
- [ ] §6 traceability table walked row by row with recorded evidence
- [ ] SPEC §27 and AGENT §30 checklists recorded item by item
- [ ] No Phase 1.5 or Phase 2 surface present
- [ ] `docs/PHASE1-RELEASE.md` reports PASS, PARTIAL or FAIL with evidence
- [ ] Rollback procedure recorded from actual use or rehearsal

### Stop Conditions

- Any invariant, security or QA finding is still open
- Production behaviour differs from local in a way that is not understood
- A traceability requirement has no evidence

### Suggested Commit

```text
chore(release): deploy phase 1 and record release gate verification
```

### Evidence

```text
Changed:
Tests:
Verification:
Notes:
```

---

## 13. Integration Nodes

Three nodes exist specifically to integrate work produced in parallel, and the orchestrator performs an integration review before unlocking anything downstream of them.

| Integration point | Merges | What the review checks |
|---|---|---|
| G1.12 | G1.7, G1.8, G1.9, G1.10, G1.11 | The three parallel transport nodes agree on the response contract; the content origin the SPA receives matches the deployed content Worker; no node edited `src/api/app.ts` |
| G2.5 and G2.6 | G2.1, G2.2, G2.3, G2.4 | Category and tag services expose consistent shapes to both the admin and public surfaces; no duplicate normalization logic appeared; no migration collision |
| G6.4 | G6.1, G6.2, G6.3 | All three verification suites ran against the same build; no suite silently skipped; every finding closed or explicitly carried as `PARTIAL` |

After any parallel dispatch the orchestrator re-runs `pnpm typecheck`, `pnpm test` and `pnpm build` on the merged tree before marking the participating nodes `DONE`.

---

## 14. Deployment / Migration Order

1. Project owner enables R2 in the Cloudflare dashboard and re-runs `wrangler login` so the token gains the `r2` scope. This is the only external blocker in the plan and it gates G1.12.
2. Create `alexandria-db` and `alexandria-docs`.
3. Set secrets: `ADMIN_PASSWORD` by the project owner personally; `ADMIN_SESSION_SIGNING_SECRET`, `AGENT_API_KEY` and `CONTENT_PREVIEW_SIGNING_SECRET` generated securely and piped directly into `wrangler secret put` without ever being displayed.
4. Snapshot the remote database with `wrangler d1 export` before every migration application.
5. Apply migrations to the remote database.
6. Deploy `alexandria-content` first, then `alexandria`.
7. Verify health, then publish the fixture through the deployed Admin UI.
8. Repeat steps 4 to 7 at G6.4 for the full Phase 1 release.

Rollback and compensation:

- Worker rollback: redeploy the previous commit's build, or use `wrangler rollback` for the affected Worker. Both Workers version independently, so roll back the one that regressed.
- Database rollback: migrations are forward-only. Recovery is restoring the pre-migration export. Every deployment node takes that export first, so the restore point always exists.
- Storage: R2 objects are immutable and are never overwritten, so a rollback of code never invalidates stored content.
- Partial write failures at runtime are handled by the compensation logic in G1.5, and any resulting orphan objects are logged with their `document_id` and key for later reconciliation.

---

## 15. Final Phase Verification

Requirements:

- [ ] Every row of the §6 traceability table satisfied or explicitly marked Non-Goal, with evidence
- [ ] `GOAL.md` §10 Phase 1 success criteria all met
- [ ] `SPEC.md` §27 Phase 1 checklist complete

Architecture:

- [ ] Two Workers on two origins, deployed and healthy
- [ ] Domain Services own the business rules; routes are thin
- [ ] The content Worker remains strictly read-only with no admin or agent secret
- [ ] No unapproved dependency and no framework substitution

Security:

- [ ] No secret in repo, git history, built assets, source maps, logs, iframe URLs or MCP output
- [ ] No cookie used for authentication anywhere
- [ ] iframe isolation proven in a real browser
- [ ] Agent permission boundary proven at router and tool level

Tests:

- [ ] Unit, Worker integration, browser, MCP, invariant and security suites all green
- [ ] Every applicable AGENT.md §29 negative test present and passing

Build:

- [ ] `pnpm build` succeeds with no type errors and no lint errors
- [ ] Admin chunk split from the public entry

Mobile:

- [ ] 375, 768 and 1440 verified across all surfaces
- [ ] Reader verified on a real device
- [ ] No hover-only essential action

Integration:

- [ ] Publish, read, update, restore and delete verified end to end on production
- [ ] Stable URL survives metadata change, category move and version update

MCP:

- [ ] Exactly nine tools exposed, eight forbidden names absent
- [ ] Verified against production and cleaned up afterwards

Deployment:

- [ ] Both Workers deployed, migrations applied and recorded
- [ ] Pre-migration snapshot taken and a rollback procedure recorded

Non-goals leakage:

- [ ] No Dria, AI Search, Workers AI, Agents SDK or Durable Object code
- [ ] No user, community, likes or reading-status surface
- [ ] No cover image, HTML editor, asset bundle or web research capability

---

## 16. Plan Self-Review

- [x] Every requirement from GOAL, SPEC, TECHSTACK and AGENT maps to a node or an explicit Non-Goal in §6
- [x] No dependency cycle: the graph is a DAG, verified by walking §12 from `G1.0` to `G6.4`
- [x] Critical path is justified and passes through the highest-risk write path rather than around it
- [x] Parallel candidates share no file, and the one real risk — a shared router file — is removed by G1.2 creating the whole routing skeleton up front
- [x] Every node is independently reviewable and independently testable
- [x] Every node has a measurable Definition of Done stated as behaviour, not as sentiment
- [x] Every node has executable verification commands
- [x] Every high-risk node carries negative tests and a failure path
- [x] No `TODO`, `TBD`, `similar to above`, `implement later` or `etc.` appears in this plan
- [x] No Phase 1.5 or Phase 2 feature has entered the graph; the two Dria-related §29 invariants are recorded as not applicable with an absence test
- [x] No implementation has begun; the repository still contains documentation only
- [x] The one external blocker, R2 enablement, is isolated to a single node and named in §14

---

## 17. Approval

```text
PLAN STATUS: APPROVED
APPROVED BY:  THP (Thitipat)
APPROVED AT:  2026-08-30
```

Approved. Graph execution has begun. Any change to scope, architecture or the
node graph from this point requires a Plan Delta (§17 of the orchestrator
protocol) and a further approval before execution resumes.
