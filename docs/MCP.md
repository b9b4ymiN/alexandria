# MCP Server — Alexandria Agent Tools

Written by nodes G5.2 (write tools) and G5.3 (read tools + this document).
Contains no secret values and never should.

The Alexandria MCP server (`mcp/`) is a thin stdio bridge between an MCP
client (an AI agent) and the Alexandria Agent API (SPEC.md §18 Agent). It
performs local file validation and nothing else — every business rule
lives in the Agent API and the Domain Services behind it (AGENT.md §6,
§9). The server never touches SQL or R2 directly.

---

## 1. Configuration

Two environment variables, both required. The server fails fast on
startup with a message on stderr (never stdout — see §4) if either is
missing.

| Variable | Meaning |
|---|---|
| `ALEXANDRIA_API_URL` | Base URL of the Alexandria Worker, e.g. `https://alexandria.vcp-scanner.workers.dev` or `http://127.0.0.1:8787` for local dev. |
| `ALEXANDRIA_AGENT_KEY` | The agent's bearer key, checked against the Worker's `AGENT_API_KEY` secret. Sent only as `Authorization: Bearer <key>` — never logged, never echoed into a tool result or error message, never written to stdout. |

---

## 2. Wiring into an MCP client

Run the server with `node dist/server.js` (after `pnpm --filter
alexandria-mcp build`) and the two variables above set. A typical MCP
client config:

```json
{
  "mcpServers": {
    "alexandria": {
      "command": "node",
      "args": ["/path/to/alexandria/mcp/dist/server.js"],
      "env": {
        "ALEXANDRIA_API_URL": "https://alexandria.vcp-scanner.workers.dev",
        "ALEXANDRIA_AGENT_KEY": "<the agent's key>"
      }
    }
  }
}
```

---

## 3. Tools

Exactly nine tools are registered — no more, no fewer. The tool-contract
test (`mcp/tests/tool-contract.test.ts`) connects a real MCP `Client` to
the real server and asserts this set, so an added or renamed tool that
drifts from this list fails the build, not just this document.

### `upload_document`

Publishes a local `.html` file as a new document in an existing category.

- `filePath` (string, required) — path to a local `.html` file.
- `categoryId` (string, required) — id of an existing category.
- `title`, `description` (string, optional) — override extracted metadata.
- `tags` (string[], optional) — tag names to attach; unknown names are created.
- `note` (string, optional, ≤500 chars) — note for this version.

### `update_document`

Appends a new version to an existing document from a local `.html` file.
Identical bytes report an `unchanged` no-op, not an error.

- `slug` (string, required)
- `filePath` (string, required)
- `note` (string, optional, ≤500 chars)

### `get_document`

Fetches metadata for one existing document by slug, including its public
`contentUrl`. **Never returns HTML body content** — an agent that wants
the content fetches `contentUrl` itself. An unknown slug reports
`DOCUMENT_NOT_FOUND` verbatim.

- `slug` (string, required)

### `list_documents`

Lists published documents, paginated, optionally filtered by category or
tag. No text query — use `search_documents` for that. An out-of-range
page is clamped by the API, not rejected; an empty result set is a normal
empty page, not an error.

- `page`, `pageSize` (number, optional)
- `categoryId` (string, optional)
- `depth` (`"self"` | `"subtree"`, optional)
- `tag` (string, optional)

### `search_documents`

The same endpoint and query semantics as `list_documents`, plus a text
`query` matched against title, description, category and tags — including
non-Latin scripts, exactly like the public Library search.

- `query` (string, required)
- `page`, `pageSize`, `categoryId`, `depth`, `tag` — same as `list_documents`

### `update_metadata`

Updates title, description and/or tags on an existing document. The slug
itself never changes.

- `slug` (string, required)
- `title`, `description` (string, optional)
- `tags` (string[], optional) — replaces the full tag set

### `move_document`

Moves an existing document into an existing category. The target category
must already exist (`CATEGORY_NOT_FOUND` otherwise) — this tool never
creates one.

- `slug` (string, required)
- `categoryId` (string, required)

### `list_categories`

Lists every category in the library's tree in one call. No input. Each
row carries its own `parentId`, so a caller can reconstruct the tree
itself.

### `list_tags`

Lists every tag with its document count. No input.

---

## 4. What is deliberately unavailable, and why

This server never exposes a way to:

- **delete a document or a version, or restore a version** (no
  `delete_document`, `delete_version`, `restore_version`) — these are
  irreversible operations Phase 1 reserves for Admin only.
- **create, rename, move or delete a category** (no `create_category`,
  `rename_category`, `move_category`, `delete_category`) — the Category
  tree is Admin-owned (AGENT.md §5, §32); an agent that does not find a
  category it expected gets `CATEGORY_NOT_FOUND`, not a newly invented
  one.
- **change a document's slug** (no `change_slug`) — the slug is stable by
  design (AGENT.md §5); title, category, tag and version changes never
  move a document's URL.

This is a permission boundary, not an omission to be filled in later
(AGENT.md §6, §29). It is enforced at the Agent API itself — none of these
routes exist to call — and locked here by
`mcp/tests/tool-contract.test.ts`, which fails the build if any of the
eight names above is ever registered. Read tools additionally never
require write scope and never mutate anything, proved the same way
(`mcp/tests/e2e.test.ts`, database state captured before and after every
read tool call).
