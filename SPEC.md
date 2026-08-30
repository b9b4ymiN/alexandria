# SPEC.md — Alexandria System Specification

**Project:** Alexandria  
**AI:** Dria  
**Phase:** 1 + Phase 1.5 compatibility  
**Last updated:** 2026-08-30  
**Product source of truth:** `GOAL.md`  
**Technology source of truth:** `TECHSTACK.md`

---

# 1. Source-of-Truth Order

เมื่อเอกสารขัดกัน:

1. `GOAL.md` — product intent / scope
2. `SPEC.md` — behavior / contracts
3. `TECHSTACK.md` — approved technical choices
4. `AGENT.md` — implementation discipline

ถ้าการแก้ต้องเปลี่ยน Product Scope หรือ Architecture ให้หยุดและขอ approval

---

# 2. System Architecture

## Phase 1

```text
                         Public Browser
                              │
                              ▼
                  ┌───────────────────────┐
                  │ Alexandria Web App    │
                  │ React SPA             │
                  │                       │
                  │ Library / Reader      │
                  │ Admin                 │
                  └──────────┬────────────┘
                             │
                           /api
                             │
                             ▼
                  ┌───────────────────────┐
                  │ Cloudflare Worker     │
                  │ Hono API              │
                  └──────────┬────────────┘
                             │
                    Domain Services
                 ┌───────────┴───────────┐
                 ▼                       ▼
               D1                        R2
          metadata/tree            HTML versions


External Agent
     │
     ▼
Alexandria MCP Server
     │ Agent API Key
     ▼
Hono Agent API
     │
     ▼
same Domain Services
```

## Content Delivery Security Boundary

```text
app origin
library.example.com

content origin
content.example.com
```

Reader:

```text
library origin
     │
     └── sandbox iframe
             │
             ▼
       content origin
             │
             ▼
        current R2 HTML
```

The content origin MUST NOT share Admin authentication storage/security context.

---

# 3. Phase 1.5 Dria Architecture

Dria is an additional consumer of the same Domain layer.

```text
React Reader
    │
    ▼
Dria UI
    │
    │ WebSocket / agent protocol
    ▼
Cloudflare Agents SDK
Durable Object Agent
    │
    ├── Conversation State
    ├── AI Search Retrieval
    ├── Model Provider
    └── Alexandria Tools
            │
            ▼
      Domain Services
```

Critical rule:

> AI does not own Alexandria business logic.

Do NOT implement:

```text
Dria → reimplements document/version/category SQL
```

Implement:

```text
Dria → DocumentService / SearchService / allowed read tools
```

---

# 4. Repository Structure

Recommended:

```text
alexandria/
├── GOAL.md
├── SPEC.md
├── TECHSTACK.md
├── AGENT.md
│
├── src/
│   ├── app/
│   │   ├── routes/
│   │   ├── components/
│   │   ├── features/
│   │   └── styles/
│   │
│   ├── api/
│   │   ├── app.ts
│   │   ├── middleware/
│   │   └── routes/
│   │
│   ├── domain/
│   │   ├── documents/
│   │   ├── versions/
│   │   ├── categories/
│   │   ├── tags/
│   │   └── search/
│   │
│   ├── content/
│   │   └── handler.ts
│   │
│   ├── dria/
│   │   ├── agent.ts
│   │   ├── tools/
│   │   └── prompts/
│   │
│   └── shared/
│
├── mcp/
│   ├── server.ts
│   └── tools/
│
├── migrations/
├── tests/
├── wrangler.jsonc
├── vite.config.ts
├── tsconfig.json
└── package.json
```

`src/dria/` may exist as scaffolding only after Phase 1 foundation; no hidden AI implementation is required for Phase 1.

---

# 5. Data Model

## categories

```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT,
  UNIQUE (parent_id, slug)
);
```

Rules:

- arbitrary depth
- no cycle
- sibling slug unique
- cannot delete non-empty category
- Admin creates/manages Category
- Agent only selects/moves document to existing Category

---

## documents

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL,
  current_version_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);
