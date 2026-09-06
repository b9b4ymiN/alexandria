-- Seeds the LOCAL D1 database that `pnpm dev` serves, so the node G1.10
-- browser specs have a published document to read.
--
-- Local wrangler state only, never a remote database. Idempotent: the
-- deletes make a re-run leave exactly one seeded document.
--
-- Other Playwright specs (e.g. admin duplicate-slug upload tests) create
-- their own throwaway documents in this same "Books" category and, so
-- far, do not clean them up, which otherwise blocks the category delete
-- below with an `ON DELETE RESTRICT` violation. Clearing every OTHER
-- document out of this category first keeps this reseed convergent
-- regardless of what earlier runs of other specs left behind.
DELETE FROM document_versions WHERE document_id IN (
  SELECT id FROM documents WHERE category_id = '33333333-3333-4333-8333-333333333333' AND id != '11111111-1111-4111-8111-111111111111'
);
DELETE FROM document_tags WHERE document_id IN (
  SELECT id FROM documents WHERE category_id = '33333333-3333-4333-8333-333333333333' AND id != '11111111-1111-4111-8111-111111111111'
);
DELETE FROM documents WHERE category_id = '33333333-3333-4333-8333-333333333333' AND id != '11111111-1111-4111-8111-111111111111';
DELETE FROM document_versions WHERE document_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM documents WHERE id = '11111111-1111-4111-8111-111111111111';
DELETE FROM categories WHERE id = '33333333-3333-4333-8333-333333333333';
INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', NULL, 'Books', 'books-seed', 0, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z');
INSERT INTO documents (id, slug, title, description, category_id, current_version_id, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'expectations-investing', 'Expectations Investing', 'Seeded for the node G1.10 browser specs.', '33333333-3333-4333-8333-333333333333', NULL, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z');
INSERT INTO document_versions (id, document_id, version_no, r2_key, sha256, size_bytes, created_by, created_at, restored_from_version_no, note) VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1, 'documents/11111111-1111-4111-8111-111111111111/versions/22222222-2222-4222-8222-222222222222.html', 'seedseedseedseedseedseedseedseedseedseedseedseedseedseedseedseed', 1024, 'admin', '2026-08-30T00:00:00.000Z', NULL, '');
UPDATE documents SET current_version_id = '22222222-2222-4222-8222-222222222222' WHERE id = '11111111-1111-4111-8111-111111111111';

