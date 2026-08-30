// Node G1.4 — deterministic metadata extraction using the Workers-native
// HTMLRewriter, streaming, with no DOM library and no new dependency
// (AGENT.md §14, §26; SPEC.md §8).
//
// Extraction is TOTAL: it never throws for unusual markup. Documents that
// cannot even be parsed are rejected earlier, by validateHtmlUpload
// (html-validation.ts) — that is the only place a document is refused.
// This module always returns a value.
//
// Fallback chains (SPEC.md §8, IMPLEMENTATION_PLAN.md Node G1.4):
//   title:       <title> text -> first non-empty <h1> text -> filename
//   description: meta[name=description] -> meta[property=og:description]
//                -> first <p> (>=20 trimmed chars, truncated to 300 at a
//                word boundary) -> ""
//   keywords:    meta[name=keywords], comma-split, trimmed, empties
//                dropped, de-duplicated case-insensitively, each capped at
//                50 chars, at most 20 returned
//
// A <p> found inside a <template> is not a description candidate: template
// content is an inert, never-rendered document fragment, so its text is
// not part of what the document actually says (explicit edge case in the
// node contract). A <p> "inside" <script> is never a concern in the first
// place: script content is HTML raw text, so the parser never emits a `p`
// element for it — no special-case code is needed or added for that case.

export interface ExtractedMetadata {
  title: string;
  description: string;
  keywords: string[];
}

const MIN_DESCRIPTION_PARAGRAPH_LENGTH = 20;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_KEYWORD_LENGTH = 50;
const MAX_KEYWORDS = 20;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// A combining mark (Unicode category Mn/Mc/Me) never stands on its own as a
// user-perceived character — it modifies the base character before it (a
// Thai vowel sign or tone mark, for example). A cut must therefore never
// leave one dangling as the final code point of a truncated string, even
// when the cut otherwise lands on a valid grapheme-cluster boundary.
const COMBINING_MARK = /\p{M}/u;

/**
 * Ascending grapheme-cluster boundary offsets in `text`: 0, the end of each
 * cluster in order, and (implicitly, via the final cluster) `text.length`.
 * Cutting `text` at any of these offsets can never split a cluster (e.g. a
 * Thai base consonant plus its combining vowel/tone marks) in two.
 */
function graphemeBoundaries(text: string): number[] {
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const boundaries: number[] = [0];
  for (const { segment, index } of graphemes.segment(text)) {
    boundaries.push(index + segment.length);
  }
  return boundaries;
}

/**
 * Resolves any candidate cut offset (`maxLength`, which need not itself be
 * a valid boundary — word segmentation in a runtime lacking a language's
 * dictionary data can propose a cut mid-cluster) down to the largest
 * grapheme-safe offset at or before it, then keeps retreating a full
 * cluster at a time while the resulting last code point is a combining
 * mark. This guarantees both that no cluster is ever split and that a
 * truncated string never ends on an orphaned combining mark.
 */
function safeTruncationEnd(text: string, maxLength: number): number {
  const boundaries = graphemeBoundaries(text);
  let i = -1;
  for (let b = 0; b < boundaries.length; b += 1) {
    if (boundaries[b]! > maxLength) break;
    i = b;
  }
  if (i < 0) return 0;
  let end = boundaries[i]!;
  while (end > 0 && COMBINING_MARK.test(text[end - 1] ?? "")) {
    i -= 1;
    end = i >= 0 ? boundaries[i]! : 0;
  }
  return end;
}

/**
 * Cuts `text` to at most `maxLength` UTF-16 code units without ever
 * splitting a grapheme cluster (e.g. a Thai base consonant plus its
 * combining vowel/tone marks), and without leaving a combining mark as the
 * final character.
 */
function truncateGraphemeSafe(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, safeTruncationEnd(text, maxLength));
}

/**
 * Truncates `text` to at most `maxLength` UTF-16 code units at a word
 * boundary. Uses locale-agnostic `Intl.Segmenter` word segmentation, which
 * dictionary-segments languages with no inter-word spaces (Thai included)
 * instead of relying on whitespace, so a long single word never forces a
 * mid-character cut. Whatever offset the word pass proposes is then snapped
 * back to a grapheme-safe, non-combining-mark-final offset (see
 * `safeTruncationEnd`) before slicing, since the runtime's word-segmenter
 * dictionary coverage for a given language is not guaranteed. Falls back to
 * a grapheme-safe cut if no word boundary exists within the limit at all
 * (e.g. one token longer than the whole limit).
 */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const words = new Intl.Segmenter(undefined, { granularity: "word" });
  let cut = 0;
  for (const { segment, index } of words.segment(text)) {
    const end = index + segment.length;
    if (end > maxLength) break;
    cut = end;
  }
  if (cut === 0) {
    return truncateGraphemeSafe(text, maxLength);
  }
  return text.slice(0, safeTruncationEnd(text, cut)).trim();
}

function filenameWithoutExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

