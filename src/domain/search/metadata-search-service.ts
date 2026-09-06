// Metadata Search Service — owned by node G4.1.
//
// This module owns every search SEMANTIC: term validation, accent-insensitive
// normalization, wildcard escaping, the WHERE predicate, and the relevance
// ordering. It does not touch D1 or R2 itself — `listDocuments` in
// src/domain/documents/document-read.ts is the ONE place that executes the
// listing SQL (AGENT.md §9: do not copy logic between consumers), and it
// consumes the pure functions exported here to build its WHERE and ORDER BY
// clauses. Keeping this module free of any dependency on document-read.ts
// avoids a circular import between the two files — see the "Decisions"
// section of this node's evidence report for the reasoning.
//
// SPEC.md §14 requires search across title, description, category and tag,
// with NO full HTML text search. AGENT.md §15 rejects embeddings/AI ranking.
// IMPLEMENTATION_PLAN.md node G4.1 rejects SQLite FTS5 outright: its
// tokenizer cannot segment Thai (no word boundaries), which would make a
// Thai query match nothing. Every match here is a plain substring `LIKE`.

import { AppError } from "../../shared/errors";

/** A WHERE/ORDER BY fragment plus the bound values its `?` placeholders need, in order. */
export interface SqlFragment {
  sql: string;
  bindings: string[];
}

// ---------------------------------------------------------------------------
// Query validation (requirement 7)
// ---------------------------------------------------------------------------

export const MAX_SEARCH_QUERY_LENGTH = 200;

/**
 * Trims the caller-supplied term and enforces the length cap. Returns `""`
 * for an absent/whitespace-only query — callers treat `""` as "no search
 * filter, behave like the unfiltered listing" (edge case), not as an error.
 *
 * Unlike a truncation approach, an over-length query is REJECTED rather than
 * silently cut down: truncating would run a query the caller never asked
 * for and return results that look wrong for reasons invisible to the caller.
 */
