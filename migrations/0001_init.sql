-- Migration 0001: Phase 1 core schema.
--
-- Reproduces SPEC.md §5 Data Model exactly, column for column, type for
-- type, constraint for constraint, plus the supporting indexes and the
-- additive partial unique index described in IMPLEMENTATION_PLAN.md
-- Node G1.1. No Phase 1.5 column is present.

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT,
  UNIQUE (parent_id, slug)
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL,
  current_version_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('admin','agent')),
  created_at TEXT NOT NULL,
  restored_from_version_no INTEGER NULL,
  note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE (document_id, version_no)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE document_tags (
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Supporting indexes for the queries this plan issues (IMPLEMENTATION_PLAN
-- Node G1.1, Implementation Requirement 2).
CREATE INDEX idx_documents_category_id ON documents(category_id);
CREATE INDEX idx_documents_updated_at ON documents(updated_at DESC);
CREATE INDEX idx_document_versions_document_id_version_no ON document_versions(document_id, version_no DESC);
CREATE INDEX idx_document_tags_tag_id ON document_tags(tag_id);

-- Root-slug hole: SQLite treats NULL as distinct inside a UNIQUE
-- constraint, so UNIQUE (parent_id, slug) alone does not prevent two root
-- categories (parent_id IS NULL) from sharing a slug. This partial unique
-- index is additive — it does not change the table definition above
-- (IMPLEMENTATION_PLAN Node G1.1, Implementation Requirement 3).
CREATE UNIQUE INDEX ux_categories_root_slug ON categories(slug) WHERE parent_id IS NULL;
