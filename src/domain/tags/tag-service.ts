// TagService — the full tag lifecycle: create, rename, merge, delete, list
// with document counts, and atomic document tag-set replacement.
//
// Written by node G2.2. Reuses `normalizeTagName` (G1.5) as the single
// source of tag identity and `buildTagWriteStatements` (G1.5) for the
// create-and-link primitive rather than duplicating that logic — the same
// upsert-by-normalized-name behaviour used at document-create time is used
// here, so a tag created through this service and a tag created through an
// upload are indistinguishable (IMPLEMENTATION_PLAN.md node G2.2, Read
// First: src/domain/tags/tag-write.ts).
//
// Every write that touches more than one row (merge, setDocumentTags) is a
// single `db.batch()` call, so it is all-or-nothing the same way
// version-service.ts's writes are (node G2.2 requirement 3, 5).

import { AppError } from "../../shared/errors";
import { normalizeTagName } from "./normalize";
import { buildTagWriteStatements } from "./tag-write";

/** SPEC.md §5 `tags.name`/`normalized_name` — node G2.2 requirement 7. */
export const MAX_TAG_NAME_LENGTH = 50;
/** node G2.2 requirement 7 — a document may carry at most this many tags. */
export const MAX_DOCUMENT_TAGS = 20;

export interface TagRecord {
  id: string;
  name: string;
  normalizedName: string;
}

export interface TagListItem extends TagRecord {
  documentCount: number;
}

export interface MergeTagsResult {
  targetId: string;
  /** Document links moved from the source tag that were not already on the target. */
  movedLinks: number;
  /** Links the source tag shared with the target already — skipped, never duplicated. */
  skippedDuplicateLinks: number;
}

export interface DeleteTagResult {
  id: string;
  /** Document links removed by the cascade, reported for operator visibility. */
  removedLinks: number;
}

export interface SetDocumentTagsResult {
  documentId: string;
  /** The document's full tag set after the replacement, normalized. */
  tags: string[];
}

/**
 * Trims and collapses whitespace the same way `normalizeTagName` does, so
 * the length cap and the stored `name` agree on what the "real" name is —
 * a name padded with spaces should not be rejected for length it does not
 * visibly have.
 */
function displayName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Validates a candidate tag name and returns its display form and its
 * normalized identity. Throws `TAG_NAME_REQUIRED` for a blank name and
 * `TAG_NAME_TOO_LONG` past the cap (node G2.2 requirement 7).
 */
function validateTagName(raw: string): { name: string; normalizedName: string } {
  const name = displayName(raw);
  if (name.length === 0) {
    throw new AppError("TAG_NAME_REQUIRED", { message: "A tag name is required." });
  }
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new AppError("TAG_NAME_TOO_LONG", {
      message: `Tag names are limited to ${MAX_TAG_NAME_LENGTH} characters.`,
      detail: { length: name.length, max: MAX_TAG_NAME_LENGTH },
    });
  }
  return { name, normalizedName: normalizeTagName(raw) };
}

async function findTagById(db: D1Database, id: string): Promise<TagRecord | null> {
  const row = await db
    .prepare("SELECT id, name, normalized_name AS normalizedName FROM tags WHERE id = ?")
    .bind(id)
    .first<TagRecord>();
  return row ?? null;
}

async function requireTagById(db: D1Database, id: string): Promise<TagRecord> {
  const tag = await findTagById(db, id);
  if (tag === null) {
    throw new AppError("TAG_NOT_FOUND", {
      message: "No tag with that id.",
      detail: { id },
    });
  }
  return tag;
}

/**
 * Creates a tag, or returns the existing one if its normalized name is
 * already taken — creation is idempotent by design (node G2.2
 * requirement 2), because a caller asking to "create" a tag that already
 * exists almost always means "make sure it exists."
 */
