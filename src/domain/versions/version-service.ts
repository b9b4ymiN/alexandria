// Version writing — the single primitive every write path in Alexandria
// goes through.
//
// Written by node G1.5. Update (G3.1) and restore (G3.2) reuse
// `appendVersion` unchanged; document creation (DocumentService.create)
// reuses `writeObjectThenBatch` so that the document row, the version row,
// the current-version pointer and the tag links all land in ONE D1 batch.
//
// THE CENTRAL PROBLEM THIS FILE SOLVES
// R2 and D1 cannot share a transaction. The chosen ordering is deliberate
// and must not be reversed:
//
//   write R2 first, then D1
//
// so a failure leaves at worst an ORPHANED OBJECT — bytes nobody references
// — and never DANGLING METADATA, a row pointing at an object that does not
// exist. An orphan wastes storage; dangling metadata breaks the Reader for
// a document that appears to exist. When the D1 batch fails, the object is
// deleted best-effort; if that delete also fails, the identifiers are
// logged in one structured line so the object can be reconciled later
// (IMPLEMENTATION_PLAN.md node G1.5, requirement 5).

import { AppError } from "../../shared/errors";
import { buildR2Key } from "./r2-keys";
import { sha256Hex } from "./hash";

/**
 * The two storage bindings the domain layer needs. Services take this
 * rather than the whole `Env` so callers — and tests injecting a failing
 * bucket or database — can supply exactly what is used and nothing more.
 */
export interface Storage {
  db: D1Database;
  docs: R2Bucket;
}

export interface WriteObjectThenBatchParams {
  documentId: string;
  versionId: string;
  bytes: ArrayBuffer;
  sha256: string;
  /** Every statement that must commit together with the version row. */
  statements: D1PreparedStatement[];
}

export interface WriteObjectThenBatchOptions {
  /**
   * Lets a caller translate a raw D1 batch failure into a specific
   * AppError — for example recognising a slug uniqueness violation as
   * SLUG_CONFLICT rather than a generic DATABASE_ERROR. Compensation runs
   * BEFORE this is consulted, so the object is cleaned up either way.
   */
  mapBatchError?: (error: unknown) => AppError | undefined;
}

/**
 * Writes the immutable object, then commits the metadata batch, with
 * compensation if the batch fails.
 *
 * Never overwrites: `versionId` is fresh for every call, so the key this
 * derives has never been written before.
 */
export async function writeObjectThenBatch(
  storage: Storage,
  params: WriteObjectThenBatchParams,
  options: WriteObjectThenBatchOptions = {},
): Promise<void> {
  const { documentId, versionId, bytes, sha256, statements } = params;
  const r2Key = buildR2Key(documentId, versionId);

  // 1. Object first. A failure here must leave ZERO rows behind, which is
  //    automatic because no statement has run yet.
  try {
    await storage.docs.put(r2Key, bytes, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { sha256 },
    });
  } catch (error) {
    throw new AppError("R2_WRITE_FAILED", {
      message: "Failed to store the document content.",
      detail: { r2Key, cause: String(error) },
    });
  }

  // 2. Metadata second, as one batch so it is all-or-nothing.
  try {
    await storage.db.batch(statements);
  } catch (error) {
    await compensateOrphanedObject(storage, { documentId, versionId, r2Key });
    throw (
      options.mapBatchError?.(error) ??
      new AppError("DATABASE_ERROR", {
        message: "Failed to record the document metadata.",
        detail: { cause: String(error) },
      })
    );
  }
}

/**
 * Best-effort removal of an object whose metadata never committed. A
 * failure here is logged, not thrown: the caller's original error is the
 * one that matters, and metadata consistency has already been preserved.
 */
async function compensateOrphanedObject(
  storage: Storage,
  ids: { documentId: string; versionId: string; r2Key: string },
): Promise<void> {
  try {
    await storage.docs.delete(ids.r2Key);
  } catch (deleteError) {
    // One structured line, carrying every identifier needed to reconcile
    // the orphan later (node G1.5 requirement 5).
    console.error(
      JSON.stringify({
        event: "r2_orphan_cleanup_failed",
        documentId: ids.documentId,
        versionId: ids.versionId,
        r2Key: ids.r2Key,
        cause: String(deleteError),
      }),
    );
  }
}

