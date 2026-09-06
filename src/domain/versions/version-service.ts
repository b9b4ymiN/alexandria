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
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  validateHtmlUpload,
  type UploadLimits,
} from "../documents/html-validation";

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

// ---------------------------------------------------------------------------
// Update & version history — node G3.1.
//
// Both operations resolve the document by its STABLE SLUG, matching the
// public update contract (SPEC.md §11: "stable slug + new .html"). Neither
// function ever writes `documents.slug`; the slug is only ever read back so
// the caller can echo the unchanged public URL.
// ---------------------------------------------------------------------------

const MAX_NOTE_LENGTH = 500;

interface DocumentIdentityRow {
  id: string;
  currentVersionId: string | null;
}

/** Resolves a document's internal id (and current pointer) by slug. */
async function resolveDocumentBySlug(db: D1Database, slug: string): Promise<DocumentIdentityRow> {
  const row = await db
    .prepare("SELECT id, current_version_id AS currentVersionId FROM documents WHERE slug = ?")
    .bind(slug)
    .first<DocumentIdentityRow>();
  if (row === null) {
    throw new AppError("DOCUMENT_NOT_FOUND", {
      message: "No document with that slug.",
      detail: { slug },
    });
  }
  return row;
}

export interface UpdateDocumentVersionInput {
  slug: string;
  bytes: ArrayBuffer;
  filename: string;
  createdBy: "admin" | "agent";
  note?: string;
  limits?: UploadLimits;
}

export interface UpdateDocumentVersionResult extends AppendVersionResult {
  slug: string;
}

/**
 * Update entry point for an existing document (SPEC.md §11 Update
 * Contract, steps 1-9). Resolves the document by slug FIRST so an unknown
 * slug fails with `DOCUMENT_NOT_FOUND` before any byte is even validated,
 * then runs the incoming file through the identical validation chain a
 * create goes through (node G3.1 requirement 2) before ever reaching
 * `appendVersion` — a rejected file therefore never disturbs the current
 * version, because nothing has been written yet at the point validation
 * throws.
 *
 * `appendVersion`'s SHA-256 comparison (against the CURRENT version only),
 * `force`-free UNCHANGED short-circuit, R2-then-D1 ordering and
 * compensation are reused completely unchanged — this function does not
 * duplicate any of that logic, it only resolves the slug and validates the
 * incoming bytes first.
 */
export async function updateDocumentVersion(
  storage: Storage,
  input: UpdateDocumentVersionInput,
): Promise<UpdateDocumentVersionResult> {
  const document = await resolveDocumentBySlug(storage.db, input.slug);

  const limits: UploadLimits = input.limits ?? { maxBytes: DEFAULT_MAX_UPLOAD_BYTES };
  await validateHtmlUpload({ filename: input.filename, bytes: input.bytes }, limits);

  if (input.note !== undefined && input.note.length > MAX_NOTE_LENGTH) {
    throw new AppError("INVALID_HTML", {
      message: `Note must be at most ${MAX_NOTE_LENGTH} characters.`,
    });
  }

  const result = await appendVersion(storage, {
    documentId: document.id,
    bytes: input.bytes,
    createdBy: input.createdBy,
    note: input.note,
  });

  return { ...result, slug: input.slug };
}

export interface VersionHistoryEntry {
  versionNo: number;
  versionId: string;
  sizeBytes: number;
  sha256: string;
  createdBy: "admin" | "agent";
  createdAt: string;
  note: string;
  restoredFromVersionNo: number | null;
  isCurrent: boolean;
}

interface VersionHistoryRow {
  versionId: string;
  versionNo: number;
  sizeBytes: number;
  sha256: string;
  createdBy: "admin" | "agent";
  createdAt: string;
  note: string;
  restoredFromVersionNo: number | null;
}

/**
 * Full version history for a document, resolved by its stable slug, newest
 * first, flagging the current version. Never selects `r2_key` or reads the
 * object body — this is metadata only (node G3.1 requirement 7).
 */