export async function createTag(db: D1Database, rawName: string): Promise<TagRecord> {
  const { name, normalizedName } = validateTagName(rawName);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO tags (id, name, normalized_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (normalized_name) DO NOTHING`,
    )
    .bind(id, name, normalizedName, now, now)
    .run();

  // Re-read by normalized_name rather than trust `id`: a concurrent writer
  // may have created the row first, in which case ON CONFLICT DO NOTHING
  // left theirs standing and this returns THAT row.
  const row = await db
    .prepare("SELECT id, name, normalized_name AS normalizedName FROM tags WHERE normalized_name = ?")
    .bind(normalizedName)
    .first<TagRecord>();
  if (row === null) {
    // Unreachable outside a storage failure: the insert-or-noop above
    // guarantees a row with this normalized_name exists.
    throw new AppError("DATABASE_ERROR", {
      message: "Tag creation did not produce a readable row.",
      detail: { normalizedName },
    });
  }
  return row;
}

/**
 * Renames a tag. A rename whose normalized form collides with a DIFFERENT
 * existing tag is rejected with `TAG_NAME_CONFLICT` rather than silently
 * merging the two — merging is an explicit, separate operation (node G2.2
 * requirement 6).
 */
export async function renameTag(db: D1Database, id: string, rawName: string): Promise<TagRecord> {
  const existing = await requireTagById(db, id);
  const { name, normalizedName } = validateTagName(rawName);

  if (normalizedName !== existing.normalizedName) {
    const collision = await db
      .prepare("SELECT id FROM tags WHERE normalized_name = ? AND id != ?")
      .bind(normalizedName, id)
      .first<{ id: string }>();
    if (collision !== null) {
      throw new AppError("TAG_NAME_CONFLICT", {
        message: "Another tag already has that name. Merge the tags explicitly instead.",
        detail: { id, collidesWith: collision.id },
      });
    }
  }

  const now = new Date().toISOString();
  try {
    await db
      .prepare("UPDATE tags SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?")
      .bind(name, normalizedName, now, id)
      .run();
  } catch (error) {
    // Backstop for a race the pre-check above cannot fully close: two
    // concurrent renames to the same normalized name racing between the
    // check and the write. The UNIQUE constraint is the real guard; this
    // just gives it the same error code as the pre-check.
    if (String(error).includes("normalized_name")) {
      throw new AppError("TAG_NAME_CONFLICT", {
        message: "Another tag already has that name. Merge the tags explicitly instead.",
        detail: { id },
      });
    }
    throw error;
  }

  return { id, name, normalizedName };
}

/**
 * Merges `sourceId` into `targetId`: every document link the source has is
 * moved to the target, a link the target already has is skipped rather
 * than duplicated, and the source tag is then deleted — all inside one D1
 * batch, so a caller never observes a partially-merged state (node G2.2
 * requirement 3).
 */
export async function mergeTags(
  db: D1Database,
  sourceId: string,
  targetId: string,
): Promise<MergeTagsResult> {
  if (sourceId === targetId) {
    throw new AppError("TAG_SELF_MERGE", {
      message: "A tag cannot be merged into itself.",
      detail: { id: sourceId },
    });
  }

  const [source, target] = await Promise.all([
    requireTagById(db, sourceId),
    requireTagById(db, targetId),
  ]);

  const [movedRow, skippedRow] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM document_tags src
         WHERE src.tag_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM document_tags tgt
             WHERE tgt.tag_id = ? AND tgt.document_id = src.document_id
           )`,
      )
      .bind(source.id, target.id)
      .first<{ c: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM document_tags src
         WHERE src.tag_id = ?
           AND EXISTS (
             SELECT 1 FROM document_tags tgt
             WHERE tgt.tag_id = ? AND tgt.document_id = src.document_id
           )`,
      )
      .bind(source.id, target.id)
      .first<{ c: number }>(),
  ]);

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    // 1. Copy every source link onto the target, skipping a document that
    //    is already linked to the target (node G2.2 edge case: both tags
    //    already share a document produces one surviving link).
    db
      .prepare(
        `INSERT INTO document_tags (document_id, tag_id, created_at)
         SELECT document_id, ?, ? FROM document_tags WHERE tag_id = ?
         ON CONFLICT (document_id, tag_id) DO NOTHING`,
      )
      .bind(target.id, now, source.id),
    // 2. Delete the source's own links (the cascade on tag delete below
    //    would do this too, but doing it explicitly keeps this batch
    //    correct even if the delete-order assumption ever changes).
    db.prepare("DELETE FROM document_tags WHERE tag_id = ?").bind(source.id),
    // 3. Delete the source tag itself.
    db.prepare("DELETE FROM tags WHERE id = ?").bind(source.id),
  ];

  await db.batch(statements);

  return {
    targetId: target.id,
    movedLinks: movedRow?.c ?? 0,
    skippedDuplicateLinks: skippedRow?.c ?? 0,
  };
}

/**
 * Deletes a tag. Allowed even when the tag is in use — a tag carries no
 * structural meaning, unlike a category — but the response reports how
 * many document links were removed by the cascade (node G2.2
 * requirement 4).
 */
export async function deleteTag(db: D1Database, id: string): Promise<DeleteTagResult> {
  await requireTagById(db, id);

  const linkCount = await db
    .prepare("SELECT COUNT(*) AS c FROM document_tags WHERE tag_id = ?")
    .bind(id)
    .first<{ c: number }>();

  // ON DELETE CASCADE (migrations/0001_init.sql) removes document_tags rows;
  // no explicit delete statement is needed for them.
  await db.prepare("DELETE FROM tags WHERE id = ?").bind(id).run();

  return { id, removedLinks: linkCount?.c ?? 0 };
}

/** Lists every tag with an accurate document count, ordered by display name. */
export async function listTags(db: D1Database): Promise<TagListItem[]> {
  const result = await db
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.normalized_name AS normalizedName,
              COUNT(dt.document_id) AS documentCount
       FROM tags t
       LEFT JOIN document_tags dt ON dt.tag_id = t.id
       GROUP BY t.id, t.name, t.normalized_name
       ORDER BY t.normalized_name`,
    )
    .all<TagListItem>();
  return result.results;
}