```

Invariants:

- `id` permanent
- `slug` stable
- category/title/tags may change
- current version belongs to same document

---

## document_versions

```sql
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('admin','agent')),
  created_at TEXT NOT NULL,
  restored_from_version_no INTEGER NULL,
  note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE (document_id, version_no)
);
```

---

## tags

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## document_tags

```sql
CREATE TABLE document_tags (
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

---

# 6. Phase 1.5 Dria State

Do not add user/community tables in Phase 1.

When Dria is enabled before public Login, conversation state can be ephemeral/session-oriented.

Cloudflare Agents/Durable Object storage owns Dria conversation state.

Do not put chat messages in D1 unless later requirements justify a global/queryable chat database.

Stable Alexandria reference in Dria state:

```text
document_id
version_id
slug
retrieval scope
```

When a document updates, an existing conversation must retain which version it originally referenced if that distinction matters.

---

# 7. R2 Storage

Immutable object convention:

```text
documents/{document_id}/versions/{version_id}.html
```

Never key by category/title.

Phase 1 stores original bytes without rewrite.

Recommended application max:

```text
20 MiB per HTML
```

configurable by environment.

Note:

Cloudflare AI Search currently has a smaller per-file indexing limit than Alexandria's storage limit. Therefore Phase 1.5 indexing must handle oversized documents explicitly rather than reducing Phase 1 storage capability.

Options when Dria indexing is implemented:

1. extract clean text and upload index representation within AI Search limits, or
2. chunk/index via supported ingestion path, or
3. mark oversized document as not indexed and show a clear state

Do not silently truncate without user-visible indication.

---

# 8. Metadata Extraction

Deterministic extraction.

## Title

```text
<title>
→ first meaningful h1
→ filename
```

## Description

```text
meta[name=description]
→ og:description
→ first meaningful paragraph
→ empty
```

## Suggested Tags

```text
meta[name=keywords]
```

Explicit Admin/Agent input may override/add.

## Category

Must already exist.

No AI auto-create Category.

---

# 9. Create Document Flow

## Admin

```text
Choose .html
→ validate
→ detect metadata
→ Admin reviews/edits
→ select existing Category
→ publish
→ write R2
→ atomic D1 metadata/version batch
→ return stable URL
```

## Agent

```text
list_categories
→ choose category
→ upload_document
→ deterministic metadata extraction
→ explicit tool args override
→ publish
→ stable URL
```

R2 and D1 are not a shared transaction.

Required compensation:

```text
R2 write
→ D1 batch
→ if D1 fails: best-effort R2 delete
```

---

# 10. Slug Contract

Pattern:

```regex
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

Generation:

```text
Title
→ useful Latin slug
→ filename
→ doc-{short-id}
```

Collision:

```text
slug
slug-2
slug-3
```

Slug never changes automatically.

Agent cannot rename slug.

---

# 11. Update Contract

Input:

```text
stable slug + new .html
```

Algorithm:

1. resolve document
2. validate HTML
3. compute SHA-256
4. compare with current version
5. if identical → `UNCHANGED`
6. upload immutable new R2 object
7. insert new version
8. update current version pointer
9. return same public URL

Metadata updates happen only when explicitly provided.

---

# 12. Restore Contract

Restore is append-only.

Example:

```text
v4 current
restore v2
→ create v5 from v2 bytes
→ v5 current
→ restored_from_version_no = 2
```

---

# 13. Delete Rules

Admin only.

## Version

Cannot delete:

- current version
- only remaining version

## Document

Requires explicit confirmation.

Agent/MCP has no delete tools.

---

# 14. Public Library

Home:

```text
Search documents...

Categories

Recently Updated
```

Document card:

```text
Title
Category path
Tags
Updated date
```

No cover image Phase 1.

Search:

- title
- description
- category
- tag

No full HTML text search.

---

# 15. Reader Shell

Route:

```text
/docs/:slug
```

Reader Shell is app-origin UI.

Minimum:

- back
- title
- category
- share
- updated date
- iframe

Use mobile-friendly viewport layout (`100dvh` where appropriate).

HTML iframe loads current content from content origin.

---

# 16. iframe Security

Baseline:

```html
<iframe
  sandbox="allow-scripts allow-popups allow-downloads"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

Do not add `allow-same-origin` without explicit security review.

Uploaded HTML may load external:

- CSS
- fonts
- images
- JS/CDN

But must not receive:

- Admin token
- Agent key
- preview secret

Admin API CORS does not trust content origin.

---

# 17. Admin Authentication

Phase 1 = simple Admin Password.

Secrets:

```text
ADMIN_PASSWORD
ADMIN_SESSION_SIGNING_SECRET
AGENT_API_KEY
CONTENT_PREVIEW_SIGNING_SECRET
```

Production values = Cloudflare Worker secrets.

Admin login:

```text
POST /api/admin/login
```

Worker issues short-lived signed access token.

Default target expiry:

```text
8 hours
```

Admin browser storage:

```text
sessionStorage
```

No account/reset/refresh-token system Phase 1.

---

# 18. HTTP API

Envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "Document was not found."
  }
}
```

## Public

```text
GET /api/public/categories
GET /api/public/tags
GET /api/public/documents
GET /api/public/documents/:slug
```

## Admin

```text
POST   /api/admin/login
POST   /api/admin/logout

