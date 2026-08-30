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