-- Node G2.6 additions: a four-level-deep category branch and two more
-- documents, so the public-browse specs can exercise nested subtree
-- listings, breadcrumb navigation/truncation, an empty category, and tag
-- filtering.
--
-- Idempotent via upsert (`ON CONFLICT(id) DO UPDATE`) rather than the
-- delete-then-insert pattern the block above uses: a plain
-- `DELETE ... WHERE id IN (...)` does not delete in IN-list order — it
-- follows the table's own key order — so deleting this self-referencing
-- category chain (parent-to-child ids) trips the parent_id
-- `ON DELETE RESTRICT` guard on a second run. Upserting sidesteps ordering
-- entirely: every row is addressed by its own fixed id, so there is
-- nothing to delete and nothing for RESTRICT to guard.
INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES
  ('44444444-4444-4444-8444-444444444441', NULL, 'Markets', 'markets-seed', 1, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('44444444-4444-4444-8444-444444444442', '44444444-4444-4444-8444-444444444441', 'Equities', 'equities-seed', 0, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('44444444-4444-4444-8444-444444444443', '44444444-4444-4444-8444-444444444442', 'Southeast Asia', 'southeast-asia-seed', 0, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('44444444-4444-4444-8444-444444444444', '44444444-4444-4444-8444-444444444443', 'Thailand', 'thailand-seed', 0, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('44444444-4444-4444-8444-444444444445', NULL, 'Archive', 'archive-seed', 2, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  parent_id = excluded.parent_id, name = excluded.name, slug = excluded.slug,
  sort_order = excluded.sort_order, updated_at = excluded.updated_at;

-- Filed at the deepest level, so browsing "Markets" (a root with no direct
-- documents of its own) still shows results via the subtree default.
INSERT INTO documents (id, slug, title, description, category_id, current_version_id, created_at, updated_at) VALUES
  ('55555555-5555-4555-8555-555555555551', 'thailand-market-outlook', 'Thailand Market Outlook', 'Seeded for the node G2.6 browser specs.', '44444444-4444-4444-8444-444444444444', NULL, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('55555555-5555-4555-8555-555555555552', 'equities-primer', 'Equities Primer', 'Seeded for the node G2.6 browser specs.', '44444444-4444-4444-8444-444444444442', NULL, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug, title = excluded.title, description = excluded.description,
  category_id = excluded.category_id, updated_at = excluded.updated_at;

INSERT INTO document_versions (id, document_id, version_no, r2_key, sha256, size_bytes, created_by, created_at, restored_from_version_no, note) VALUES
  ('66666666-6666-4666-8666-666666666661', '55555555-5555-4555-8555-555555555551', 1, 'documents/55555555-5555-4555-8555-555555555551/versions/66666666-6666-4666-8666-666666666661.html', 'seedseedseedseedseedseedseedseedseedseedseedseedseedseedseedthai', 1024, 'admin', '2026-08-30T00:00:00.000Z', NULL, ''),
  ('66666666-6666-4666-8666-666666666662', '55555555-5555-4555-8555-555555555552', 1, 'documents/55555555-5555-4555-8555-555555555552/versions/66666666-6666-4666-8666-666666666662.html', 'seedseedseedseedseedseedseedseedseedseedseedseedseedseedseedequi', 1024, 'admin', '2026-08-30T00:00:00.000Z', NULL, '')
ON CONFLICT(id) DO NOTHING;

UPDATE documents SET current_version_id = '66666666-6666-4666-8666-666666666661' WHERE id = '55555555-5555-4555-8555-555555555551';
UPDATE documents SET current_version_id = '66666666-6666-4666-8666-666666666662' WHERE id = '55555555-5555-4555-8555-555555555552';

INSERT INTO tags (id, name, normalized_name, created_at, updated_at) VALUES
  ('77777777-7777-4777-8777-777777777771', 'valuation', 'valuation', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('77777777-7777-4777-8777-777777777772', 'thailand', 'thailand', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, normalized_name = excluded.normalized_name, updated_at = excluded.updated_at;

INSERT INTO document_tags (document_id, tag_id, created_at) VALUES
  ('55555555-5555-4555-8555-555555555551', '77777777-7777-4777-8777-777777777771', '2026-08-30T00:00:00.000Z'),
  ('55555555-5555-4555-8555-555555555551', '77777777-7777-4777-8777-777777777772', '2026-08-30T00:00:00.000Z'),
  ('55555555-5555-4555-8555-555555555552', '77777777-7777-4777-8777-777777777771', '2026-08-30T00:00:00.000Z')
ON CONFLICT(document_id, tag_id) DO NOTHING;

-- A document that exists solely for the admin metadata-edit spec to mutate.
--
-- The admin doc-edit test changes a document's title, description, tags AND
-- category. Pointing it at the shared `expectations-investing` fixture made
-- it fight with every spec that READS that fixture — reader.spec.ts,
-- public-browse.spec.ts and the PWA specs all assert on it — which is what
-- made the browser suite non-deterministic across parallel runs. Giving the
-- mutating test its own document removes the coupling at its root instead
-- of serialising the suite to hide it.
INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES
  ('88888888-8888-4888-8888-888888888881', NULL, 'Admin Editing', 'admin-editing-seed', 9, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, updated_at = excluded.updated_at;

INSERT INTO documents (id, slug, title, description, category_id, current_version_id, created_at, updated_at) VALUES
  ('99999999-9999-4999-8999-999999999991', 'admin-editable-document', 'Admin Editable Document', 'Seeded for the node G2.5 metadata-edit spec.', '88888888-8888-4888-8888-888888888881', NULL, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug, title = excluded.title, description = excluded.description,
  category_id = excluded.category_id, updated_at = excluded.updated_at;

INSERT INTO document_versions (id, document_id, version_no, r2_key, sha256, size_bytes, created_by, created_at, restored_from_version_no, note) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '99999999-9999-4999-8999-999999999991', 1, 'documents/99999999-9999-4999-8999-999999999991/versions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.html', 'seedseedseedseedseedseedseedseedseedseedseedseedseedseedseededit', 1024, 'admin', '2026-08-30T00:00:00.000Z', NULL, '')
ON CONFLICT(id) DO NOTHING;

UPDATE documents SET current_version_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' WHERE id = '99999999-9999-4999-8999-999999999991';

-- Reset the mutable fields the edit spec changes, so a re-seed restores a
-- known starting point even after a previous run edited them.
DELETE FROM document_tags WHERE document_id = '99999999-9999-4999-8999-999999999991';