function parseKeywords(raw: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = collapseWhitespace(part);
    if (trimmed.length === 0) continue;
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(truncateGraphemeSafe(trimmed, MAX_KEYWORD_LENGTH));
    if (result.length >= MAX_KEYWORDS) break;
  }
  return result;
}

interface ExtractionState {
  titleFinalized: boolean;
  titleActive: boolean;
  titleBuffer: string;
  titleText: string;

  h1Found: boolean;
  h1Active: boolean;
  h1Buffer: string;
  h1Text: string;

  descriptionMeta: string;
  ogDescriptionMeta: string;
  keywordsRaw: string;

  descriptionFound: boolean;
  pActive: boolean;
  pBuffer: string;
  pCandidateText: string;

  templateDepth: number;
}

function createState(): ExtractionState {
  return {
    titleFinalized: false,
    titleActive: false,
    titleBuffer: "",
    titleText: "",

    h1Found: false,
    h1Active: false,
    h1Buffer: "",
    h1Text: "",

    descriptionMeta: "",
    ogDescriptionMeta: "",
    keywordsRaw: "",

    descriptionFound: false,
    pActive: false,
    pBuffer: "",
    pCandidateText: "",

    templateDepth: 0,
  };
}

function buildRewriter(state: ExtractionState): HTMLRewriter {
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        if (state.titleFinalized) {
          state.titleActive = false;
          return;
        }
        state.titleActive = true;
        el.onEndTag(() => {
          state.titleActive = false;
          state.titleFinalized = true;
          state.titleText = collapseWhitespace(state.titleBuffer);
        });
      },
      text(chunk) {
        if (state.titleActive) state.titleBuffer += chunk.text;
      },
    })
    .on("template", {
      element(el) {
        state.templateDepth += 1;
        el.onEndTag(() => {
          state.templateDepth = Math.max(0, state.templateDepth - 1);
        });
      },
    })
    .on("h1", {
      element(el) {
        if (state.h1Found) {
          state.h1Active = false;
          return;
        }
        state.h1Active = true;
        state.h1Buffer = "";
        el.onEndTag(() => {
          state.h1Active = false;
          const text = collapseWhitespace(state.h1Buffer);
          if (text.length > 0) {
            state.h1Found = true;
            state.h1Text = text;
          }
        });
      },
      text(chunk) {
        if (state.h1Active) state.h1Buffer += chunk.text;
      },
    })
    .on("meta", {
      element(el) {
        const name = (el.getAttribute("name") ?? "").trim().toLowerCase();
        const property = (el.getAttribute("property") ?? "").trim().toLowerCase();
        const content = el.getAttribute("content") ?? "";
        if (name === "description" && !state.descriptionMeta) {
          state.descriptionMeta = content;
        }
        if (property === "og:description" && !state.ogDescriptionMeta) {
          state.ogDescriptionMeta = content;
        }
        if (name === "keywords" && !state.keywordsRaw) {
          state.keywordsRaw = content;
        }
      },
    })
    .on("p", {
      element(el) {
        if (state.descriptionFound || state.templateDepth > 0) {
          state.pActive = false;
          return;
        }
        state.pActive = true;
        state.pBuffer = "";
        el.onEndTag(() => {
          state.pActive = false;
          const text = collapseWhitespace(state.pBuffer);
          if (!state.descriptionFound && text.length >= MIN_DESCRIPTION_PARAGRAPH_LENGTH) {
            state.descriptionFound = true;
            state.pCandidateText = text;
          }
        });
      },
      text(chunk) {
        if (state.pActive) state.pBuffer += chunk.text;
      },
    });
}

function resolveTitle(state: ExtractionState, filename: string): string {
  if (state.titleText.length > 0) return state.titleText;
  if (state.h1Text.length > 0) return state.h1Text;
  return filenameWithoutExtension(filename);
}

function resolveDescription(state: ExtractionState): string {
  const meta = collapseWhitespace(state.descriptionMeta);
  if (meta.length > 0) return meta;
  const og = collapseWhitespace(state.ogDescriptionMeta);
  if (og.length > 0) return og;
  if (state.descriptionFound) {
    return truncateAtWordBoundary(state.pCandidateText, MAX_DESCRIPTION_LENGTH);
  }
  return "";
}

export async function extractMetadata(bytes: ArrayBuffer, filename: string): Promise<ExtractedMetadata> {
  const state = createState();
  const response = new Response(bytes, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const transformed = buildRewriter(state).transform(response);

  // Drain the transformed stream without collecting it — this drives
  // HTMLRewriter's streaming parse and callbacks to completion without
  // ever materializing a parsed tree, and without buffering a second copy
  // of a (potentially 20 MiB) document just to throw it away.
  if (transformed.body) {
    await transformed.body.pipeTo(new WritableStream());
  } else {
    await transformed.arrayBuffer();
  }

  return {
    title: resolveTitle(state, filename),
    description: resolveDescription(state),
    keywords: parseKeywords(state.keywordsRaw),
  };
}