/**
 * Replaces a document's entire tag set atomically: creates any missing
 * tags, links what is new, and unlinks what is gone, all in one D1 batch
 * (node G2.2 requirement 5). An empty array removes every link.
 */
export async function setDocumentTags(
  db: D1Database,
  documentId: string,
  rawNames: readonly string[],
): Promise<SetDocumentTagsResult> {
  if (rawNames.length > MAX_DOCUMENT_TAGS) {
    throw new AppError("TAG_LIMIT_EXCEEDED", {
      message: `A document may carry at most ${MAX_DOCUMENT_TAGS} tags.`,
      detail: { supplied: rawNames.length, max: MAX_DOCUMENT_TAGS },
    });
  }

  const document = await db
    .prepare("SELECT id FROM documents WHERE id = ?")
    .bind(documentId)
    .first<{ id: string }>();
  if (document === null) {
    throw new AppError("DOCUMENT_NOT_FOUND", {
      message: "No document with that id.",
      detail: { documentId },
    });
  }

  // Reject an over-length name before any write, same as create/rename.
  for (const raw of rawNames) {
    validateTagName(raw);
  }

  const now = new Date().toISOString();
  const tagWrite = buildTagWriteStatements(db, documentId, rawNames, now);

  const unlinkStatement =
    tagWrite.normalizedNames.length === 0
      ? db.prepare("DELETE FROM document_tags WHERE document_id = ?").bind(documentId)
      : db
          .prepare(
            `DELETE FROM document_tags
             WHERE document_id = ?
               AND tag_id NOT IN (
                 SELECT id FROM tags WHERE normalized_name IN (${tagWrite.normalizedNames
                   .map(() => "?")
                   .join(",")})
               )`,
          )
          .bind(documentId, ...tagWrite.normalizedNames);

  await db.batch([...tagWrite.statements, unlinkStatement]);

  return { documentId, tags: tagWrite.normalizedNames };
}
