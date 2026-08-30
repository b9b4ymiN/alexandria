# TECHSTACK.md — Alexandria Technology Stack

**Project:** Alexandria  
**AI:** Dria  
**Status:** Recommended/approved technical baseline for implementation planning  
**Verified:** 2026-08-30

---

# 1. Technical Goals

The stack is chosen for:

1. Fast public reading
2. Low operational complexity
3. Free-first Cloudflare usage
4. Excellent TypeScript support
5. Agent/MCP compatibility
6. Dria readiness
7. Minimal server infrastructure
8. No unnecessary SSR/backend machinery

Alexandria is primarily:

```text
SPA + API + Object Storage + Metadata DB
```

not an SSR-heavy content site.

---

# 2. Final Stack

```text
WEB
├── React 19.2.x
├── Vite 8.2.x
├── React Router 8.3.x
├── Tailwind CSS 4.3.x
└── TypeScript 6.0.x

CLOUDFLARE APPLICATION
├── Cloudflare Workers
├── Cloudflare Vite Plugin
├── Hono
├── Zod
└── Wrangler

DATA
├── Cloudflare D1
└── Cloudflare R2

DRIA — PHASE 1.5
├── Cloudflare Agents SDK
├── Durable Objects (SQLite-backed)
├── AI Search
└── Workers AI (free-first model provider)

MCP
├── MCP TypeScript SDK v2
├── local stdio MCP server
└── Agent API over HTTPS

PACKAGE / WORKSPACE
├── pnpm
└── lockfile committed

TESTING
├── Vitest
├── Playwright
└── MCP Inspector / protocol tests
```

Use exact patch versions from the lockfile at project creation; the document intentionally pins major/minor families where appropriate.

---

# 3. Why React + Vite Instead of Next.js

Alexandria Phase 1 consists of:

- Library
- Browse
- Search
- Reader
- Admin
- Upload

Most public work is static shell + API data.

We do not require:

- SEO-driven server rendering
- React Server Components
- Server Actions
- ISR
- complex SSR routes

Therefore an SPA removes unnecessary rendering/runtime layers.

Cloudflare officially supports full-stack React SPA + Workers API through the Cloudflare Vite plugin.

Advantages:

```text
static assets at edge
small architecture
fast development
direct Workers bindings
easy API separation
no Node server
```

---

# 4. Why Vite 8

Vite 8 uses **Rolldown**, a Rust-based unified bundler.

Benefits relevant to Alexandria:

- fast dev startup
- fast production build
- modern plugin ecosystem
- first-party Cloudflare integration
- no Next-specific adapter

Vite 8.2 is the current selected minor family for this spec.

---

# 5. Why React Router 8

Use React Router in SPA mode for:

```text
/
/category/:...
/docs/:slug
/admin/...
```

Do not enable server rendering simply because Router supports it.

Use route-level lazy loading so Admin/Dria bundles are not required to open basic public Library pages.

---

# 6. Why Tailwind CSS 4

Use Tailwind for Alexandria application shell only.

Do NOT apply Alexandria Tailwind/CSS to uploaded HTML inside iframe.

Theme direction can later be styled as:

```text
modern classical / editorial / Alexandria library
```

but technical requirement is:

- responsive utilities
- CSS-first configuration
- small UI system
- no heavy component framework required

A component library may be added only if it reduces implementation cost without forcing a mismatched visual style.

---

# 7. TypeScript 6

Use strict TypeScript.

