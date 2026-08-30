// Node G1.4 — deterministic server-side validation of an uploaded .html
// file.
//
// This module never reads the bytes for content and never rewrites,
// sanitizes, prettifies or re-encodes them (AGENT.md §7). It only inspects
// them to decide accept/reject. Metadata extraction lives in a separate
// module, metadata.ts, which is the only other place these bytes are read.
//
// The chain below runs in the exact order and produces the exact codes
// required by IMPLEMENTATION_PLAN.md Node G1.4:
//   1. filename ends with .html                    -> INVALID_FILE_EXTENSION
//   2. byte length > 0                              -> FILE_REQUIRED
//   3. byte length <= maxBytes                      -> FILE_TOO_LARGE
//   4. bytes decode as UTF-8 (fatal: true)          -> INVALID_HTML
//   5. a structural marker within the first 64 KiB  -> INVALID_HTML
//   6. an HTMLRewriter pass completes without throwing -> INVALID_HTML
//
// The 64 KiB window (STRUCTURAL_MARKER_WINDOW_BYTES) is a deliberate,
// explicit decision recorded in the node contract — do not shrink it.
//
// Signature note: the node's Interfaces/Contracts sketch lists
// `validateHtmlUpload(...): void` (synchronous). Step 6 requires actually
// driving an HTMLRewriter pass to completion, which is only observable by
// consuming the transformed body — an inherently asynchronous operation in
// the Workers runtime (transform() itself never throws synchronously; a
// parse failure only surfaces while reading the resulting stream). This
// function is therefore `Promise<void>`, the smallest change that lets
// requirement 1's step 6 actually run inside this single ordered chain,
// rather than being silently skipped or split into a second function no
// caller was told to call. Recorded here rather than silently deviating.
import { AppError } from "../../shared/errors";

export interface UploadLimits {
  maxBytes: number;
}

/**
 * Recommended application default (SPEC.md §7): 20 MiB. Callers read the
 * actual limit from environment configuration (an `Env` binding not yet
 * declared as of this node) and fall back to this constant; this module
 * itself never reads the environment; it only accepts the resolved limit.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const STRUCTURAL_MARKER_WINDOW_BYTES = 64 * 1024;

const STRUCTURAL_MARKERS = ["<!doctype html", "<html", "<body"];

export async function validateHtmlUpload(
  input: { filename: string; bytes: ArrayBuffer },
  limits: UploadLimits,
): Promise<void> {
  const { filename, bytes } = input;

  // 1. filename ends with .html
  if (!filename.toLowerCase().endsWith(".html")) {
    throw new AppError("INVALID_FILE_EXTENSION", {
      message: `Expected a .html file, got "${filename}"`,
    });
  }

  // 2. byte length greater than zero
  if (bytes.byteLength === 0) {
    throw new AppError("FILE_REQUIRED", { message: "Uploaded file is empty" });
  }

  // 3. byte length at most maxBytes
  if (bytes.byteLength > limits.maxBytes) {
    throw new AppError("FILE_TOO_LARGE", {
      message: `File is ${bytes.byteLength} bytes, exceeding the ${limits.maxBytes} byte limit`,
    });
  }

  // 4. bytes decode as UTF-8, fatal on invalid sequences
  try {
    // @cloudflare/workers-types declares TextDecoderConstructorOptions with
    // both `fatal` and `ignoreBOM` required, so both must be supplied.
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new AppError("INVALID_HTML", { message: "File is not valid UTF-8" });
  }

  // 5. a structural marker appears within the first 64 KiB, case-insensitive
  const windowBytes = bytes.slice(0, STRUCTURAL_MARKER_WINDOW_BYTES);
  const windowText = new TextDecoder("utf-8").decode(windowBytes).toLowerCase();
  const hasStructuralMarker = STRUCTURAL_MARKERS.some((marker) => windowText.includes(marker));
  if (!hasStructuralMarker) {
    throw new AppError("INVALID_HTML", {
      message: "No HTML structural marker (<!doctype html>, <html> or <body>) found in the first 64 KiB",
    });
  }

  // 6. an HTMLRewriter pass over the document completes without throwing
  try {
    const response = new Response(bytes);
    const transformed = new HTMLRewriter().transform(response);
    if (transformed.body) {
      await transformed.body.pipeTo(new WritableStream());
    } else {
      await transformed.arrayBuffer();
    }
  } catch {
    throw new AppError("INVALID_HTML", { message: "Document could not be parsed" });
  }
}
