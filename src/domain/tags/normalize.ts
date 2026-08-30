// Tag name normalization.
//
// Written by node G1.5, extended (never redefined) by node G2.2. Existing
// `tags.normalized_name` rows depend on this function's exact behaviour, so
// changing it would silently split or merge tags that are already stored.
//
// `normalized_name` is a tag's identity: trimmed, internal whitespace
// collapsed to a single space, lower-cased. `name` keeps the caller's own
// casing for display, so "Value Investing" and "value  investing" are one
// tag whose displayed name is whatever the first writer chose.

export function normalizeTagName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}
