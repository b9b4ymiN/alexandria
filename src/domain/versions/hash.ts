// SHA-256 content hashing for document versions.
//
// Written by node G1.5. The hash is the identity of a version's BYTES: it
// drives UNCHANGED detection on update (SPEC.md §11) and is stored on the
// version row so the content Worker can serve a correct ETag without
// re-reading the object.

/** Hex-encoded SHA-256 of the given bytes, computed with WebCrypto. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