Recommended compiler direction:

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  }
}
```

Separate browser and Worker type environments as needed.

Avoid `any` across API/domain contracts.

---

# 8. Hono

Hono is the HTTP API/router layer.

Routes:

```text
/api/public/*
/api/admin/*
/api/agent/*
```

Hono responsibilities:

- routing
- middleware
- auth middleware
- request parsing
- response envelope

Hono must NOT own all business logic.

Correct:

```text
Hono route
→ Domain Service
→ D1/R2
```

Wrong:

```text
giant Hono route containing SQL + R2 + validation + permissions
```

---

# 9. Zod

Use Zod at external boundaries:

- API inputs
- MCP tool inputs
- environment configuration
- model/tool structured outputs where needed

Do not duplicate domain types unnecessarily.

---

# 10. Cloudflare Workers + Vite Plugin

Use the official Cloudflare Vite plugin.

Why:

- local code runs close to Workers production runtime
- direct binding support
- builds React static assets
- supports SPA + backend Worker
- one modern toolchain

No:

```text
Express server
Nginx
PM2
VPS
Docker runtime
```

required in production.

Docker may still be used for optional local tooling but is not part of production architecture.

---

# 11. D1

D1 stores structured Library metadata:

- documents
- versions
- categories
- tags
- relations

Why D1:

- serverless SQLite semantics
- direct Worker binding
- scale-to-zero
- enough free capacity for this application class
- simple migrations

Current Workers Free allocation verified 2026-08-30:

```text
5 million rows read / day
100,000 rows written / day
5 GB total D1 storage
```

Do not add PostgreSQL unless future requirements require capabilities D1 cannot provide.

---

# 12. R2

R2 stores immutable HTML versions.

Current Standard-storage free tier verified 2026-08-30:

```text
10 GB-month storage / month
1 million Class A operations / month
10 million Class B operations / month
Internet egress free
```

Use:

```text
documents/{document_id}/versions/{version_id}.html
```

R2 is content storage, not metadata database.

---

# 13. Content Origin

Uploaded HTML receives a dedicated browser security origin.

Possible deployment:

```text
alexandria.<domain>
content.<domain>
```

or separate Cloudflare development hostnames initially.

The Reader uses iframe sandbox and origin isolation.

This is required because HTML may execute external JS.

---

# 14. MCP Stack

Use **MCP TypeScript SDK v2**, stable release line implementing the 2026-07-28 spec.

Packages use the v2 split-package architecture such as:

```text
@modelcontextprotocol/server
@modelcontextprotocol/client
```

Phase 1 Alexandria MCP:

```text
local stdio server
```

Why local stdio:

- simple
- works well for developer/desktop Agents
- no remote MCP OAuth complexity
- API key remains local

Flow:

```text
Claude / Codex / Agent
       ↓ stdio MCP
Alexandria MCP Server
       ↓ HTTPS
Alexandria Agent API
```

Do not duplicate domain logic inside MCP.

---

# 15. Dria Stack

Dria is Phase 1.5.

## Cloudflare Agents SDK

Use for:

- durable Agent identity/state
- streaming
- WebSocket interaction
- tool execution
- conversation lifecycle

The Agents SDK is built on Durable Objects.

---

## Durable Objects

Use SQLite-backed Durable Objects.

Free-plan relevant current limits include:

```text
100,000 requests/day
13,000 GB-s duration/day
5 GB total SQLite-backed Durable Object storage/account
```

Dria conversation/state belongs here initially.

Do not store every chat in D1 just because D1 exists.

---

## AI Search

Use Cloudflare AI Search for Dria retrieval instead of building custom:

```text
HTML parser
→ chunker
→ embeddings
→ Vector DB
→ retrieval service
```

unless AI Search proves insufficient.

Current Open Beta free limits verified 2026-08-30:

```text
100 instances/account
100,000 files/instance
20,000 queries/month
4 MB max file
500 website pages crawled/day
```

During Open Beta, AI Search is free within these limits; Workers AI/AI Gateway usage is separate.

### Important Alexandria Implication

Alexandria itself allows HTML larger than AI Search's 4 MB indexing file limit.

Therefore:

> Storage capability and Dria indexing capability are separate.

An oversized HTML document may remain fully readable even if it is not yet Dria-indexable.

---

# 16. Workers AI

Use Workers AI as **free-first Dria model provider**, not as permanent hard-coded model dependency.

Current free allocation verified 2026-08-30:

```text
10,000 Neurons/day
```

Some resource-intensive models require Workers Paid even if the account still has a neuron allocation.

Therefore model selection is configuration, e.g.:

```text
DRIA_MODEL=<available-free-model>
```

Do not bake a specific model into Domain code.

Provider interface should allow future:

- OpenAI
- Anthropic
- Gemini
- other compatible providers

without changing Alexandria document logic.

---

# 17. Dria Free-first Boundary

### Very feasible on free tier

- Ask This Document
- Summarize
- Explain concept
- Library semantic retrieval
- Reading recommendation
- small personal/community chat state

### Not free-first Phase 1.5

- large-scale web browsing
- continuous research agents
- heavy deep research
- browser automation at scale
- high-volume frontier-model usage

Those belong to Phase 3.

---

# 18. AI Is Optional Infrastructure

Core rule:

```text
Alexandria Core
must work with:
DRIA_ENABLED=false
```

If AI quota is exhausted:

- public Library works
- Admin works
- upload works
- MCP document management works
- Reader works
- only Dria becomes temporarily unavailable

---

# 19. Domain Layer

The most important architecture choice for future AI:

```text
Domain Services
├── DocumentService
├── VersionService
├── CategoryService
├── TagService
└── MetadataSearchService
```

Consumers:

```text
Public API
Admin API
Agent API
MCP
Dria
```

This prevents:

```text
API logic
MCP logic
AI logic
```

from becoming three incompatible implementations.

---

# 20. Suggested Workspace

Use pnpm workspace if separating MCP is useful.

Example:

```text
/
├── src/              # app/worker/domain
├── mcp/              # Node/Bun local MCP
├── migrations/
├── tests/
├── package.json
└── pnpm-workspace.yaml
```

Do not create a complex monorepo orchestration layer unless project size justifies it.

No Nx/Turborepo required at start.

---

# 21. Testing Stack

## Vitest

Use for:

- domain tests
- metadata parsing
- slug rules
- permission logic
- version rules

## Playwright

Use for:

- Library
- Admin
- upload
- Reader iframe
- mobile views
- Dria UI integration

## MCP

Use:

- MCP Inspector/current official protocol tooling
- direct tool-contract tests

---

# 22. Performance Strategy

Performance comes primarily from architecture, not framework microbenchmarks.

Alexandria:

```text
Static SPA assets
→ Cloudflare edge

Metadata/API
→ Worker
→ D1

Document body only when opened
→ Content Worker/R2

Dria only when requested
→ Agents/AI Search/Workers AI
```

Rules:

- do not return HTML body in list/search
- route-level lazy load Admin
- route-level lazy load Dria
- paginate document listing
- cache safe public metadata briefly
- do not make AI call during ordinary page load
- do not hydrate uploaded HTML into application DOM

---

# 23. Why Not TanStack Start

TanStack Start is capable and modern, but Alexandria does not require its SSR/server-function feature set in Phase 1.

Choosing it would not make R2/D1 reads inherently faster.

Revisit only if Alexandria later needs:

- server-rendered public SEO pages
- loader/action architecture that materially simplifies product behavior
- richer server rendering requirements

---

# 24. Why Not Next.js

Next.js remains capable, but Alexandria would pay complexity for capabilities it does not need.

Avoiding it removes:

- RSC concerns
- Next-specific runtime behavior
- SSR architecture
- adapter/platform compatibility surface

For Alexandria, the simpler SPA/Worker path is preferred.

---

# 25. Version Policy

Use current stable versions when scaffolding, but respect these families:

```text
React          19.2.x
Vite            8.2.x
React Router    8.3.x
Tailwind        4.3.x
TypeScript      6.0.x
MCP SDK         v2
```

Hono, Zod, Cloudflare SDK packages:

- use latest stable compatible releases
- lock exact versions in `pnpm-lock.yaml`
- do not auto-upgrade major versions without review

---

# 26. Official References Verified 2026-08-30

React versions  
https://react.dev/versions

Vite 8  
https://vite.dev/blog/announcing-vite8

Cloudflare Vite plugin  
https://developers.cloudflare.com/workers/vite-plugin/

Cloudflare React + Vite  
https://developers.cloudflare.com/workers/framework-guides/web-apps/react/

React Router changelog  
https://reactrouter.com/start/start/changelog

Tailwind CSS 4.3  
https://tailwindcss.com/blog/tailwindcss-v4-3

Hono Cloudflare Workers  
https://hono.dev/docs/getting-started/cloudflare-workers

Cloudflare D1 pricing  
https://developers.cloudflare.com/d1/platform/pricing/

Cloudflare R2 pricing  
https://developers.cloudflare.com/r2/pricing/

Cloudflare Durable Objects pricing  
https://developers.cloudflare.com/durable-objects/platform/pricing/

Cloudflare Agents limits  
https://developers.cloudflare.com/agents/platform/limits/

Cloudflare AI Search limits/pricing  
https://developers.cloudflare.com/ai-search/platform/limits-pricing/

Cloudflare Workers AI pricing  
https://developers.cloudflare.com/workers-ai/platform/pricing/

MCP TypeScript SDK v2  
https://ts.sdk.modelcontextprotocol.io/v2/

Cloudflare MCP SDK v2 migration  
https://developers.cloudflare.com/agents/model-context-protocol/guides/migrate-to-mcp-sdk-v2/

TypeScript 6.0  
https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html

---

# 27. Final Stack Principle

Choose:

> **modern, boring-enough primitives at the core; newer AI capability as an optional layer.**

Core Library must remain easy to understand even if Dria is removed entirely.
