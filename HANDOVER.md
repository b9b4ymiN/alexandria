# HANDOVER — Alexandria

**Written:** 2026-09-06 · **Branch:** `main` · **Phase:** 1, milestones 1 and 2 complete and deployed

Read this first, then `IMPLEMENTATION_PLAN.md` for the node graph. `AGENT.md`
still governs how the work is done; nothing here overrides it.

---

## 1. Where things stand

**20 of 34 nodes are DONE.** Milestones 1 and 2 are merged into `main` and
pushed. No other branch exists — the milestone branches were deleted after
merging, and every commit remains reachable under its `--no-ff` merge commit.

```text
M1  Vertical Slice          ✅ 13 nodes   CHECKPOINT A passed except one item (§4)
M2  Categories & Tags       ✅  7 nodes   CHECKPOINT B passed
M3  Versioning              ⬜  5 nodes   G3.1 … G3.5   ← next
M4  Search                  ⬜  2 nodes   G4.1, G4.2
M5  Agent API & MCP         ⬜  3 nodes   G5.1 … G5.3
M6  Security, QA & Release  ⬜  4 nodes   G6.1 … G6.4
```

Current suite state on `main`:

```text
305 vitest across 18 files · 54 browser · 10 PWA
typecheck (3 tsconfig projects) · lint · build — all clean
the admin chunk is still split from the public entry
```

---

## 2. Production is current with `main`

M1 and M2 are both deployed. Verified live on 2026-09-06 immediately after
deploying:

```text
GET /api/public/tags          200, returns the tag list      (was 404 on M1)
GET /api/public/categories    nested tree with descendantDocumentCount
GET /api/public/documents?tag=investing   filters correctly
GET /api/public/documents?categoryId=does-not-exist   404 CATEGORY_NOT_FOUND
GET /api/admin/categories     401 without a token
/manifest.webmanifest, /sw.js 200
content /health               200
```

The acceptance document still serves byte-identically end to end: sha256 of
the bytes fetched from the content origin equals the local source file.

Deployed versions: `alexandria` `c5abdc49`, `alexandria-content` `e5761b18`.
A pre-deploy D1 snapshot is at `backup-pre-m2-deploy.sql` (git-ignored). No
migration was needed — M2 added none.

**When you deploy again, the order and the config matter.** Content Worker
first, then the app Worker, and the app Worker must be deployed from the
config the BUILD emits, not from `wrangler.jsonc`: the Cloudflare Vite plugin
supplies `assets.directory` at build time, so the source config alone fails
with "missing the required `directory` property".

```bash
pnpm build
pnpm exec wrangler deploy -c wrangler.content.jsonc
pnpm exec wrangler deploy -c dist/alexandria/wrangler.json
```

Take a `wrangler d1 export --remote` snapshot before any deploy that carries
a migration. M3 will carry none either, but M3 changes version and delete
semantics, so snapshot anyway before deploying it.

---

## 3. Live resources

```text
app origin      https://alexandria.vcp-scanner.workers.dev
content origin  https://alexandria-content.vcp-scanner.workers.dev
D1              alexandria-db    ea0c8183-e89a-46ea-9348-a0d8ac220f46  (APAC)
R2              alexandria-docs
GitHub          b9b4ymiN/alexandria (private)
```

All four secrets are set. `alexandria-content` holds ONLY
`CONTENT_PREVIEW_SIGNING_SECRET` — never add an admin or agent secret to it,
that separation is the origin-isolation guarantee. The production
`AGENT_API_KEY` is in the git-ignored `.secrets.local`; node G5.2 will need it.

Local development uses `.dev.vars` with throwaway values unrelated to
production. `pnpm dev` serves the app; `pnpm seed:local` seeds fixtures.

---

## 4. Open items carried forward

**CHECKPOINT A is one item short.** Reading has never been verified on a real
phone on a different network. 375/768/1440 pass in Playwright, but an
emulated viewport is not the same test. This belongs to the project owner and
was never claimed as done.

