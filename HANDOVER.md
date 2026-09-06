# HANDOVER — Alexandria

**Written:** 2026-09-06 · **Branch:** `main` · **Phase:** 1, milestones 1-3 complete and deployed

Read this first, then `IMPLEMENTATION_PLAN.md` for the node graph. `AGENT.md`
still governs how the work is done; nothing here overrides it.

---

## 1. Where things stand

**25 of 34 nodes are DONE.** Milestones 1, 2 and 3 are merged into `main` and
pushed. No other branch carries work — each milestone branch is merged with
`--no-ff` and every commit stays reachable under its merge commit.

```text
M1  Vertical Slice          ✅ 13 nodes   CHECKPOINT A passed
M2  Categories & Tags       ✅  7 nodes   CHECKPOINT B passed
M3  Versioning              ✅  5 nodes   CHECKPOINT C passed
M4  Search                  ⬜  2 nodes   G4.1, G4.2            ← next
M5  Agent API & MCP         ⬜  3 nodes   G5.1 … G5.3
M6  Security, QA & Release  ⬜  4 nodes   G6.1 … G6.4
```

Current suite state on `main`:

```text
384 vitest across 23 files · 63 browser · 10 PWA
typecheck (3 tsconfig projects) · lint · build — all clean
the admin chunk is still split from the public entry
```

**The project owner wants M5 (MCP) as early as possible.** A fast path that
pulls M5 forward was costed and declined on 2026-09-06 in favour of the
normal order, so M4 is the only milestone standing between here and MCP.

---

## 2. Production is current with `main`

M3 was deployed on 2026-09-06 and verified live immediately afterwards.

```text
alexandria          version 0f4f5ec6-98a1-4991-b32b-c4105bce96f3
alexandria-content  version a0c978a5-ac24-49d5-9cd6-9ebafca06103
```

Verified against production after deploying:

```text
GET /api/admin/documents/:slug/versions                       401 without a token
GET /api/admin/documents/:slug/versions/1/preview-url         401
POST /api/admin/documents/:slug/restore/1                     401
DELETE /api/admin/documents/:slug/versions/1                  401
DELETE /api/admin/documents/:slug                             401
content /p/<uuid>/<uuid>            no sig, junk sig, non-uuid path — all 403
content /d/:slug                    200, cache-control public max-age=60,
                                    CSP frame-ancestors still the app origin
content /health                     200
/api/public/documents, /tags, /categories                     200
```

The acceptance document still serves byte-identically: sha256 of the bytes
fetched from `/d/expectations-investing` equals the local source file,
205 804 bytes,
`45513e69cab29124be843ea6896d947bdff2e69abff05e49bc09328112035ad4`.

**Not verified against production: the signed-preview happy path.** Issuing a
real preview URL needs an admin login, which was deliberately not performed.
Every rejection path was checked live, and the full happy path is covered by
`tests/integration/preview-signing.test.ts` against real D1 and R2 bindings.
Worth doing by hand once, from the admin screen, when someone next logs in.

A pre-deploy D1 snapshot is at `backup-pre-m3-deploy.sql` (git-ignored, as is
`backup-pre-m2-deploy.sql`). **M3 carried no migration** — the schema has not
changed since `0002`.

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
a migration. M4 adds search; if it adds an index it becomes the first
migration since M2, so snapshot before deploying it.

---

## 3. Live resources

```text
app origin      https://alexandria.vcp-scanner.workers.dev
content origin  https://alexandria-content.vcp-scanner.workers.dev
D1              alexandria-db    ea0c8183-e89a-46ea-9348-a0d8ac220f46  (APAC)
R2              alexandria-docs
GitHub          b9b4ymiN/alexandria (private)
```

All secrets are set. `alexandria-content` holds ONLY
`CONTENT_PREVIEW_SIGNING_SECRET`, which node G3.4 now actually uses to verify
preview signatures — never add an admin or agent secret to it, that
separation is the origin-isolation guarantee. The production `AGENT_API_KEY`
is in the git-ignored `.secrets.local`; node G5.2 will need it.

Local development uses `.dev.vars` with throwaway values unrelated to
production. `pnpm dev` serves the app; `pnpm seed:local` seeds fixtures.

---

## 4. Open items carried forward

**A version note longer than 500 characters is rejected with
`INVALID_HTML`.** This is not a G3.1 invention — the G1.7 create route
already uses `INVALID_HTML` as the catch-all for field validation — but node
G5.2 requires MCP to surface error codes verbatim to agents, so an agent that
sends an over-long note would be told to fix its HTML. **Decide before G5.1**
whether to add a `NOTE_TOO_LONG` code. The precedents are G2.2's
`TAG_NAME_TOO_LONG` and G3.3's `CONFIRMATION_MISMATCH`: SPEC §24 opens with
"At minimum", so additive codes are authorized extensions, not deviations.

**ETag is stripped by Cloudflare's edge.** The content Worker sets one and
handles `If-None-Match` correctly — proven in the Workers runtime — but the
header never reaches a client in production, in either strong or weak form.
Conditional requests therefore return 200 with the full body instead of 304.
This is edge behaviour, not a defect; `cache-control: public, max-age=60`
still absorbs repeat reads. Worth revisiting with a custom domain, where
zone-level ETag behaviour is configurable.

