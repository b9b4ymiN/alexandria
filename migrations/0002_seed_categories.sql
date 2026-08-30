-- Migration 0002: seed the four initial Phase 1 categories.
--
-- These are ordinary, deletable rows with no reserved meaning. No
-- application code may reference a seed category by name or id
-- (IMPLEMENTATION_PLAN.md Node G1.1, Implementation Requirement 4).
-- Timestamps are explicit ISO-8601 UTC strings written here rather than
-- left to a SQLite default, matching the rule that every writer — this
-- migration included — produces timestamps the same way (Requirement 5).

INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES
  ('cat_8f2a1b6e3d4c47a1', NULL, 'Stocks', 'stocks', 0, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('cat_1e7b9c2f5a6d48b2', NULL, 'Books', 'books', 1, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('cat_4d3f0a8e1b7c49c3', NULL, 'Research', 'research', 2, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
  ('cat_9a6e2d5b0f8c4ad4', NULL, 'Uncategorized', 'uncategorized', 3, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z');