**ETag is stripped by Cloudflare's edge.** The content Worker sets one and
handles `If-None-Match` correctly — proven in the Workers runtime — but the
header never reaches a client in production, in either strong or weak form.
Conditional requests therefore return 200 with the full body instead of 304.
This is edge behaviour, not a defect; `cache-control: public, max-age=60`
still absorbs repeat reads. Worth revisiting with a custom domain, where
zone-level ETag behaviour is configurable.

**Thai truncation is over-conservative.** The description truncator retreats
past a legitimate trailing combining mark, because the test asserts on the
last code point rather than on the cut index falling at a grapheme boundary.
It can drop one extra syllable at the 300-character limit and never produces
broken output. The correct fix is to assert the boundary condition directly
and let the implementation stop over-retreating. Deliberately deferred to M6.

**Running the browser suite several times inside one minute can trip the
login rate limiter.** Node G1.6 allows 10 login attempts per minute per IP.
`tests/browser/admin-session.ts` reduces a whole run to a single API login
shared across workers, but two tests in `admin-upload.spec.ts` still drive
the real login form on purpose — those are what can trip it. That is the
limiter working. A single run is deterministic.

---

## 5. What M3 has to do next

`G3.1 → G3.2 → G3.3`, with `G3.4` able to run alongside `G3.2`/`G3.3`, then
`G3.5` last. Full contracts are in `IMPLEMENTATION_PLAN.md`.

M3 carries the invariants most easily broken by a plausible-looking change,
so it deserves the same evidence discipline M1 and M2 got:

- **Restore is append-only.** Restoring v2 while v4 is current creates v5
  carrying `restored_from_version_no = 2`. The current pointer must never
  move backwards.
- **Restore of identical bytes still creates a version**, unlike an upload
  of identical bytes which returns `UNCHANGED`. Restoring is an editorial
  act and history must record it. This divergence is intentional — see the
  clarification on node G3.1 before "fixing" it.
- **`UNCHANGED` is not an error.** `ERROR_STATUS` maps it to 409 because
  SPEC §24 lists it, but the version-create route returns HTTP 200 with
  `{ unchanged: true }` through `ok()`, never `fail()`.
- **Delete ordering is the mirror of create.** Create writes R2 then D1, so
  a failure leaves an orphaned object rather than dangling metadata. Delete
  removes D1 first, then R2, for the same reason. Collect every `r2_key`
  before the cascade — the rows are the only record of those keys.
- **The current version and the last remaining version cannot be deleted.**
- **`G3.4` needs `CONTENT_PREVIEW_SIGNING_SECRET`**, which is already set on
  both Workers. The signature must bind document, version and expiry
  together so it cannot be replayed across documents.

---

## 6. How this project works, for a fresh session

The main session is the **Graph Orchestrator**: it holds the plan, dispatches
one node per `sonnet-executor` subagent, verifies the evidence itself, and
merges. It does not implement. Implementation nodes go to executors.

Rules learned the hard way, all of which are now in every dispatch packet:

- **Verify, do not accept.** Re-run the commands yourself. Every defect that
  mattered was found by the orchestrator re-running something, not by
  reading a report. Executors have misattributed failures to other nodes and
  reported caveats that did not reproduce.
- **An executor's attribution is a claim to be checked**, not a finding. One
  node blamed another for a typecheck failure it had caused itself.
- **Never `git commit --amend`** when nodes run in parallel — the tip may be
  another node's commit. This happened once and was recovered.
- **Stage by explicit path.** Never `git add -A` while a parallel node has
  uncommitted work in the tree.
- `src/api/app.ts`, the three `routes/*/index.ts`, `vitest.config.ts`,
  `playwright.config.ts` and `IMPLEMENTATION_PLAN.md` are single-writer.
  An executor that thinks it needs one must STOP and report.
- **Run the full suite on a tree nobody is writing to.** Both CHECKPOINT B
  defects were invisible until then.
- A scan that trips on prose trains people to ignore it — strip comments
  before asserting on source.

Branch policy (§12.1 of the plan): one branch per milestone, one commit per
node using the node's `Suggested Commit`, merged to `main` with `--no-ff`
only after the checkpoint passes and its evidence is verified.

Plan Delta 1 (§12.2) is the precedent for scope arriving outside the graph:
record the impact, get approval, then resume. Do not silently absorb it.
