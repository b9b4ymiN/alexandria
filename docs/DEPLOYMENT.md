# Deployment — Alexandria Phase 1

Written by node G1.12. Contains no secret values and never should.

---

## 1. Cloudflare resources

| Resource | Name | Created by |
|---|---|---|
| D1 database | `alexandria-db` | `wrangler d1 create alexandria-db` |
| R2 bucket | `alexandria-docs` | `wrangler r2 bucket create alexandria-docs` |
| Worker (app) | `alexandria` | `wrangler deploy -c wrangler.jsonc` |
| Worker (content) | `alexandria-content` | `wrangler deploy -c wrangler.content.jsonc` |

Account: the one `wrangler whoami` reports. The workers.dev subdomain is
`vcp-scanner`, so the deployed hostnames are:

```text
app origin      https://alexandria.vcp-scanner.workers.dev
content origin  https://alexandria-content.vcp-scanner.workers.dev
```

These two MUST remain different hostnames. That separation is the browser
security boundary for uploaded HTML (SPEC.md §2 and §16). Both are stored
as configuration vars (`APP_ORIGIN`, `CONTENT_ORIGIN`), never as literals in
source, so moving to a custom domain later is a config change.

---

## 2. Prerequisite: enable R2

**This is a manual step in the Cloudflare dashboard and cannot be scripted.**

1. Open the Cloudflare dashboard, go to R2, and enable it. A payment method
   is required even for the free tier; the free allowance is 10 GB-month of
   storage, and nothing is charged below it.
2. Run `wrangler login` again afterwards. The OAuth token issued before R2
   was enabled carries no `r2` scope, so bucket creation will keep failing
   with `code 10042` until the token is refreshed.

Verify with:

```bash
pnpm exec wrangler r2 bucket list
```

A successful (possibly empty) listing means the prerequisite is met.

---

## 3. Secrets

Four Worker secrets. None of them is ever committed, printed, logged, put in
a URL, or exposed through MCP output (AGENT.md §13).

| Secret | Worker | Who sets it |
|---|---|---|
| `ADMIN_PASSWORD` | `alexandria` | The project owner, personally |
| `ADMIN_SESSION_SIGNING_SECRET` | `alexandria` | Generated at setup |
| `AGENT_API_KEY` | `alexandria` | Generated at setup |
| `CONTENT_PREVIEW_SIGNING_SECRET` | `alexandria` and `alexandria-content` | Generated at setup |

The owner sets the password interactively:

```bash
pnpm exec wrangler secret put ADMIN_PASSWORD
```

The three generated values are piped straight in so they never appear on a
terminal or in shell history:

```bash
node -e "process.stdout.write(crypto.randomUUID()+crypto.randomUUID())" \
  | pnpm exec wrangler secret put ADMIN_SESSION_SIGNING_SECRET

node -e "process.stdout.write(crypto.randomUUID()+crypto.randomUUID())" \
  | pnpm exec wrangler secret put AGENT_API_KEY

node -e "process.stdout.write(crypto.randomUUID()+crypto.randomUUID())" \
  | pnpm exec wrangler secret put CONTENT_PREVIEW_SIGNING_SECRET
```

`CONTENT_PREVIEW_SIGNING_SECRET` is provisioned now even though node G3.4 is
the first consumer, so secret setup happens once.

`AGENT_API_KEY` must also be readable locally for the MCP server (node
G5.2). Keep it in the git-ignored `.dev.vars`, not in a person's memory.

Local development uses `.dev.vars` (git-ignored). `.dev.vars.example`
documents the names with empty values and is safe to commit.

---

## 4. Deployment order

Take a database snapshot before every migration application. D1 migrations
are forward-only, so the snapshot is the restore point.

```bash
# 1. Create resources (once)
pnpm exec wrangler d1 create alexandria-db
pnpm exec wrangler r2 bucket create alexandria-docs

# 2. Put the real database id into wrangler.jsonc and wrangler.content.jsonc,
#    replacing the 00000000-0000-0000-0000-000000000000 placeholder in both.

# 3. Snapshot, then migrate
pnpm exec wrangler d1 export alexandria-db --remote --output ./backup-pre-migration.sql
pnpm db:migrate:remote
pnpm exec wrangler d1 migrations list alexandria-db --remote

# 4. Deploy content first, then the app, so the Reader never points at a
#    hostname that does not answer yet
pnpm exec wrangler deploy -c wrangler.content.jsonc
pnpm exec wrangler deploy -c wrangler.jsonc

# 5. Smoke check
curl -sI https://alexandria-content.vcp-scanner.workers.dev/health
curl -s  https://alexandria.vcp-scanner.workers.dev/api/public/documents
```

---

## 5. Acceptance for CHECKPOINT A

Publish `mauboussin-expectations-investing-summary.html` through the
DEPLOYED Admin UI — not a script, because the point is to exercise the real
path — then confirm:

- the returned URL opens without signing in, from another device and network
- the document renders with its Google Fonts, external image, tables and SVG
- reading works on a real phone, not only an emulated viewport
- the Admin session is unreachable from inside the iframe
- no secret appears in the built client bundle:
  `grep -rE "ADMIN_|AGENT_API_KEY|SIGNING_SECRET" dist/`

---

## 6. Rollback

**Workers.** Each Worker versions independently. Roll back the one that
regressed, either with `wrangler rollback` for that Worker or by redeploying
the previous commit's build. Rolling back the app Worker does not affect
served documents, and rolling back the content Worker does not affect
metadata.

**Database.** Migrations are forward-only. Recovery means restoring the
pre-migration export taken in step 3. That is why the snapshot is taken
before every migration run rather than only before risky ones.

**Storage.** R2 objects are immutable and never overwritten, so rolling back
code never invalidates stored content. A code rollback can leave objects
that the older schema does not reference; they are harmless and are the
documented trade-off from the write path (see node G1.5).

**Runtime partial failures.** If a write fails between R2 and D1, the domain
layer compensates automatically and logs any object it could not clean up as
a single structured line with `event: "r2_orphan_cleanup_failed"`, carrying
`documentId`, `versionId` and `r2Key`. Search the Worker logs for that event
to reconcile orphans.
