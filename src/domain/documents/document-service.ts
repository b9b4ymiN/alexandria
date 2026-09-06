// Document creation — the SPEC.md §9 create flow, end to end.
//
// Written by node G1.5. This service owns the rules; Hono routes (G1.7,
// G1.8) and the Agent API (G5.1) only validate their transport input and
// delegate here, so the same rules apply to a person uploading through the
// Admin UI and to an agent publishing through MCP.
//
// Ordering is fixed and load-bearing:
//   validate -> extract -> resolve category -> resolve slug -> hash
//   -> write R2 -> commit D1 batch (with compensation)
//
// The category is only ever LOOKED UP. This service never creates one:
// category structure is Admin's alone (AGENT.md §5), and an agent that
// names an unknown category gets CATEGORY_NOT_FOUND rather than a
// helpfully-invented category (AGENT.md §32).

import { AppError } from "../../shared/errors";
import { DEFAULT_MAX_UPLOAD_BYTES, validateHtmlUpload, type UploadLimits } from "./html-validation";
import { extractMetadata } from "./metadata";
import { generateSlug, resolveCollision } from "./slug";
import { buildTagWriteStatements } from "../tags/tag-write";
import { setDocumentTags } from "../tags/tag-service";
import { categoryPath as resolveCategoryPath } from "../categories/category-service";
import { buildR2Key } from "../versions/r2-keys";
import { sha256Hex } from "../versions/hash";
import {
  buildVersionStatements,
  readVersionNo,
  writeObjectThenBatch,
  type Storage,
} from "../versions/version-service";

export interface CreateDocumentOverrides {
  title?: string;
  description?: string;
  tags?: string[];
}

export interface CreateDocumentInput {
  bytes: ArrayBuffer;
  filename: string;
  categoryId: string;
  createdBy: "admin" | "agent";
  overrides?: CreateDocumentOverrides;
  note?: string;
  limits?: UploadLimits;
}

export interface CreateDocumentResult {
  documentId: string;
  slug: string;
  versionId: string;
  versionNo: number;
  title: string;
  description: string;
  tags: string[];
}

/** Slug uniqueness is enforced by `documents.slug UNIQUE` in SPEC §5. */
const SLUG_UNIQUE_MARKERS = ["documents.slug", "UNIQUE constraint failed: documents.slug"];

function isSlugUniquenessFailure(error: unknown): boolean {
  const message = String(error);
  return SLUG_UNIQUE_MARKERS.some((marker) => message.includes(marker));
}

/**
 * Metadata precedence: an explicit override beats extraction, extraction
 * beats nothing.
 *
 * An override of "" for DESCRIPTION is honoured — clearing a description is
 * a real intent. An override of "" for TITLE is treated as absent, because
 * `documents.title` is NOT NULL and a document with no title is not a thing
 * the library can display (node G1.5, requirement 7).
 */
function resolveTitle(extracted: string, override: string | undefined): string {
  const trimmed = override?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }
  if (extracted.trim().length > 0) {
    return extracted.trim();
  }
  throw new AppError("TITLE_REQUIRED", {
    message: "The document has no usable title and none was supplied.",
  });
}

function resolveDescription(extracted: string, override: string | undefined): string {
  return override !== undefined ? override.trim() : extracted;
}

