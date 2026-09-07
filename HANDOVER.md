# HANDOVER — Alexandria

**Written:** 2026-09-06 · **Branch:** `main` · **Phase:** 1, milestones 1-4
complete; 1-3 deployed, **M4 is merged and pushed but NOT yet deployed**

Read this first, then `IMPLEMENTATION_PLAN.md` for the node graph. `AGENT.md`
still governs how the work is done; nothing here overrides it.

---

## 1. Where things stand

**27 of 34 nodes are DONE.** Milestones 1 through 4 are merged into `main` and
pushed. No other branch carries work — each milestone branch is merged with
`--no-ff` and every commit stays reachable under its merge commit.

```text
M1  Vertical Slice          ✅ 13 nodes   CHECKPOINT A passed
M2  Categories & Tags       ✅  7 nodes   CHECKPOINT B passed
M3  Versioning              ✅  5 nodes   CHECKPOINT C passed
M4  Search                  ✅  2 nodes   CHECKPOINT D passed   (not deployed)
M5  Agent API & MCP         ⬜  3 nodes   G5.1 … G5.3            ← next
M6  Security, QA & Release  ⬜  4 nodes   G6.1 … G6.4
```

Current suite state on `main`:

```text
409 vitest across 24 files · 76 browser · 10 PWA
typecheck (3 tsconfig projects) · lint · build — all clean
the admin chunk is still split from the public entry
```

**The project owner wants M5 (MCP) as early as possible, and nothing stands
in front of it any more.** A fast path that pulled M5 forward was costed and
declined on 2026-09-06 in favour of the normal order; M4 has since completed,
so `G5.1` is now unblocked and is the next node.

---

## 2. Production is one milestone BEHIND `main`

**Production still runs M3.** M4 is merged and pushed but was deliberately
not deployed in the session that built it — the decision was left to the
project owner. Nothing about M4 needs a migration (the schema is unchanged
since `0002`), and M4 touches only the app Worker, never the content Worker,
so deploying it is the app Worker alone:

```bash
pnpm build
pnpm exec wrangler deploy -c dist/alexandria/wrangler.json
```

Deploy the content Worker too ONLY if something under `src/content/` or
`wrangler.content.jsonc` has changed since; M4 changed neither. The app
Worker must be deployed from the config the BUILD emits, not from
`wrangler.jsonc`: the Cloudflare Vite plugin supplies `assets.directory` at
build time, so the source config alone fails with "missing the required
`directory` property".

Worth checking by hand after deploying M4, since no test can prove it in
production: a Thai query and an English query from the live Library search
box, a shared `?q=…&page=2` link opening on the right page, and the
`?query=` alias still resolving for any old link.

### What M3's deployment verified, still true

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
sends an over-long note would be told to fix its HTML. **This is now DUE:
decide it before G5.1, which is the next node.** The precedents are G2.2's
`TAG_NAME_TOO_LONG`, G3.3's `CONFIRMATION_MISMATCH` and now G4.1's
`SEARCH_QUERY_TOO_LONG`: SPEC §24 opens with "At minimum", so additive codes
are authorized extensions, not deviations. G4.1 settled the identical
question the same way, for the same reason, one milestone earlier — the
recommendation is to add `NOTE_TOO_LONG` (400) and be consistent. Adding a
code means editing `src/shared/errors.ts` AND the hand-written list in
`tests/unit/errors.test.ts`, which has TWO places to update: the
`SPEC_PHASE_1_CODES` array and the `expected` status map. That test is
designed to fail when only one is changed; that is the review gate working.

**Accent folding in search covers 12 Latin letters, not the full set.**
`LATIN_DIACRITIC_MAP` in `src/domain/search/metadata-search-service.ts` folds
é è á à ä í ó ö ú ü ñ ç in both cases. D1 enforces SQLite's expression-tree
depth limit, and the limit is what caps it — measured directly rather than
guessed: a bare REPLACE chain takes 97 links, the real search query shape
takes 42, and hoisting the tag match out of its correlated `EXISTS` into a
CTE was tried and takes 43, so that redesign bought one link and was
rejected. â ê î ô û, ã õ, å ø, ý ÿ and all of Latin Extended-A therefore do
not fold. The complete fix is a normalized comparison column, which G4.1
requirement 9 defers until search measures slow; it needs a migration, so it
is a future node and a Plan Delta, not a quiet widening of G4.1.

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