export async function listVersionHistory(db: D1Database, slug: string): Promise<VersionHistoryEntry[]> {
  const document = await resolveDocumentBySlug(db, slug);

  const rows = await db
    .prepare(
      `SELECT id AS versionId, version_no AS versionNo, size_bytes AS sizeBytes, sha256,
              created_by AS createdBy, created_at AS createdAt, note,
              restored_from_version_no AS restoredFromVersionNo
       FROM document_versions
       WHERE document_id = ?
       ORDER BY version_no DESC`,
    )
    .bind(document.id)
    .all<VersionHistoryRow>();

  return rows.results.map((row) => ({
    ...row,
    isCurrent: row.versionId === document.currentVersionId,
  }));
}

// ---------------------------------------------------------------------------
// Restore & version delete guards — node G3.2.
//
// Both operations resolve by stable slug like G3.1's update and history
// functions above, and neither ever writes `documents.slug` (SPEC.md §11,
// §12, §13).
// ---------------------------------------------------------------------------

interface VersionRow {
  id: string;
  r2Key: string;
}

/** Looks up one version row by its document-scoped version number. */
async function findVersionRow(
  db: D1Database,
  documentId: string,
  versionNo: number,
): Promise<VersionRow | null> {
  return db
    .prepare("SELECT id, r2_key AS r2Key FROM document_versions WHERE document_id = ? AND version_no = ?")
    .bind(documentId, versionNo)
    .first<VersionRow>();
}

export interface RestoreVersionInput {
  slug: string;
  versionNo: number;
  createdBy: "admin" | "agent";
}

export interface RestoreVersionResult {
  slug: string;
  versionId: string;
  versionNo: number;
  restoredFromVersionNo: number;
}

/**
 * Restore entry point (SPEC.md §12 Restore Contract, GOAL.md §4). Reads the
 * source version's bytes from R2 and hands them to `appendVersion` as a
 * brand-new version — the source row and its R2 object are never touched,
 * so restore is append-only by construction, not by a separate check.
 *
 * `force: true` is the deliberate divergence from the upload UNCHANGED rule
 * (see `AppendVersionInput.force`): restoring identical bytes is still an
 * explicit editorial act, and history must record that it happened, so a
 * restore never returns `unchanged`.
 */
export async function restoreVersion(
  storage: Storage,
  input: RestoreVersionInput,
): Promise<RestoreVersionResult> {
  const document = await resolveDocumentBySlug(storage.db, input.slug);

  const source = await findVersionRow(storage.db, document.id, input.versionNo);
  if (source === null) {
    throw new AppError("VERSION_NOT_FOUND", {
      message: "No version with that number.",
      detail: { slug: input.slug, versionNo: input.versionNo },
    });
  }

  const object = await storage.docs.get(source.r2Key);
  if (object === null) {
    // Nothing has been written yet at this point — the failure surfaces
    // before any R2 put or D1 statement runs (node G3.2 Edge Cases).
    throw new AppError("R2_READ_FAILED", {
      message: "The source version's content could not be read.",
      detail: { documentId: document.id, versionId: source.id, r2Key: source.r2Key },
    });
  }
  const bytes = await object.arrayBuffer();

  const result = await appendVersion(storage, {
    documentId: document.id,
    bytes,
    createdBy: input.createdBy,
    restoredFromVersionNo: input.versionNo,
    force: true,
  });

  return {
    slug: input.slug,
    versionId: result.versionId,
    versionNo: result.versionNo,
    restoredFromVersionNo: input.versionNo,
  };
}

export interface DeleteVersionInput {
  slug: string;
  versionNo: number;
}

export interface DeleteVersionResult {
  deletedVersionNo: number;
}

/**
 * Best-effort R2 cleanup for a version whose D1 row has already been
 * removed. Mirrors `compensateOrphanedObject`'s trade-off: the metadata
 * (already deleted) is authoritative, so any R2 outcome here is logged, not
 * thrown. A `head()` first distinguishes "the object was already gone" from
 * "the delete call itself failed" so both cases in node G3.2's Edge Cases
 * produce a distinct, identifiable log line.
 */
