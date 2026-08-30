// Node G1.4 — HTML Validation & Metadata Extraction.
//
// Exercises validateHtmlUpload and extractMetadata against the real
// Workers runtime (HTMLRewriter, TextDecoder with fatal:true, and
// crypto.subtle are all Workers-native APIs), following the same
// @cloudflare/vitest-pool-workers pattern as tests/integration/schema.test.ts.
import { describe, expect, it } from "vitest";
import { AppError, type ErrorCode } from "../../src/shared/errors";
import { DEFAULT_MAX_UPLOAD_BYTES, validateHtmlUpload, type UploadLimits } from "../../src/domain/documents/html-validation";
import { extractMetadata } from "../../src/domain/documents/metadata";

// The real SPEC §28 acceptance fixture at the repo root.
// @ts-expect-error - Vite ?raw import has no shipped ambient type (see
// tests/integration/schema.test.ts for why this is a local suppression
// rather than a tsconfig change).
import mauboussinFixture from "../../mauboussin-expectations-investing-summary.html?raw";

// @ts-expect-error - Vite ?raw import has no shipped ambient type
import titleH1FallbackMissingHeadHtml from "../fixtures/title-h1-fallback-missing-head.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import titleWhitespaceOnlyHtml from "../fixtures/title-whitespace-only.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import noTitleNoH1Html from "../fixtures/no-title-no-h1.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import multipleTitlesHtml from "../fixtures/multiple-titles.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import h1NestedMarkupHtml from "../fixtures/h1-nested-markup.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import metaDescriptionHtml from "../fixtures/meta-description.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import ogDescriptionHtml from "../fixtures/og-description.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import uppercaseMetaDescriptionHtml from "../fixtures/uppercase-meta-description.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import paragraphDescriptionFallbackHtml from "../fixtures/paragraph-description-fallback.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import emptyDescriptionHtml from "../fixtures/empty-description.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import pInScriptAndTemplateHtml from "../fixtures/p-in-script-and-template.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import thaiLongParagraphHtml from "../fixtures/thai-long-paragraph.html?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import keywordsHtml from "../fixtures/keywords.html?raw";

const DEFAULT_LIMITS: UploadLimits = { maxBytes: DEFAULT_MAX_UPLOAD_BYTES };

function toBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Awaits `fn()`, asserting it rejects with an AppError carrying `code`. */
async function expectCode(fn: () => Promise<unknown>, code: ErrorCode): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe(code);
}

function buildLargeHtml(totalBytes: number): ArrayBuffer {
  const prefix =
    "<!doctype html><html><head><title>Large Synthetic Document</title></head><body><p>Large document streaming test.</p><!--";
  const suffix = "--></body></html>";
  const fillerLength = totalBytes - prefix.length - suffix.length;
  if (fillerLength < 0) throw new Error("totalBytes too small for buildLargeHtml template");
  const html = prefix + "a".repeat(fillerLength) + suffix;
  return toBytes(html);
}

