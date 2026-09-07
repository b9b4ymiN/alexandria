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
// Thai query match nothing. Every match here is a plain substring test via
// SQLite's `instr()` — see the block comment above buildSearchWhereClause
// for why it is `instr` and not the `LIKE` the node originally specified.

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
// SCOPE NOTE: D1 enforces SQLite's expression-tree depth limit at 100 nodes
// PER EXPRESSION, and a correlated `EXISTS(...)` subquery (needed for the
// tag match) costs FAR more of that budget than a plain REPLACE chain does.
// Measured, not estimated — the numbers below are from a probe run against a
// real D1 binding, and each was re-run after PLAN DELTA 2 changed the query
// shape from `LIKE` to `instr()`:
//   - a bare `SELECT LOWER(REPLACE(REPLACE(...)))`: 97 nested REPLACEs
//     succeed, 98 fails ("Expression tree is too large (maximum depth 100)").
//   - the FULL real query shape (title/description/category OR'd with a tag
//     EXISTS in WHERE, PLUS the same four again in the ORDER BY relevance
//     CASE): 41 REPLACEs succeed, 42 fails. It was 42 with the old `LIKE`
//     form, so the switch to `instr` cost one link and changed nothing that
//     matters here.
//   - hoisting the tag match out of its correlated EXISTS into a CTE was
//     tried and measured too: 43. One extra link, for a materially more
//     complicated query — rejected.
// A table covering Latin-1 Supplement AND Latin Extended-A (~178 entries)
// was the original plan and is nowhere close to fitting. Even the full
// Latin-1 Supplement alone (55 entries) exceeds the ceiling. There is no
// dependency-free way to raise D1's limit (no ICU, no custom collation
// without a C extension), so the table below is deliberately cut to 24
// entries (12 accented letters × two cases) — comfortable margin below the
// empirical 41-entry ceiling for the exact query shape this service builds.
// Latin Extended-A, and several Latin-1 letters that didn't make this
// shortlist (â/ê/î/ô/û, ã/õ, å/ø, ý/ÿ), are out of scope as a result. The
// complete fix is a normalized comparison column, which G4.1 requirement 9
// defers until search measures slow; it needs a migration, so it is a future
// node rather than a quiet widening of this one.
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
// WHERE predicate (requirements 1, 2, 6, 8) and relevance ordering (requirement 5)
//
// Both assume `term` is already validated and non-empty — callers only
// invoke these once `term !== ""` (see listDocuments). Each returns a
// self-contained SQL fragment plus the bound values its `?`s need, in the
// exact order those `?`s appear in `sql`.
//
// SUBSTRING MATCHING USES `instr()`, NOT `LIKE` — see PLAN DELTA 2. Node
// G4.1 requirement 1 prescribed `LIKE '%' || ? || '%'`, and that shipped and
// broke in production while passing every local test: D1's SQLite is built
// with SQLITE_MAX_LIKE_PATTERN_LENGTH = 50 BYTES, so any term over 48 bytes
// (16 Thai characters, since Thai is 3 bytes per character in UTF-8) failed
// the whole request with "LIKE or GLOB pattern too complex: SQLITE_ERROR
// [code: 7500]". The miniflare D1 the test suite runs against does not
// enforce that limit, so no local test could see it. `instr(haystack,
// needle) > 0` is the same substring semantics with no pattern-length limit,
// and it needs no wildcard escaping at all: `%` and `_` are ordinary
// characters to `instr`, so requirement 2 is satisfied by construction
// rather than by an ESCAPE clause. There is a test asserting the generated
// SQL contains no `LIKE`, because the environment that would catch a
// regression here is not the one the tests run in.
// ---------------------------------------------------------------------------

function searchNeedle(term: string): string {
  return normalizeSearchText(term);
}

/**
 * `d.title OR d.description OR c.name OR EXISTS(any tag name)`, each side
 * accent-insensitive. Matches once per document regardless of how many
 * fields/tags match (requirement 6) because the outer query is one row per
 * document — the tag check is an EXISTS, never a JOIN that could multiply
 * rows.
 */
export function buildSearchWhereClause(term: string): SqlFragment {
  const needle = searchNeedle(term);
  const titleExpr = accentInsensitiveColumnExpr("d.title");
  const descriptionExpr = accentInsensitiveColumnExpr("d.description");
  const categoryExpr = accentInsensitiveColumnExpr("c.name");
  const tagExpr = accentInsensitiveColumnExpr("t_search.name");
  const sql = `(
    instr(${titleExpr}, ?) > 0
    OR instr(${descriptionExpr}, ?) > 0
    OR instr(${categoryExpr}, ?) > 0
    OR EXISTS (
      SELECT 1
      FROM document_tags dt_search
      JOIN tags t_search ON t_search.id = dt_search.tag_id
      WHERE dt_search.document_id = d.id AND instr(${tagExpr}, ?) > 0
    )
  )`;
  return { sql, bindings: [needle, needle, needle, needle] };
}

/**
 * A `CASE` expression producing the relevance tier for `ORDER BY`: title (0)
 * < tag (1) < category (2) < description (3) < no match (4) — requirement 5.
 * A caller combines this with `, d.updated_at DESC, d.id ASC` for the
 * within-tier ordering and final stable tiebreaker.
 */
export function buildRelevanceOrderBy(term: string): SqlFragment {
  const needle = searchNeedle(term);
  const titleExpr = accentInsensitiveColumnExpr("d.title");
  const tagExpr = accentInsensitiveColumnExpr("t_rank.name");
  const categoryExpr = accentInsensitiveColumnExpr("c.name");
  const descriptionExpr = accentInsensitiveColumnExpr("d.description");
  const sql = `CASE
    WHEN instr(${titleExpr}, ?) > 0 THEN 0
    WHEN EXISTS (
      SELECT 1
      FROM document_tags dt_rank
      JOIN tags t_rank ON t_rank.id = dt_rank.tag_id
      WHERE dt_rank.document_id = d.id AND instr(${tagExpr}, ?) > 0
    ) THEN 1
    WHEN instr(${categoryExpr}, ?) > 0 THEN 2
    WHEN instr(${descriptionExpr}, ?) > 0 THEN 3
    ELSE 4
  END`;
  return { sql, bindings: [needle, needle, needle, needle] };
}
