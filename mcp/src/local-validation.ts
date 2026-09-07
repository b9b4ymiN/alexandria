// Local file validation shared by `upload_document` and `update_document`.
//
// Node G5.2 requirement 2 and edge cases: the path must exist, end with
// `.html` (case-insensitive), be non-empty, and fit the size limit — all
// checked with `fs.stat` (metadata only) so a failing file is never read
// into memory, and so the eventual single `readFile` for a passing file
// is the only read (edge case "very large file → read once, not
// repeatedly"). This performs no domain validation (no HTML parsing,
// no sniffing of content) — the Agent API owns every rule about what
// makes a document valid; this only fails fast on what can be checked
// from the filesystem before spending a network round trip (AGENT.md §6, §9).
import { stat } from "node:fs/promises";
import { basename } from "node:path";

export interface LocalFileOk {
  ok: true;
  sizeBytes: number;
  filename: string;
}

export interface LocalFileError {
  ok: false;
  message: string;
}

export type LocalFileValidation = LocalFileOk | LocalFileError;

export async function validateLocalHtmlFile(
  filePath: string,
  maxUploadBytes: number,
): Promise<LocalFileValidation> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return { ok: false, message: `File not found: ${filePath}` };
  }

  if (!info.isFile()) {
    return { ok: false, message: `Not a regular file: ${filePath}` };
  }

  if (!filePath.toLowerCase().endsWith(".html")) {
    return { ok: false, message: `File must have a .html extension: ${filePath}` };
  }

  if (info.size === 0) {
    return { ok: false, message: `File is empty: ${filePath}` };
  }

  if (info.size > maxUploadBytes) {
    return {
      ok: false,
      message: `File exceeds the maximum upload size of ${maxUploadBytes} bytes (was ${info.size} bytes): ${filePath}`,
    };
  }

  return { ok: true, sizeBytes: info.size, filename: basename(filePath) };
}
