// Immutable R2 object key convention.
//
// Written by node G1.5. SPEC.md §7 and AGENT.md §12 fix this shape:
//
//   documents/{document_id}/versions/{version_id}.html
//
// The key is derived ONLY from permanent internal identity. Slug, title and
// category never appear in it, so renaming or re-filing a document never
// moves an object, and a stored object is never overwritten — new bytes
// always mean a new version_id and therefore a new key.
//
// The content Worker (node G1.9) reads `document_versions.r2_key` verbatim
// rather than recomputing it, so this function is the single writer of that
// convention.

export function buildR2Key(documentId: string, versionId: string): string {
  return `documents/${documentId}/versions/${versionId}.html`;
}
