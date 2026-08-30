-- Seeds the LOCAL D1 database that `pnpm dev` serves, so the node G1.10
-- browser specs have a published document to read.
--
-- Local wrangler state only, never a remote database. Idempotent: the
-- deletes make a re-run leave exactly one seeded document.
DELETE FROM document_versions WHERE document_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM documents WHERE id = '11111111-1111-4111-8111-111111111111';
DELETE FROM categories WHERE id = '33333333-3333-4333-8333-333333333333';
INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', NULL, 'Books', 'books-seed', 0, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z');
INSERT INTO documents (id, slug, title, description, category_id, current_version_id, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'expectations-investing', 'Expectations Investing', 'Seeded for the node G1.10 browser specs.', '33333333-3333-4333-8333-333333333333', NULL, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z');
INSERT INTO document_versions (id, document_id, version_no, r2_key, sha256, size_bytes, created_by, created_at, restored_from_version_no, note) VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1, 'documents/11111111-1111-4111-8111-111111111111/versions/22222222-2222-4222-8222-222222222222.html', 'seedseedseedseedseedseedseedseedseedseedseedseedseedseedseedseed', 1024, 'admin', '2026-08-30T00:00:00.000Z', NULL, '');
UPDATE documents SET current_version_id = '22222222-2222-4222-8222-222222222222' WHERE id = '11111111-1111-4111-8111-111111111111';
