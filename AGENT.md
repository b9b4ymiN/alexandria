# AGENT.md — Alexandria Agent & Developer Rules

**Project:** Alexandria  
**AI:** Dria  
**Phase:** 1 foundation; Phase 1.5 Dria-compatible  
**Last updated:** 2026-08-30

---

# 1. Mandatory Reading Order

Before touching code:

```text
1. GOAL.md
2. SPEC.md
3. TECHSTACK.md
4. AGENT.md
```

Do not implement from AGENT.md alone.

---

# 2. Mission

Alexandria is:

> A fast public HTML reading library that humans and authorized Agents can publish to, with Dria as a later AI Reading Companion.

Phase 1 priority:

```text
Store
Organize
Read
Update
```

Phase 1.5:

```text
Ask
Summarize
Retrieve
Recommend
```

---

# 3. Hard Scope Gate

## Phase 1

Build only:

- Library
- Metadata Search
- Category Tree
- Tags
- Admin Password
- HTML Upload
- Stable Slug
- Version History
- Reader iframe
- MCP
- Cloudflare deployment

## Phase 1.5

Only when explicitly started:

- Dria
- Ask This Document
- Summarize
- Ask My Library
- Reading Recommendation
- AI Search
- Agents SDK
- Durable Object chat/state
- Workers AI

## Do Not Build Yet

- Google Login
- Google Drive
- user accounts
- community
- likes
- reading status
- social feed
- comments
- web research
- browser research
- autonomous deep research
- billing

---

# 4. Technology Is Locked

Baseline is defined in `TECHSTACK.md`.

Do not replace:

```text
React + Vite
Cloudflare Workers
Hono
D1
R2
```

with:

```text
Next.js
PostgreSQL
Firebase
Supabase
Express
VPS
```

without explicit architecture approval.

Do not adopt a new framework because it is fashionable.

---

# 5. Core Invariants

## Stable Slug

Title/category/tag/version changes never mutate slug automatically.

## Immutable Version

Never overwrite current HTML object.

New bytes = new version.

## Restore Append-only

Restore creates newest version from old bytes.

## Category Ownership

Admin owns category structure.

Agent can only use existing categories.

## Flexible Tags

Admin and Agent may create Tags.

## Public Read

Current published document is readable without Login.

## Controlled Write

Only Admin/authorized Agent writes.

---

# 6. Agent Permission Boundary

MCP may expose:

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

MCP MUST NOT expose:

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

Do not add a destructive tool “for convenience”.

---

# 7. HTML Rules

One version:

```text
one .html file
```

Preserve bytes.

Do not:

- inject CSS
- rewrite scripts
- convert to Markdown
- make mobile fixes inside content
- download and re-host external assets

External resources are allowed.

The platform can warn about missing viewport metadata but does not rewrite.

---

# 8. iframe Security

Uploaded HTML may execute JavaScript.

Treat this as untrusted browser execution even though uploader is authorized.

Required:

- content origin separate from app/admin origin
- sandboxed iframe
- no `allow-same-origin` by default
- no Admin token sent to iframe
- content origin not trusted by Admin API CORS

Never weaken this boundary just to fix one report.

Escalate for review.

---

# 9. Domain-first Architecture

Business rules belong in focused Domain Services.

Example:

```text
DocumentService
VersionService
CategoryService
TagService
MetadataSearchService
```

Consumers:

```text
Hono API
MCP
Dria
```

Do not copy logic between them.

---

# 10. Hono Rule

Hono = transport/router.

Good:

```text
route
→ validate
→ authorize
→ Domain Service
→ response
```

Bad:

```text
route
→ 300 lines SQL + R2 + permissions + version calculation
```

---

# 11. D1 Rules

Use:

- migrations
- prepared statements
- foreign keys
- transactions/batches

Never concatenate user input into SQL.

Never edit production schema manually.

---

# 12. R2 Rules

Use immutable keys:

```text
documents/{document_id}/versions/{version_id}.html
```

Do not use slug/title/category as physical identity.

Handle R2+D1 partial failure with compensation.

---

# 13. Auth Rules

Secrets must never appear in:

- Git
- Vite client env
- logs
- iframe URL
- MCP output

Server secrets include:

```text
ADMIN_PASSWORD
ADMIN_SESSION_SIGNING_SECRET
AGENT_API_KEY
CONTENT_PREVIEW_SIGNING_SECRET
```

---

# 14. Metadata Rules

Deterministic first.

Title:

```text
<title> → h1 → filename
```

Description:

```text
meta description → og description → paragraph → empty
```

Tags:

```text
meta keywords + explicit tags
```

Category:

```text
existing category only
```

Do not use Dria to auto-create core taxonomy.

---

# 15. Search Rules

Normal Library Search:

```text
title
description
category
tags
```

No embeddings.

Dria retrieval:

```text
AI Search
```

Do not merge these implementations.

---

# 16. Dria Identity

AI name is always:

> **Dria**

User-facing copy should not silently rename it to Alexandria AI, Assistant, Copilot, Athena, etc.

Preferred concepts:

```text
Ask Dria
Dria
Ask this document
Ask my library
```

---

# 17. Dria Role

Dria is a **Reading Companion**, not a generic chatbot.