POST   /api/admin/documents
PATCH  /api/admin/documents/:slug
POST   /api/admin/documents/:slug/versions
GET    /api/admin/documents/:slug/versions
POST   /api/admin/documents/:slug/restore/:versionNo
DELETE /api/admin/documents/:slug/versions/:versionNo
DELETE /api/admin/documents/:slug

POST   /api/admin/categories
PATCH  /api/admin/categories/:id
POST   /api/admin/categories/:id/move
DELETE /api/admin/categories/:id

POST   /api/admin/tags
PATCH  /api/admin/tags/:id
POST   /api/admin/tags/:id/merge
DELETE /api/admin/tags/:id
```

## Agent

```text
POST  /api/agent/documents
POST  /api/agent/documents/:slug/versions
GET   /api/agent/documents/:slug
GET   /api/agent/documents
PATCH /api/agent/documents/:slug
POST  /api/agent/documents/:slug/move
GET   /api/agent/categories
GET   /api/agent/tags
```

No destructive Agent routes.

---

# 19. MCP Tool Contract

Use MCP SDK v2 stable line.

Tools:

```text
upload_document
update_document
get_document
list_documents
search_documents
update_metadata
move_document
list_categories
list_tags
```

Tags may be created implicitly by upload/update.

Forbidden:

```text
delete_document
delete_version
restore_version
create_category
rename_category
move_category
delete_category
change_slug
```

MCP is thin:

```text
local file validation
→ Agent API
→ structured result
```

Business rules live in Domain/API.

---

# 20. Dria Contract — Phase 1.5

## Dria Modes

Every request declares scope:

```text
document
library
```

Future:

```text
web
```

is not implemented.

## Ask This Document

Input:

```text
document_id
current version_id
question
```

Retrieval must filter to that document/version where supported.

Answer must distinguish:

- retrieved evidence
- model explanation

If no relevant evidence is retrieved, Dria says the document does not support the answer rather than inventing content.

## Summary

Summary is a Dria action over retrieved/indexed document content.

Quick prompts are UI convenience, not separate business logic.

## Ask My Library

Semantic retrieval across indexed Alexandria content.

Metadata filters may include:

- document_id
- category
- tags
- version/current marker

## Recommendation

Recommendation should combine:

- semantic relevance
- metadata/category/tag relationship
- optionally reading state in future Phase 2

Phase 1.5 has no user reading history unless supplied explicitly in session.

---

# 21. Dria Provider Boundary

Dria must use an internal interface conceptually like:

```ts
interface ModelProvider {
  stream(messages: ModelMessage[], options: ModelOptions): AsyncIterable<ModelChunk>
}
```

Exact implementation may use Cloudflare AI SDK/Agents abstractions, but Domain/Reader UI must not be coupled to one model ID.

Free-first default:

```text
Workers AI
```

Future:

```text
OpenAI
Anthropic
Gemini
other OpenAI-compatible
```

Provider selection through server configuration.

---

# 22. AI Search Boundary

Phase 1 normal Search does NOT depend on AI Search.

Dria retrieval can depend on AI Search.

Index only current versions by default.

When new current version is published:

```text
publish version
→ mark indexing state pending
→ update Dria index
→ mark indexed
```

Library publishing must succeed even if AI Search indexing is temporarily unavailable.

Recommended document metadata for Dria index:

```text
document_id
version_id
slug
title
category
tags
```

---

# 23. Dria Failure Behavior

If Workers AI quota/model is unavailable:

```text
Library continues working
Reader continues working
Dria shows AI temporarily unavailable
```

If AI Search is unavailable:

```text
Metadata Search continues working
Document Reading continues working
Dria retrieval feature reports unavailable
```

Never make AI a dependency of core document publishing/reading.

---

# 24. Error Codes

At minimum:

```text
AUTH_REQUIRED
AUTH_INVALID
AUTH_EXPIRED
AGENT_KEY_INVALID