describe("validateHtmlUpload", () => {
  describe("positive", () => {
    it("accepts the Mauboussin acceptance fixture (SPEC §28)", async () => {
      await expect(
        validateHtmlUpload({ filename: "mauboussin-expectations-investing-summary.html", bytes: toBytes(mauboussinFixture) }, DEFAULT_LIMITS),
      ).resolves.toBeUndefined();
    });

    it("accepts an uppercase .HTML extension", async () => {
      await expect(validateHtmlUpload({ filename: "Fixture.HTML", bytes: toBytes(noTitleNoH1Html) }, DEFAULT_LIMITS)).resolves.toBeUndefined();
    });

    it("accepts a structural marker appearing after 4 KiB but within the 64 KiB window (proves the window is 64 KiB, not 4 KiB)", async () => {
      const html = `<!--${"x".repeat(10_000)}--><!doctype html><html><body><p>Late marker within window.</p></body></html>`;
      await expect(validateHtmlUpload({ filename: "late-marker-within-window.html", bytes: toBytes(html) }, DEFAULT_LIMITS)).resolves.toBeUndefined();
    });

    it("accepts a file exactly at the configured byte limit", async () => {
      const html = "<!doctype html><html><head><title>Boundary</title></head><body><p>Boundary content for the size limit test.</p></body></html>";
      const bytes = toBytes(html);
      const limits: UploadLimits = { maxBytes: bytes.byteLength };
      await expect(validateHtmlUpload({ filename: "boundary.html", bytes }, limits)).resolves.toBeUndefined();
    });

    it("accepts and preserves a 20 MiB synthetic document without exhausting memory", async () => {
      const bytes = buildLargeHtml(DEFAULT_MAX_UPLOAD_BYTES);
      expect(bytes.byteLength).toBe(DEFAULT_MAX_UPLOAD_BYTES);
      await expect(validateHtmlUpload({ filename: "large.html", bytes }, DEFAULT_LIMITS)).resolves.toBeUndefined();
    });
  });

  describe("negative", () => {
    it.each([".htm", ".txt", ".zip", ""])("rejects filename with extension %j as INVALID_FILE_EXTENSION", async (ext) => {
      const filename = ext === "" ? "no-extension" : `document${ext}`;
      await expectCode(() => validateHtmlUpload({ filename, bytes: toBytes("<!doctype html><html><body></body></html>") }, DEFAULT_LIMITS), "INVALID_FILE_EXTENSION");
    });

    it("rejects an empty file as FILE_REQUIRED", async () => {
      await expectCode(() => validateHtmlUpload({ filename: "empty.html", bytes: new ArrayBuffer(0) }, DEFAULT_LIMITS), "FILE_REQUIRED");
    });

    it("rejects a file over the configured byte limit as FILE_TOO_LARGE", async () => {
      const bytes = toBytes("<!doctype html><html><body>too big</body></html>");
      const limits: UploadLimits = { maxBytes: bytes.byteLength - 1 };
      await expectCode(() => validateHtmlUpload({ filename: "oversized.html", bytes }, limits), "FILE_TOO_LARGE");
    });

    it("rejects a file one byte over the configured byte limit as FILE_TOO_LARGE", async () => {
      const html = "<!doctype html><html><head><title>Boundary</title></head><body><p>Boundary content for the size limit test.</p></body></html>";
      const exactBytes = toBytes(html);
      const limits: UploadLimits = { maxBytes: exactBytes.byteLength };
      const overBytes = toBytes(html + " ");
      await expectCode(() => validateHtmlUpload({ filename: "boundary.html", bytes: overBytes }, limits), "FILE_TOO_LARGE");
    });

    it("rejects invalid UTF-8 as INVALID_HTML", async () => {
      const invalidUtf8 = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0xff, 0xfe, 0x00, 0x80]).buffer;
      await expectCode(() => validateHtmlUpload({ filename: "invalid-utf8.html", bytes: invalidUtf8 }, DEFAULT_LIMITS), "INVALID_HTML");
    });

    it("rejects plain text with no structural marker as INVALID_HTML", async () => {
      const bytes = toBytes("Hello, this is plain text with no HTML markers anywhere in it at all.");
      await expectCode(() => validateHtmlUpload({ filename: "plain.html", bytes }, DEFAULT_LIMITS), "INVALID_HTML");
    });

    it("rejects a structural marker appearing only after 64 KiB as INVALID_HTML", async () => {
      const html = `<!--${"x".repeat(70_000)}--><html><body></body></html>`;
      const bytes = toBytes(html);
      expect(bytes.byteLength).toBeGreaterThan(65_536);
      await expectCode(() => validateHtmlUpload({ filename: "late-marker-beyond-window.html", bytes }, DEFAULT_LIMITS), "INVALID_HTML");
    });

    it("rejects a .html file containing binary content as INVALID_HTML", async () => {
      const bytes = crypto.getRandomValues(new Uint8Array(256)).buffer;
      await expectCode(() => validateHtmlUpload({ filename: "binary.html", bytes }, DEFAULT_LIMITS), "INVALID_HTML");
    });
  });

  describe("regression — byte preservation", () => {
    it("never mutates the bytes handed to it (sha256 identical before and after)", async () => {
      const bytes = toBytes(mauboussinFixture);
      const before = await sha256Hex(bytes);
      await validateHtmlUpload({ filename: "mauboussin-expectations-investing-summary.html", bytes }, DEFAULT_LIMITS);
      const after = await sha256Hex(bytes);
      expect(after).toBe(before);
    });
  });
});