export function validateSearchQuery(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new AppError("SEARCH_QUERY_TOO_LONG", {
      message: `Search query must be ${MAX_SEARCH_QUERY_LENGTH} characters or fewer.`,
      detail: { length: trimmed.length },
    });
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Accent-insensitive normalization (requirement 3)
//
// SQLite's built-in LOWER() (and LIKE's default case-folding) is ASCII-only
// — D1 loads no ICU extension — so `Résumé` does not match `resume` without
// help. The fix is to normalize BOTH sides the same way:
//   - the bound search term, in TypeScript (normalizeSearchText below)
//   - the compared column, in SQL (accentInsensitiveColumnExpr below)
// Both read from the ONE table below, so they can never drift apart. A
// REPLACE chain over an explicit diacritic set leaves Thai and every other
// non-Latin script untouched by construction — proven by a test in
// tests/integration/search.test.ts rather than assumed.
//
// SCOPE NOTE (finding from implementing this node): D1 enforces SQLite's
// expression-tree depth limit at 100 nodes PER EXPRESSION, and a correlated
// `EXISTS(...)` subquery (needed for the tag match) costs FAR more of that
// budget than a plain REPLACE chain does — confirmed empirically:
//   - a bare `SELECT LOWER(REPLACE(REPLACE(...)))`: 98 nested REPLACEs
//     succeed, 99 fail ("D1_ERROR: Expression tree is too large (maximum
//     depth 100)").
//   - the SAME chain used inside `EXISTS (SELECT ... WHERE tag LIKE ...)`:
//     the ceiling drops to 40 REPLACEs (41 fails) — the subquery's own
//     structure consumes most of the budget.
//   - the FULL real query shape (title/description/category LIKE OR'd with
//     a tag EXISTS in WHERE, PLUS the same four again in the ORDER BY
//     relevance CASE): ceiling is 43 REPLACEs (44 fails) — combining
//     everything costs barely more than the bare EXISTS case above.
// A table covering Latin-1 Supplement AND Latin Extended-A (~178 entries)
// was the original plan and is nowhere close to fitting. Even the full
// Latin-1 Supplement alone (55 entries) exceeds the EXISTS-bounded ceiling.
// There is no dependency-free way to raise D1's limit (no ICU, no custom
// collation without a C extension), so the table below is deliberately cut
// to 24 entries (12 accented letters × two cases) — comfortable margin
// below the empirical 43-entry ceiling for the exact query shape this
// service builds. Latin Extended-A, and several Latin-1 letters that didn't
// make this shortlist (â/ê/î/ô/û, ã/õ, å/ø, ý/ÿ), are out of scope for this
// node as a result; see this node's evidence report, "Findings".
// ---------------------------------------------------------------------------

/**
 * The 12 most linguistically common Latin-1 accented letters (French,
 * Spanish, Italian, Portuguese, German), each mapped to its ASCII base
 * (already lower-case), upper- and lower-case. Kept intentionally small —
 * see the SCOPE NOTE above for why a larger table is not currently possible
 * inside D1's expression-tree depth limit. Ligatures and non-letter symbols
 * (Æ/æ, Ð/ð, Þ/þ, ß, ×, ÷) are excluded on principle regardless of budget:
 * they are not a single base letter, so folding them in would be a guess
 * rather than a normalization.
 *
 * Written as literal UTF-8 characters (this file is saved as UTF-8). These
 * are plain accented letters, never a control character, so there is no
 * risk of git treating the file as binary the way a stray NUL byte would.
 */
export const LATIN_DIACRITIC_MAP: ReadonlyArray<readonly [string, string]> = [
  ["É", "e"], ["È", "e"],
  ["Á", "a"], ["À", "a"], ["Ä", "a"],
  ["Í", "i"],
  ["Ó", "o"], ["Ö", "o"],
  ["Ú", "u"], ["Ü", "u"],
  ["Ñ", "n"],
  ["Ç", "c"],
  ["é", "e"], ["è", "e"],
  ["á", "a"], ["à", "a"], ["ä", "a"],
  ["í", "i"],
  ["ó", "o"], ["ö", "o"],
  ["ú", "u"], ["ü", "u"],
  ["ñ", "n"],
  ["ç", "c"],
];

const DIACRITIC_TO_BASE = new Map(LATIN_DIACRITIC_MAP);

/**
 * Mirrors SQLite's built-in LOWER(), which folds ASCII A-Z only (D1 loads
 * no ICU extension). `String.prototype.toLowerCase()` would go further and
 * fold other scripts SQLite leaves untouched — Greek, Cyrillic, etc. —
 * which would break the TS/SQL agreement this module exists to guarantee.
 */
function asciiLowerCase(input: string): string {
  return input.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

/**
 * TypeScript-side half of accent-insensitive matching: folds every mapped
 * Latin diacritic to its ASCII base, then ASCII-lower-cases the rest. Thai
 * and any other unmapped script passes through unchanged (proven by test).
 */
export function normalizeSearchText(input: string): string {
  let result = "";
  for (const ch of input) {
    result += DIACRITIC_TO_BASE.get(ch) ?? ch;
  }
  return asciiLowerCase(result);
}

/**
 * SQL-side half of accent-insensitive matching: the same fold, expressed as
 * a nested `REPLACE()` chain over `columnExpr`, wrapped in `LOWER()`. Built
 * from the same `LATIN_DIACRITIC_MAP` table as `normalizeSearchText` so the
 * two sides can never drift apart. Order between entries does not matter —
 * every key is a distinct single character.
 */
export function accentInsensitiveColumnExpr(columnExpr: string): string {
  let expr = columnExpr;
  for (const [from, to] of LATIN_DIACRITIC_MAP) {
    expr = `REPLACE(${expr}, '${from}', '${to}')`;
  }
  return `LOWER(${expr})`;
}

// ---------------------------------------------------------------------------
// Wildcard escaping (requirement 2)
// ---------------------------------------------------------------------------

/** Escapes `%`, `_` and the escape character `\` itself so a query containing them is matched literally. */
export function escapeLikeWildcards(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// WHERE predicate (requirements 1, 2, 6, 8) and relevance ordering (requirement 5)
//
// Both assume `term` is already validated and non-empty — callers only
// invoke these once `term !== ""` (see listDocuments). Each returns a
// self-contained SQL fragment plus the bound values its `?`s need, in the
// exact order those `?`s appear in `sql`.
// ---------------------------------------------------------------------------

function likePattern(term: string): string {
  return `%${escapeLikeWildcards(normalizeSearchText(term))}%`;
}

/**
 * `d.title OR d.description OR c.name OR EXISTS(any tag name)`, each side
 * accent-insensitive. Matches once per document regardless of how many
 * fields/tags match (requirement 6) because the outer query is one row per
 * document — the tag check is an EXISTS, never a JOIN that could multiply
 * rows.
 */
export function buildSearchWhereClause(term: string): SqlFragment {
  const pattern = likePattern(term);
  const titleExpr = accentInsensitiveColumnExpr("d.title");
  const descriptionExpr = accentInsensitiveColumnExpr("d.description");
  const categoryExpr = accentInsensitiveColumnExpr("c.name");
  const tagExpr = accentInsensitiveColumnExpr("t_search.name");
  const sql = `(
    ${titleExpr} LIKE ? ESCAPE '\\'
    OR ${descriptionExpr} LIKE ? ESCAPE '\\'
    OR ${categoryExpr} LIKE ? ESCAPE '\\'
    OR EXISTS (
      SELECT 1
      FROM document_tags dt_search
      JOIN tags t_search ON t_search.id = dt_search.tag_id
      WHERE dt_search.document_id = d.id AND ${tagExpr} LIKE ? ESCAPE '\\'
    )
  )`;
  return { sql, bindings: [pattern, pattern, pattern, pattern] };
}

/**
 * A `CASE` expression producing the relevance tier for `ORDER BY`: title (0)
 * < tag (1) < category (2) < description (3) < no match (4) — requirement 5.
 * A caller combines this with `, d.updated_at DESC, d.id ASC` for the
 * within-tier ordering and final stable tiebreaker.
 */
export function buildRelevanceOrderBy(term: string): SqlFragment {
  const pattern = likePattern(term);
  const titleExpr = accentInsensitiveColumnExpr("d.title");
  const tagExpr = accentInsensitiveColumnExpr("t_rank.name");
  const categoryExpr = accentInsensitiveColumnExpr("c.name");
  const descriptionExpr = accentInsensitiveColumnExpr("d.description");
  const sql = `CASE
    WHEN ${titleExpr} LIKE ? ESCAPE '\\' THEN 0
    WHEN EXISTS (
      SELECT 1
      FROM document_tags dt_rank
      JOIN tags t_rank ON t_rank.id = dt_rank.tag_id
      WHERE dt_rank.document_id = d.id AND ${tagExpr} LIKE ? ESCAPE '\\'
    ) THEN 1
    WHEN ${categoryExpr} LIKE ? ESCAPE '\\' THEN 2
    WHEN ${descriptionExpr} LIKE ? ESCAPE '\\' THEN 3
    ELSE 4
  END`;
  return { sql, bindings: [pattern, pattern, pattern, pattern] };
}