FILE_REQUIRED
INVALID_FILE_EXTENSION
INVALID_HTML
FILE_TOO_LARGE

TITLE_REQUIRED
CATEGORY_REQUIRED
CATEGORY_NOT_FOUND
CATEGORY_NOT_EMPTY
CATEGORY_CYCLE
CATEGORY_SLUG_CONFLICT

DOCUMENT_NOT_FOUND
SLUG_CONFLICT
SLUG_IMMUTABLE

VERSION_NOT_FOUND
VERSION_IS_CURRENT
LAST_VERSION_CANNOT_DELETE
UNCHANGED

R2_WRITE_FAILED
R2_READ_FAILED
R2_DELETE_FAILED
DATABASE_ERROR

DRIA_UNAVAILABLE
AI_QUOTA_EXCEEDED
AI_SEARCH_UNAVAILABLE
DOCUMENT_NOT_INDEXED
RETRIEVAL_EMPTY
```

---

# 25. Mobile Requirements

Test:

```text
375px
768px
1440px
```

No essential hover-only behavior.

Dria mobile interaction:

```text
floating Ask Dria button
→ bottom sheet / drawer
```

Do not permanently shrink reading width on mobile.

---

# 26. Testing

## Unit

- slug generation
- metadata extraction
- tag normalization
- category cycle
- auth
- version increment
- hash unchanged
- provider boundary
- Dria scope validation

## Integration

- create/update
- category movement
- version restore
- tag merge
- forbidden Agent permissions
- R2/D1 compensation
- Dria indexing state transitions

## Browser

- public browse/search
- Admin login/upload
- stable URL after metadata move
- Reader iframe
- external resource rendering
- mobile Reader
- Admin isolation from iframe
- Dria panel does not break Reader

## MCP

- list tools
- upload
- update
- search
- list categories
- assert forbidden tools absent

## Dria Phase 1.5

- This Document retrieval stays document-scoped
- Library mode may retrieve multiple docs
- empty retrieval does not hallucinate source content
- quota failure is graceful
- core Library remains functional with AI disabled

---

# 27. Definition of Done

## Phase 1

- [ ] Public Library
- [ ] Metadata Search
- [ ] Dynamic Category tree
- [ ] Admin Password
- [ ] Web Upload
- [ ] MCP Upload
- [ ] Stable Slug
- [ ] Immutable Versions
- [ ] Restore append-only
- [ ] Reader Shell
- [ ] iframe isolation
- [ ] External HTML resources supported
- [ ] Mobile tested
- [ ] Agent destructive operations absent
- [ ] secrets server-side only

## Phase 1.5

- [ ] Dria feature-flagged
- [ ] Ask This Document
- [ ] Summarize
- [ ] Ask My Library
- [ ] Reading Recommendation
- [ ] Source scope visible
- [ ] AI Search failure graceful
- [ ] Workers AI failure/quota graceful
- [ ] model configurable
- [ ] no web research
- [ ] Library does not depend on AI availability

---

# 28. Representative HTML Acceptance Fixture

Use:

```text
mauboussin-expectations-investing-summary.html
```

as an acceptance fixture because it contains:

- inline CSS
- responsive media query
- tables
- SVG
- external Google Fonts
- external image URL
- long-form Thai content

The system should preserve and render the original HTML rather than convert it to Markdown.

---

# 29. Final Rule

Phase 1:

> **Alexandria must be an excellent Library without Dria.**

Phase 1.5:

> **Dria must make Alexandria easier to understand without making the Library dependent on AI.**