describe("extractMetadata", () => {
  describe("title fallback chain", () => {
    it("uses the first <title> when multiple exist", async () => {
      const result = await extractMetadata(toBytes(multipleTitlesHtml), "multiple-titles.html");
      expect(result.title).toBe("First Title Wins");
    });

    it("falls back to the first <h1> when <title> is absent and <head> is missing entirely", async () => {
      const result = await extractMetadata(toBytes(titleH1FallbackMissingHeadHtml), "title-h1-fallback-missing-head.html");
      expect(result.title).toBe("Body Only Heading From H1");
    });

    it("falls back to <h1> when <title> is present but whitespace-only", async () => {
      const result = await extractMetadata(toBytes(titleWhitespaceOnlyHtml), "title-whitespace-only.html");
      expect(result.title).toBe("Fallback Heading From H1");
    });

    it("falls back to the filename (extension stripped) when neither <title> nor <h1> is usable", async () => {
      const result = await extractMetadata(toBytes(noTitleNoH1Html), "no-title-no-h1.html");
      expect(result.title).toBe("no-title-no-h1");
    });

    it("uses only the text content of an <h1> containing nested markup", async () => {
      const result = await extractMetadata(toBytes(h1NestedMarkupHtml), "h1-nested-markup.html");
      expect(result.title).toBe("Understanding Expectations Investing Fully");
    });
  });

  describe("description fallback chain", () => {
    it("uses meta[name=description] when present", async () => {
      const result = await extractMetadata(toBytes(metaDescriptionHtml), "meta-description.html");
      expect(result.description).toBe("A concise meta description for the fixture.");
    });

    it("uses meta[property=og:description] when meta description is absent", async () => {
      const result = await extractMetadata(toBytes(ogDescriptionHtml), "og-description.html");
      expect(result.description).toBe("OG description used because meta description is absent.");
    });

    it("matches <META NAME=\"DESCRIPTION\"> case-insensitively", async () => {
      const result = await extractMetadata(toBytes(uppercaseMetaDescriptionHtml), "uppercase-meta-description.html");
      expect(result.description).toBe("Matched case-insensitively despite the uppercase tag and attribute name.");
    });

    it("falls back to the first qualifying <p> (>= 20 trimmed chars) when no meta description exists", async () => {
      const result = await extractMetadata(toBytes(paragraphDescriptionFallbackHtml), "paragraph-description-fallback.html");
      expect(result.description).toBe(
        "This second paragraph is long enough to qualify as the description fallback candidate for the document.",
      );
    });

    it("returns an empty string when no candidate qualifies", async () => {
      const result = await extractMetadata(toBytes(emptyDescriptionHtml), "empty-description.html");
      expect(result.description).toBe("");
    });

    it("never treats a <p> inside <script> or <template> as a description candidate", async () => {
      const result = await extractMetadata(toBytes(pInScriptAndTemplateHtml), "p-in-script-and-template.html");
      expect(result.description).toBe(
        "This is the real first paragraph outside of script and template, long enough to qualify as the description.",
      );
    });

    it("truncates Thai text with no inter-word spaces at a word boundary without splitting a character", async () => {
      const result = await extractMetadata(toBytes(thaiLongParagraphHtml), "thai-long-paragraph.html");
      expect(result.description.length).toBeLessThanOrEqual(300);
      expect(result.description.length).toBeGreaterThan(0);
      // A split grapheme would leave an orphaned Thai combining mark
      // (a vowel sign or tone mark, Unicode category Mn) as the final
      // character — proving the cut respected character boundaries.
      const lastChar = result.description.at(-1) ?? "";
      expect(/\p{Mn}/u.test(lastChar)).toBe(false);
    });
  });

  describe("keywords", () => {
    it("splits, trims, drops empties, de-duplicates case-insensitively, caps length and count", async () => {
      const result = await extractMetadata(toBytes(keywordsHtml), "keywords.html");
      expect(result.keywords.length).toBe(20);
      expect(result.keywords[0]).toBe("Valuation");
      expect(result.keywords[1]).toBe("Investing");
      expect(result.keywords[2]).toBe("Growth");
      // The 4th entry is the deliberately long token, capped at 50 chars.
      expect(result.keywords[3]!.length).toBeLessThanOrEqual(50);
      expect(result.keywords.slice(4)).toEqual(
        Array.from({ length: 16 }, (_, i) => `k${i + 1}`),
      );
      // Case-insensitive de-duplication: "valuation" (lowercase) must not
      // appear as a second entry.
      expect(result.keywords.filter((k) => k.toLowerCase() === "valuation").length).toBe(1);
      for (const keyword of result.keywords) {
        expect(keyword.length).toBeLessThanOrEqual(50);
      }
    });

    it("returns an empty array when no keywords meta tag exists", async () => {
      const result = await extractMetadata(toBytes(emptyDescriptionHtml), "empty-description.html");
      expect(result.keywords).toEqual([]);
    });
  });

  describe("Mauboussin acceptance fixture (SPEC §28)", () => {
    it("yields a sensible title and description", async () => {
      const result = await extractMetadata(toBytes(mauboussinFixture), "mauboussin-expectations-investing-summary.html");
      expect(result.title).toBe("Expectations Investing — อ่านราคาหุ้น เพื่อผลตอบแทนที่ดีกว่า");
      expect(result.description.length).toBeGreaterThan(0);
      expect(result.description.length).toBeLessThanOrEqual(300);
      // No meta description or og:description exists in this fixture, so
      // the description must come from the first qualifying paragraph.
      expect(result.description).toContain("เอกสารนี้เดินตามลำดับบทของฉบับ");
    });
  });

  describe("streaming — 20 MiB document", () => {
    it("extracts metadata from a 20 MiB synthetic document without materializing a parsed tree", async () => {
      const bytes = buildLargeHtml(DEFAULT_MAX_UPLOAD_BYTES);
      const result = await extractMetadata(bytes, "large.html");
      expect(result.title).toBe("Large Synthetic Document");
      expect(result.description).toBe("Large document streaming test.");
    });
  });

  describe("regression — byte preservation", () => {
    it("never mutates the bytes handed to it (sha256 identical before and after)", async () => {
      const bytes = toBytes(mauboussinFixture);
      const before = await sha256Hex(bytes);
      await extractMetadata(bytes, "mauboussin-expectations-investing-summary.html");
      const after = await sha256Hex(bytes);
      expect(after).toBe(before);
    });
  });
});
