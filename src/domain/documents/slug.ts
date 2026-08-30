// Deterministic, collision-free slug generation and validation.
//
// Written by node G1.3. Implements the SPEC.md §10 slug contract exactly:
//   title -> filename -> doc-{shortId}
// followed by collision resolution as slug, slug-2, slug-3, ...
//
// This module never touches the database. `resolveCollision` takes an
// injected existence predicate so it stays pure and independently
// testable (IMPLEMENTATION_PLAN.md node G1.3 scope). There is no code path
// here — nor should any consumer build one — that changes an existing
// document's slug: AGENT.md §5 "stable slug" and SPEC.md §10 "slug never
// changes automatically" are invariants, not defaults.

import { AppError } from "../../shared/errors";

/** SPEC.md §10 slug pattern. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Requirement 4: cap slug length at 80 characters. */
const MAX_SLUG_LENGTH = 80;

/** Requirement 3: fallback slug uses a short id derived from documentId. */
const SHORT_ID_LENGTH = 8;

/**
 * Requirement 5: collision suffixes start at -2 and increment; bounded at
 * 50 suffixed attempts (base itself is checked separately, unsuffixed)
 * before raising SLUG_CONFLICT.
 */
const MAX_COLLISION_ATTEMPTS = 50;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/**
 * Normalizes free text into a slug fragment: strips diacritics, lowercases,
 * collapses runs of non-alphanumeric characters into a single hyphen, and
 * trims leading/trailing hyphens. A title/filename with no usable Latin
 * characters (e.g. Thai-only, emoji-only, punctuation-only) normalizes to
 * an empty string on purpose — callers use that to fall through to the
 * next source in the chain, per SPEC.md §10. No transliteration is
 * attempted here or anywhere in this module.
 */
function slugify(value: string): string {
  // U+0300-U+036F: combining diacritical marks left behind by NFKD
  // decomposition (e.g. "é" -> "e" + U+0301).
  const withoutDiacritics = value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const lowered = withoutDiacritics.toLowerCase();
  const collapsed = lowered.replace(/[^a-z0-9]+/g, "-");
  const trimmed = collapsed.replace(/^-+|-+$/g, "");
  return truncateAtHyphenBoundary(trimmed, MAX_SLUG_LENGTH);
}

/**
 * Truncates to at most maxLength characters, cutting back to the nearest
 * hyphen boundary so the result never ends mid-word or with a trailing
 * hyphen (requirement 4).
 */
function truncateAtHyphenBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const cut = value.slice(0, maxLength);
  const lastHyphen = cut.lastIndexOf("-");
  const boundary = lastHyphen === -1 ? cut : cut.slice(0, lastHyphen);
  return boundary.replace(/-+$/g, "");
}

function stripExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
}

/**
 * Requirement 3: shortId derives deterministically from documentId alone,
 * so the same document always produces the same doc-{shortId} fallback.
 */
function shortIdFrom(documentId: string): string {
  const alphanumeric = documentId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const shortId = alphanumeric.slice(0, SHORT_ID_LENGTH);
  return shortId.length > 0 ? shortId : "0".repeat(SHORT_ID_LENGTH);
}

export interface GenerateSlugInput {
  title?: string;
  filename?: string;
  documentId: string;
}

/**
 * SPEC.md §10 fallback chain: title -> filename -> doc-{shortId}. The
 * first source that normalizes to a non-empty candidate wins.
 */
export function generateSlug(input: GenerateSlugInput): string {
  if (input.title) {
    const fromTitle = slugify(input.title);
    if (fromTitle) {
      return fromTitle;
    }
  }

  if (input.filename) {
    const fromFilename = slugify(stripExtension(input.filename));
    if (fromFilename) {
      return fromFilename;
    }
  }

  return `doc-${shortIdFrom(input.documentId)}`;
}

/**
 * Resolves a collision on `base` by probing base-2, base-3, ... via the
 * injected `exists` predicate (requirement/scope: no database access here).
 * Bounded at MAX_COLLISION_ATTEMPTS suffixed probes; raises SLUG_CONFLICT
 * rather than looping forever (requirement 5).
 */
export async function resolveCollision(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) {
    return base;
  }

  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
    const suffix = attempt + 1; // suffixes start at 2
    const candidate = `${base}-${suffix}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }

  throw new AppError("SLUG_CONFLICT", {
    message: `No available slug for "${base}" after ${MAX_COLLISION_ATTEMPTS} suffixed attempts.`,
  });
}