Everything through M4 is merged and pushed, `main` is clean and equals
`origin/main`, and the merged `feat/m4-search` branch has been deleted. There
is no work in flight and nothing half-finished in the tree. The one thing
NOT done is deploying M4 — see §2, and settle it with the project owner
before or after M5 as they prefer; M5 does not depend on it.

To pick up M5:

```bash
git switch -c feat/m5-mcp           # orchestrator owns branching (§12.1)
sed -n '/^## Node G5.1/,/^## Node G5.2/p' IMPLEMENTATION_PLAN.md
```

Then dispatch `G5.1` to one `sonnet-executor` with a packet that carries: the
node contract, the file allowlist, the single-writer STOP list from §6 below,
"run no git command that writes", and the baseline to beat — **409 vitest
across 24 files, 76 browser, 10 PWA, clean typecheck, lint and build**. Verify
the evidence by re-running it yourself before committing, using the node's
`Suggested Commit` line verbatim as the subject.

**Settle the `NOTE_TOO_LONG` decision first — it is now due.** See §4.

---

## 5. What M5 has to do next

`G5.1 → G5.2 → G5.3`, then CHECKPOINT E. Full contracts are in
`IMPLEMENTATION_PLAN.md`. Three things to carry into the work:

- **The permission boundary is the whole point.** AGENT.md §6 lists exactly
  nine tools MCP may expose and eight it must not. `delete_document`,
  `delete_version`, `restore_version`, the four `*_category` writes and
  `change_slug` are forbidden, and CHECKPOINT E requires a test asserting all
  eight names are absent — not merely unrouted.
- **Search is already built and is what M5 consumes.** The MCP tool
  `search_documents` is served by
  `src/domain/search/metadata-search-service.ts` through `listDocuments`; do
  not write a second search path for agents.
- **Error codes go to agents verbatim**, which is why §4's `NOTE_TOO_LONG`
  decision is due before G5.1 rather than after it.

The production `AGENT_API_KEY` is in the git-ignored `.secrets.local`; node
G5.2 will need it.

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

Four things M4 added:

- **A green suite from an executor is not proof the feature is right. Read
  the diff.** G4.2 arrived with 12 passing browser tests and a correct-looking
  DoD, and the search box was still deleting a space the reader had just
  typed whenever the debounce committed mid-phrase. It was found by reading
  the resync branch in `SearchBox.tsx`, reproduced in a real browser, then
  fixed. No test the executor wrote could have caught it, because the bug
  only shows in the input's own value between two commits.
- **Check the node's Files list against the code BEFORE dispatch, every
  time.** Both M4 nodes had a wrong one. G4.1 said `document-read.ts` was
  read-only, but the search predicate it had to lift already lived there;
  G4.2 did not mention `useDocumentListing.ts` at all, but request
  cancellation has to live in the fetch layer. In both cases the boundary as
  written would have forced a second copy of existing code. Amend the
  allowlist explicitly in the dispatch packet and record why — do not let an
  executor discover it and improvise.
- **Verify a load-bearing empirical claim yourself.** G4.1's executor
  justified cutting the accent table with measured D1 depth-limit numbers.
  The orchestrator wrote its own probe against real D1 and got 97 / 42 / 43
  against the reported 98 / 43 — close enough to accept, and the probe also
  killed the orchestrator's own better-sounding CTE idea. A claim that
  justifies not meeting a numbered requirement deserves its own measurement.
- **Never `git pull --rebase` on `main` after a `--no-ff` milestone merge.**
  Doing it flattens the merge commit — rebase replays commits linearly and
  drops it — which silently breaks the §12.1 history shape. It happened at
  the end of M4 and was caught by reading the push output: the tip pushed was
  the branch's last node commit, not the merge. Recovering was clean and
  needed no force push, because the branch tip is a parent of the merge
  commit, so `git reset --hard <merge>` and a plain push is a fast-forward.
  The `--rebase` habit is for feature branches; `main` receives merges.

Branch policy (§12.1 of the plan): one branch per milestone, one commit per
node using the node's `Suggested Commit`, merged to `main` with `--no-ff`
only after the checkpoint passes and its evidence is verified.

Plan Delta 1 (§12.2) is the precedent for scope arriving outside the graph:
record the impact, get approval, then resume. Do not silently absorb it.