async function deleteR2ObjectBestEffort(
  storage: Storage,
  ids: { documentId: string; versionId: string; r2Key: string },
): Promise<void> {
  try {
    const existing = await storage.docs.head(ids.r2Key);
    if (existing === null) {
      console.error(
        JSON.stringify({
          event: "r2_version_object_already_missing",
          documentId: ids.documentId,
          versionId: ids.versionId,
          r2Key: ids.r2Key,
        }),
      );
      return;
    }
    await storage.docs.delete(ids.r2Key);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "r2_version_delete_failed",
        documentId: ids.documentId,
        versionId: ids.versionId,
        r2Key: ids.r2Key,
        cause: String(error),
      }),
    );
  }
}

/**
 * Version delete (SPEC.md §13 Delete Rules). Guard order is fixed and
 * load-bearing: `LAST_VERSION_CANNOT_DELETE` is checked BEFORE
 * `VERSION_IS_CURRENT`, so a single-version document — which is always
 * both the last and the current version — reports the more specific
 * last-version code (node G3.2, requirement 5).
 *
 * Deletion order mirrors create's R2-then-D1 in reverse: the D1 row goes
 * first, then the R2 object best-effort, because once the metadata is gone
 * the object can never be reached through the API again regardless of
 * whether the R2 delete itself succeeds.
 */
export async function deleteVersion(
  storage: Storage,
  input: DeleteVersionInput,
): Promise<DeleteVersionResult> {
  const document = await resolveDocumentBySlug(storage.db, input.slug);

  const target = await findVersionRow(storage.db, document.id, input.versionNo);
  if (target === null) {
    throw new AppError("VERSION_NOT_FOUND", {
      message: "No version with that number.",
      detail: { slug: input.slug, versionNo: input.versionNo },
    });
  }

  const countRow = await storage.db
    .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
    .bind(document.id)
    .first<{ c: number }>();
  if ((countRow?.c ?? 0) <= 1) {
    throw new AppError("LAST_VERSION_CANNOT_DELETE", {
      message: "The only remaining version of a document cannot be deleted.",
      detail: { slug: input.slug, versionNo: input.versionNo },
    });
  }

  if (target.id === document.currentVersionId) {
    throw new AppError("VERSION_IS_CURRENT", {
      message: "The current version cannot be deleted.",
      detail: { slug: input.slug, versionNo: input.versionNo },
    });
  }

  await storage.db.prepare("DELETE FROM document_versions WHERE id = ?").bind(target.id).run();

  await deleteR2ObjectBestEffort(storage, {
    documentId: document.id,
    versionId: target.id,
    r2Key: target.r2Key,
  });

  return { deletedVersionNo: input.versionNo };
}

// ---------------------------------------------------------------------------
// Version identity lookup — node G3.4.
// ---------------------------------------------------------------------------

export interface VersionIdentity {
  documentId: string;
  versionId: string;
  versionNo: number;
}

/**
 * Resolves the internal identity of one version of a document, addressed
 * the way every Admin surface addresses it: stable slug plus version
 * number.
 *
 * Node G3.4 needs this to mint a preview signature, which must bind the
 * document and the version together. Without it the route would have to
 * issue its own SQL, and a transport file that knows the schema is exactly
 * what AGENT.md §10 forbids.
 */
export async function resolveVersionIdentity(
  db: D1Database,
  slug: string,
  versionNo: number,
): Promise<VersionIdentity> {
  const document = await resolveDocumentBySlug(db, slug);

  const row = await findVersionRow(db, document.id, versionNo);
  if (row === null) {
    throw new AppError("VERSION_NOT_FOUND", {
      message: "No version with that number.",
      detail: { slug, versionNo },
    });
  }

  return { documentId: document.id, versionId: row.id, versionNo };
}