**The version-preview dialog does not bounce to login when the admin session
expires mid-request.** It shows an inline error instead. Outside G3.5's
required tests and not a regression, since the feature is new. Left for M6.

**Running the browser suite several times inside one minute can trip the
login rate limiter.** Node G1.6 allows 10 login attempts per minute per IP.
`tests/browser/admin-session.ts` reduces a whole run to a single API login
shared across workers, but two tests in `admin-upload.spec.ts` still drive
the real login form on purpose — those are what can trip it. That is the
limiter working. A single run is deterministic.

**Closed and no longer tracked.** CHECKPOINT A's real-phone verification was
completed by the project owner on 2026-09-06. The Thai description
truncator's over-conservative retreat past a legitimate trailing combining
mark is accepted as final behaviour, not a deferred M6 fix: it never produces
broken output and can only drop one extra syllable at the 300-character
limit. The full analysis stays in the `G1.4` evidence block of
`IMPLEMENTATION_PLAN.md`.

---

## 4b. Start here, next session

Everything through M3 is merged, pushed and deployed, `main` is clean and
equals `origin/main`, and the merged `feat/m3-versioning` branch has been
deleted. There is no work in flight and nothing half-finished in the tree.

To pick up M4:

```bash
git switch -c feat/m4-search        # orchestrator owns branching (§12.1)
sed -n '/^## Node G4.1/,/^## Node G4.2/p' IMPLEMENTATION_PLAN.md
```

Then dispatch `G4.1` to one `sonnet-executor` with a packet that carries: the
node contract, the file allowlist, the single-writer STOP list from §6 below,
"run no git command that writes", and the baseline to beat — **384 vitest
across 23 files, 63 browser, 10 PWA, clean typecheck, lint and build**. Verify
the evidence by re-running it yourself before committing, using the node's
`Suggested Commit` line verbatim as the subject.

**One decision is owed before M5 starts, not before M4:** whether an
over-long version note should return a new `NOTE_TOO_LONG` code instead of
`INVALID_HTML`. See §4. It costs one small change now and gets more expensive
once MCP is surfacing codes to agents.

---

## 5. What M4 has to do next

`G4.1 → G4.2`, then M5. Full contracts are in `IMPLEMENTATION_PLAN.md`.

`src/domain/search/` exists and is empty — G4.1 owns it. Two things to carry
into the work:

- **Metadata search only.** Title, description, category and tags. No
  embeddings, no AI Search — that is Dria infrastructure and belongs to
  Phase 1.5 (AGENT.md §15). Do not merge the two implementations.
- **G4.1 is what M5 actually needs from M4.** The MCP tool
  `search_documents` is served by the same metadata search, and node G5.1
  reads `src/domain/search/metadata-search-service.ts` directly. G4.2 is the
  library UI and blocks nothing in M5.

---

## 6. How this project works, for a fresh session

The main session is the **Graph Orchestrator**: it holds the plan, dispatches
one node per `sonnet-executor` subagent, verifies the evidence itself, and
merges. It does not normally implement.

Rules learned the hard way, all of which are now in every dispatch packet:

- **Verify, do not accept.** Re-run the commands yourself and read the tests
  that guard the invariants. Every defect that mattered was found by the
  orchestrator re-running something, not by reading a report.
- **An executor's attribution is a claim to be checked**, not a finding.
- **Check the node's own Files list against §9's parallel pairings before
  dispatching.** §9 claimed `G3.2 || G3.4` was safe, but G3.4's Files list
  also modifies the route file G3.2 extends. Caught before dispatch; the
  pairing was withdrawn and G3.4 now pairs with G3.3 at no extra wave.
- **The commit subject must be the node's `Suggested Commit` line verbatim**
  (§12.1 rule 2). One node's subject was written from memory and had to be
  amended.
- **Never `git commit --amend`** when nodes run in parallel — the tip may be
  another node's commit.
- **Stage by explicit path.** Never `git add -A` while a parallel node has
  uncommitted work in the tree.
- `src/api/app.ts`, the three `routes/*/index.ts`, `src/shared/errors.ts`,
  `vitest.config.ts`, `playwright.config.ts` and `IMPLEMENTATION_PLAN.md` are
  single-writer. An executor that thinks it needs one must STOP and report.
- **Run the full suite on a tree nobody is writing to.** Both CHECKPOINT B
  defects were invisible until then.
- A scan that trips on prose trains people to ignore it — strip comments
  before asserting on source.

Two things M3 added to this list:

- **Executors can die on dispatch when the account hits a session limit.**
  Both wave-2 executors did, at once. The tree was completely clean, so the
  orchestrator implemented G3.3 and G3.4 directly rather than stalling the
  milestone. Check the tree first: a partially-written node is a different
  situation from a node that never started.
- **A raw control character in a source file silently disables review.** Two
  NUL bytes left in `document-edit.tsx` by G2.3 made git treat it as binary,
  so an 11KB screen arrived as `Bin 9098 -> 20400` with no diff. Fixed in
  `77a9ed2`. If `git diff --stat` says `Bin` for a source file, stop and find
  out why before reviewing anything else in that node.

Branch policy (§12.1 of the plan): one branch per milestone, one commit per
node using the node's `Suggested Commit`, merged to `main` with `--no-ff`
only after the checkpoint passes and its evidence is verified.

Plan Delta 1 (§12.2) is the precedent for scope arriving outside the graph:
record the impact, get approval, then resume. Do not silently absorb it.