export async function createDocument(
  storage: Storage,
  input: CreateDocumentInput,
): Promise<CreateDocumentResult> {
  const limits: UploadLimits = input.limits ?? { maxBytes: DEFAULT_MAX_UPLOAD_BYTES };

  // 1. Nothing is written until the bytes are known to be acceptable.
  await validateHtmlUpload({ filename: input.filename, bytes: input.bytes }, limits);

  // 2. Deterministic extraction. Never mutates the bytes.
  const extracted = await extractMetadata(input.bytes, input.filename);

  // 3. The category must already exist. Checked BEFORE any write, so a bad
  //    category id leaves the library completely untouched.
  const category = await storage.db
    .prepare("SELECT id FROM categories WHERE id = ?")
    .bind(input.categoryId)
    .first<{ id: string }>();
  if (category === null) {
    throw new AppError("CATEGORY_NOT_FOUND", {
      message: "No category with that id. Categories are created by Admin only.",
      detail: { categoryId: input.categoryId },
    });
  }

  const title = resolveTitle(extracted.title, input.overrides?.title);
  const description = resolveDescription(extracted.description, input.overrides?.description);
  const tagNames = input.overrides?.tags ?? extracted.keywords;

  // 4. Identity is generated before any write, so the object key is known
  //    in advance and can never collide with an existing one.
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const sha256 = await sha256Hex(input.bytes);
  const r2Key = buildR2Key(documentId, versionId);
  const slugBase = generateSlug({ title, filename: input.filename, documentId });

  const slugExists = async (candidate: string): Promise<boolean> => {
    const row = await storage.db
      .prepare("SELECT 1 AS present FROM documents WHERE slug = ?")
      .bind(candidate)
      .first<{ present: number }>();
    return row !== null;
  };

  // 5. Two attempts: a concurrent writer can take the slug between the
  //    availability check and the insert. One retry, then SLUG_CONFLICT
  //    rather than an unbounded race (node G1.5, requirement 11).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const slug = await resolveCollision(slugBase, slugExists);
    const now = new Date().toISOString();
    const tagWrite = buildTagWriteStatements(storage.db, documentId, tagNames, now);

    const statements: D1PreparedStatement[] = [
      storage.db
        .prepare(
          `INSERT INTO documents
             (id, slug, title, description, category_id, current_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(documentId, slug, title, description, input.categoryId, now, now),
      ...buildVersionStatements(storage.db, {
        documentId,
        versionId,
        r2Key,
        sha256,
        sizeBytes: input.bytes.byteLength,
        createdBy: input.createdBy,
        note: input.note ?? "",
        restoredFromVersionNo: null,
        now,
      }),
      ...tagWrite.statements,
    ];

    try {
      await writeObjectThenBatch(
        storage,
        { documentId, versionId, bytes: input.bytes, sha256, statements },
        {
          mapBatchError: (error) =>
            isSlugUniquenessFailure(error)
              ? new AppError("SLUG_CONFLICT", {
                  message: "That slug was taken by a concurrent write.",
                  detail: { slug },
                })
              : undefined,
        },
      );
    } catch (error) {
      const lastAttempt = attempt === 1;
      if (error instanceof AppError && error.code === "SLUG_CONFLICT" && !lastAttempt) {
        continue;
      }
      throw error;
    }

    return {
      documentId,
      slug,
      versionId,
      versionNo: await readVersionNo(storage.db, versionId),
      title,
      description,
      tags: tagWrite.normalizedNames,
    };
  }

  throw new AppError("SLUG_CONFLICT", {
    message: "Could not obtain an available slug.",
    detail: { slugBase },
  });
}

// ---------------------------------------------------------------------------
// Metadata update & category move — node G2.3.
//
// Both operations resolve the document by its STABLE SLUG and never write
// documents.slug under any circumstance (AGENT.md §5, §32; the source
// assertion in tests/integration/document-metadata.test.ts proves no
// `UPDATE documents SET slug` statement exists anywhere in the codebase).
// Neither touches R2, creates a version row, or moves current_version_id —
// this is a metadata-only surface. New content goes through the separate
// update-and-version path (node G3.1; SPEC.md §11: "Metadata updates
// happen only when explicitly provided").
// ---------------------------------------------------------------------------

export interface CategoryPathEntry {
  id: string;
  name: string;
  slug: string;
}

export interface DocumentMetadataResult {
  documentId: string;
  slug: string;
  title: string;
  description: string;
  categoryId: string;
  categoryPath: CategoryPathEntry[];
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

interface DocumentRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  categoryId: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

const DOCUMENT_ROW_COLUMNS = `id, slug, title, description, category_id AS categoryId,
       current_version_id AS currentVersionId, created_at AS createdAt, updated_at AS updatedAt`;

/** Resolves a document by its PUBLIC, STABLE slug — never by internal id. */
async function getDocumentBySlug(db: D1Database, slug: string): Promise<DocumentRow> {
  const row = await db
    .prepare(`SELECT ${DOCUMENT_ROW_COLUMNS} FROM documents WHERE slug = ?`)
    .bind(slug)
    .first<DocumentRow>();
  if (row === null) {
    throw new AppError("DOCUMENT_NOT_FOUND", {
      message: "No document with that slug.",
      detail: { slug },
    });
  }
  return row;
}

async function currentDocumentTags(db: D1Database, documentId: string): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT t.normalized_name AS n FROM document_tags dt
       JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = ? ORDER BY t.normalized_name`,
    )
    .bind(documentId)
    .all<{ n: string }>();
  return result.results.map((r) => r.n);
}

async function buildMetadataResult(
  db: D1Database,
  document: DocumentRow,
  tags: string[],
): Promise<DocumentMetadataResult> {
  const path = await resolveCategoryPath(db, document.categoryId);
  return {
    documentId: document.id,
    slug: document.slug,
    title: document.title,
    description: document.description,
    categoryId: document.categoryId,
    categoryPath: path.map(({ id, name, slug }) => ({ id, name, slug })),
    currentVersionId: document.currentVersionId,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    tags,
  };
}

export interface UpdateDocumentMetadataInput {
  title?: string;
  description?: string;
  tags?: string[];
}

/**
 * Updates title, description and/or tags for a document resolved by its
 * stable slug. Only a field explicitly present on `input` is touched (node
 * G2.3 requirement 2) — `input`'s type has no `slug` member at all, so the
 * caller (the route) is responsible for rejecting a request body that
 * carries one with SLUG_IMMUTABLE before this is ever reached.
 *
 * Tags are validated and written through TagService.setDocumentTags BEFORE
 * the title/description UPDATE runs, so an invalid tag (too many, too
 * long, blank) leaves title and description untouched rather than applying
 * half the request (node G2.3 requirement 4).
 */
export async function updateDocumentMetadata(
  db: D1Database,
  slug: string,
  input: UpdateDocumentMetadataInput,
): Promise<DocumentMetadataResult> {
  const document = await getDocumentBySlug(db, slug);

  let title = document.title;
  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (trimmed.length === 0) {
      throw new AppError("TITLE_REQUIRED", {
        message: "Title cannot be empty.",
      });
    }
    title = trimmed;
  }

  // An explicitly empty description is honoured (it clears the field); an
  // absent field leaves the existing description untouched (node G2.3
  // Edge Cases).
  const description = input.description !== undefined ? input.description.trim() : document.description;

  let tags = await currentDocumentTags(db, document.id);
  if (input.tags !== undefined) {
    const result = await setDocumentTags(db, document.id, input.tags);
    tags = result.tags;
  }

  const now = new Date().toISOString();
  await db
    .prepare("UPDATE documents SET title = ?, description = ?, updated_at = ? WHERE id = ?")
    .bind(title, description, now, document.id)
    .run();

  return buildMetadataResult(db, { ...document, title, description, updatedAt: now }, tags);
}

/**
 * Moves a document into a different, already-existing category. A move
 * into the category the document already occupies succeeds as a no-op —
 * `updated_at` still advances — rather than being special-cased away, so
 * every caller gets one consistent code path (node G2.3 Edge Cases). The
 * target category is only ever LOOKED UP, exactly like DocumentService's
 * create path above: this function never creates a category on the
 * caller's behalf (AGENT.md §32).
 */
export async function moveDocument(
  db: D1Database,
  slug: string,
  categoryId: string,
): Promise<DocumentMetadataResult> {
  const document = await getDocumentBySlug(db, slug);

  const category = await db
    .prepare("SELECT id FROM categories WHERE id = ?")
    .bind(categoryId)
    .first<{ id: string }>();
  if (category === null) {
    throw new AppError("CATEGORY_NOT_FOUND", {
      message: "No category with that id. Categories are created by Admin only.",
      detail: { categoryId },
    });
  }

  const now = new Date().toISOString();
  await db
    .prepare("UPDATE documents SET category_id = ?, updated_at = ? WHERE id = ?")
    .bind(categoryId, now, document.id)
    .run();

  const tags = await currentDocumentTags(db, document.id);
  return buildMetadataResult(db, { ...document, categoryId, updatedAt: now }, tags);
}