/**
 * Statements that insert a version row and move the document's current
 * pointer to it.
 *
 * `version_no` is computed INSIDE SQL — never read into application code
 * and written back — so two concurrent writers can never claim the same
 * number (IMPLEMENTATION_PLAN.md node G1.5, requirement 4). Over an empty
 * set the aggregate yields NULL, so COALESCE makes a first version 1.
 */
export function buildVersionStatements(
  db: D1Database,
  params: {
    documentId: string;
    versionId: string;
    r2Key: string;
    sha256: string;
    sizeBytes: number;
    createdBy: "admin" | "agent";
    note: string;
    restoredFromVersionNo: number | null;
    now: string;
  },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO document_versions
           (id, document_id, version_no, r2_key, sha256, size_bytes,
            created_by, created_at, restored_from_version_no, note)
         SELECT ?, ?, COALESCE(MAX(version_no), 0) + 1, ?, ?, ?, ?, ?, ?, ?
         FROM document_versions WHERE document_id = ?`,
      )
      .bind(
        params.versionId,
        params.documentId,
        params.r2Key,
        params.sha256,
        params.sizeBytes,
        params.createdBy,
        params.now,
        params.restoredFromVersionNo,
        params.note,
        params.documentId,
      ),
    db
      .prepare("UPDATE documents SET current_version_id = ?, updated_at = ? WHERE id = ?")
      .bind(params.versionId, params.now, params.documentId),
  ];
}

/** Reads back the SQL-assigned version number for a freshly written row. */
export async function readVersionNo(db: D1Database, versionId: string): Promise<number> {
  const row = await db
    .prepare("SELECT version_no FROM document_versions WHERE id = ?")
    .bind(versionId)
    .first<{ version_no: number }>();
  if (row === null) {
    throw new AppError("VERSION_NOT_FOUND", {
      message: "The version row was not found immediately after writing it.",
      detail: { versionId },
    });
  }
  return row.version_no;
}

export interface AppendVersionInput {
  documentId: string;
  bytes: ArrayBuffer;
  createdBy: "admin" | "agent";
  note?: string;
  restoredFromVersionNo?: number | null;
  /**
   * When true, identical bytes still produce a new version. Restore sets
   * this because restoring is an explicit editorial act that history must
   * record (SPEC.md §12); ordinary uploads leave it false so a re-upload of
   * unchanged bytes is a no-op (SPEC.md §11).
   */
  force?: boolean;
}

export interface AppendVersionResult {
  versionId: string;
  versionNo: number;
  unchanged: boolean;
}

/**
 * Appends a new immutable version to an existing document.
 *
 * Returns `unchanged: true` WITHOUT writing anything when the incoming
 * bytes hash to the current version's hash. That is a successful no-op, not
 * an error — the caller reports HTTP 200 (see the clarification on node
 * G3.1), never a failure envelope.
 */
export async function appendVersion(
  storage: Storage,
  input: AppendVersionInput,
): Promise<AppendVersionResult> {
  const current = await storage.db
    .prepare(
      `SELECT v.id AS id, v.sha256 AS sha256, v.version_no AS version_no
       FROM documents d
       LEFT JOIN document_versions v ON v.id = d.current_version_id
       WHERE d.id = ?`,
    )
    .bind(input.documentId)
    .first<{ id: string | null; sha256: string | null; version_no: number | null }>();

  if (current === null) {
    throw new AppError("DOCUMENT_NOT_FOUND", {
      message: "No document with that id.",
      detail: { documentId: input.documentId },
    });
  }

  const sha256 = await sha256Hex(input.bytes);

  if (!input.force && current.sha256 !== null && current.sha256 === sha256) {
    return {
      versionId: current.id as string,
      versionNo: current.version_no as number,
      unchanged: true,
    };
  }

  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = buildR2Key(input.documentId, versionId);

  await writeObjectThenBatch(storage, {
    documentId: input.documentId,
    versionId,
    bytes: input.bytes,
    sha256,
    statements: buildVersionStatements(storage.db, {
      documentId: input.documentId,
      versionId,
      r2Key,
      sha256,
      sizeBytes: input.bytes.byteLength,
      createdBy: input.createdBy,
      note: input.note ?? "",
      restoredFromVersionNo: input.restoredFromVersionNo ?? null,
      now,
    }),
  });

  return {
    versionId,
    versionNo: await readVersionNo(storage.db, versionId),
    unchanged: false,
  };
}
