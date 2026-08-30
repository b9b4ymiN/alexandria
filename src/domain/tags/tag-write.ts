// Tag creation and document linking, expressed as D1 statements.
//
// Written by node G1.5. These statements are returned rather than executed
// so a caller can put them in the SAME `db.batch()` as the document and
// version writes — a document must never end up committed with only some of
// its tags attached.
//
// Full tag lifecycle behaviour (rename, merge, delete, listing with counts)
// belongs to node G2.2's TagService and is deliberately absent here.

import { normalizeTagName } from "./normalize";

export interface TagWriteStatements {
  /** Statements to append to the caller's batch, in order. */
  statements: D1PreparedStatement[];
  /** Normalized names actually linked, de-duplicated, in input order. */
  normalizedNames: string[];
}

/**
 * Builds the statements that ensure every supplied tag exists and is linked
 * to `documentId`.
 *
 * Tag identity is `normalized_name`. An existing tag is reused rather than
 * duplicated: the insert is a no-op on conflict, and the link then resolves
 * the tag id by normalized name, so a concurrent writer that created the
 * same tag first is handled without a failure.
 *
 * Duplicate inputs that differ only in casing or whitespace collapse to one
 * tag and one link.
 */
export function buildTagWriteStatements(
  db: D1Database,
  documentId: string,
  rawNames: readonly string[],
  now: string,
): TagWriteStatements {
  const statements: D1PreparedStatement[] = [];
  const normalizedNames: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawNames) {
    const normalized = normalizeTagName(raw);
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    normalizedNames.push(normalized);

    // Reuse by normalized_name; never duplicate. `name` preserves the
    // caller's casing only when this writer is the one that creates the row.
    statements.push(
      db
        .prepare(
          `INSERT INTO tags (id, name, normalized_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (normalized_name) DO NOTHING`,
        )
        .bind(crypto.randomUUID(), raw.replace(/\s+/g, " ").trim(), normalized, now, now),
    );

    // Resolve the tag id by normalized name rather than by the id generated
    // above, so the link is correct whether this statement created the tag
    // or an earlier writer did.
    statements.push(
      db
        .prepare(
          `INSERT INTO document_tags (document_id, tag_id, created_at)
           SELECT ?, id, ? FROM tags WHERE normalized_name = ?
           ON CONFLICT (document_id, tag_id) DO NOTHING`,
        )
        .bind(documentId, now, normalized),
    );
  }

  return { statements, normalizedNames };
}