Primary jobs:

1. summarize Alexandria content
2. explain content
3. answer from current document
4. retrieve across Library
5. recommend reading

Phase 1.5 Dria MUST NOT browse the public web.

---

# 18. Dria Grounding Rule

Every Dria request has a source scope:

```text
document
library
```

If retrieval does not support a claim:

- say evidence was not found
- do not invent what the document/book says
- model background knowledge must not masquerade as source content

Future web mode must be explicitly distinct.

---

# 19. Dria Is Optional

Core must work:

```text
DRIA_ENABLED=false
```

AI error/quota must never break:

- Library
- Reader
- Admin
- Upload
- MCP
- Version update

---

# 20. Dria Model Rule

Workers AI is free-first.

But do not hard-code one model throughout source.

Use config/provider boundary.

Model availability/pricing changes faster than Alexandria business requirements.

---

# 21. AI Search Rule

AI Search is Dria infrastructure only.

Index current versions by default.

When index is stale:

- expose indexing status where needed
- do not block publishing

Do not silently truncate oversized document content.

---

# 22. UI Rules

## Library

Browse and Search both matter.

## Reader

Reading content gets priority.

Desktop Dria may use side panel.

Mobile Dria uses drawer/bottom sheet.

## Admin

Function over decoration.

## Uploaded HTML

App theme must not leak into iframe.

---

# 23. No Cover Images Phase 1

Do not add:

- cover upload
- screenshot generation
- OG image extraction

unless separately approved.

---

# 24. Mobile Rules

Verify:

```text
375px
768px
1440px
```

No essential hover-only action.

Do not force desktop Dria sidebar onto mobile.

---

# 25. Performance Rules

Do not make API/AI calls that are not needed.

Specifically:

- no AI call on normal Library page load
- no HTML body in document list
- lazy load Admin
- lazy load Dria
- paginate lists
- raw content loaded only when reader opens document

Performance optimization must be measured before adding cache infrastructure.

---

# 26. Dependency Rules

Before adding a package:

1. Can Web Platform/Cloudflare already do this?
2. Does existing dependency already do this?
3. Is package still necessary?

Do not add without need:

- ORM
- Redis
- external auth platform
- search server
- state management framework
- monorepo orchestration framework

---

# 27. TypeScript Rules

Use TypeScript 6 strict.

Avoid `any`.

Validate external input with Zod or equivalent approved schema.

Keep domain types reusable.

---

# 28. Testing Workflow

For any non-trivial change:

```text
read relevant spec
→ identify invariant
→ write/adjust test
→ run failing/targeted test where applicable
→ implement
→ run targeted tests
→ run relevant full suite
→ inspect diff
```

Do not claim completion without fresh verification evidence.

---

# 29. Required Negative Tests

Maintain tests proving:

- public cannot write
- invalid Agent key cannot write
- Agent cannot create Category
- Agent cannot delete document
- Agent cannot restore
- current version cannot be deleted
- last version cannot be deleted
- slug does not auto-change
- content iframe cannot access Admin session
- Dria disabled does not break Reader
- Dria document scope cannot retrieve unrelated document as source

---

# 30. Phase 1 DoD

Before marking Phase 1 task/feature complete, check relevant items:

- [ ] requirement traceable to SPEC
- [ ] no Phase 2 feature slipped in
- [ ] tests pass
- [ ] permission boundary tested
- [ ] secrets safe
- [ ] stable slug preserved
- [ ] immutable versions preserved
- [ ] mobile relevant view checked
- [ ] no unnecessary dependency
- [ ] docs updated if behavior changed

---

# 31. Phase 1.5 Dria DoD

- [ ] Dria can be disabled
- [ ] scope clearly document/library
- [ ] retrieval grounding tested
- [ ] empty retrieval handled
- [ ] AI quota handled
- [ ] AI Search failure handled
- [ ] Library remains independent
- [ ] no web browsing
- [ ] no destructive Alexandria tools
- [ ] model/provider not coupled to Domain layer

---

# 32. Common Wrong Decisions

## Wrong

```text
update report
→ overwrite R2 current object
```

Correct:

```text
new immutable version
```

## Wrong

```text
move Category
→ change document URL
```

Correct:

```text
stable slug
```

## Wrong

```text
Agent does not find category
→ creates new category
```

Correct:

```text
CATEGORY_NOT_FOUND
```

## Wrong

```text
Dria answer sounds plausible
→ claim book says it
```

Correct:

```text
retrieve supporting Alexandria content first
```

## Wrong

```text
AI Search down
→ document cannot open
```

Correct:

```text
document reading independent from AI
```

## Wrong

```text
add Next.js because AI features need server
```

Correct:

```text
Workers/Agents provide server capability already
```

---

# 33. Approval Gate

Explicit approval required before changing:

- project phase
- Cloudflare-first architecture
- React/Vite choice
- D1/R2 model
- iframe/origin isolation
- Admin auth model
- Agent permissions
- stable slug
- version semantics
- Dria scope
- AI provider architecture
- public web research capability

---

# 34. Final Rule

When choosing between cleverness and clarity:

> **Choose the smallest architecture that keeps Alexandria stable and leaves Dria optional.**
