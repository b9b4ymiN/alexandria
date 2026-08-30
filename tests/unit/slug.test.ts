import { describe, expect, it } from "vitest";
import { AppError } from "../../src/shared/errors";
import { generateSlug, isValidSlug, resolveCollision } from "../../src/domain/documents/slug";

// SPEC.md §10 slug pattern, restated for readable assertions in this file.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("generateSlug — fallback chain (SPEC.md §10)", () => {
  it("produces a readable slug from a Latin title with mixed case, punctuation and accents", () => {
    expect(generateSlug({ title: "Expectations Investing", documentId: "doc-1" })).toBe(
      "expectations-investing",
    );
    expect(
      generateSlug({ title: "  Café's Grand Opening!!  ", documentId: "doc-2" }),
    ).toBe("cafe-s-grand-opening");
  });

  it("falls through to the filename when the title yields no usable candidate", () => {
    const result = generateSlug({
      title: "ตำราการลงทุน", // Thai-only title, no Latin characters
      filename: "My Investing Notes.html",
      documentId: "doc-3",
    });
    expect(result).toBe("my-investing-notes");
    expect(isValidSlug(result)).toBe(true);
  });

  it("falls through to doc-{shortId} when both title and filename yield nothing", () => {
    const result = generateSlug({
      title: "ตำราการลงทุน",
      filename: "รายงาน.html",
      documentId: "AbC123-def456-ghi789",
    });
    expect(result).toBe("doc-abc123de");
    expect(isValidSlug(result)).toBe(true);
  });

  it("falls through to doc-{shortId} when title/filename are absent entirely", () => {
    const result = generateSlug({ documentId: "AbC123-def456-ghi789" });
    expect(result).toBe("doc-abc123de");
  });

  it("is deterministic: the same documentId always yields the same doc-{shortId} fallback", () => {
    const first = generateSlug({ documentId: "same-document-id" });
    const second = generateSlug({ documentId: "same-document-id" });
    expect(first).toBe(second);
  });

  it("falls through when title is only punctuation or emoji", () => {
    const result = generateSlug({
      title: "!!! 🎉🎉🎉 ???",
      filename: "report.html",
      documentId: "doc-4",
    });
    expect(result).toBe("report");
  });

  it("normalizes a filename with uppercase, spaces and an extension", () => {
    const result = generateSlug({ filename: "MY Report FINAL.html", documentId: "doc-5" });
    expect(result).toBe("my-report-final");
  });

  it("collapses leading, trailing and repeated separators", () => {
    const result = generateSlug({ title: "--- Hello   World ---", documentId: "doc-6" });
    expect(result).toBe("hello-world");
  });

  it("truncates a title longer than 80 characters at a hyphen boundary, never ending in a hyphen", () => {
    const longTitle = "word ".repeat(30).trim(); // far over 80 chars once slugified
    const result = generateSlug({ title: longTitle, documentId: "doc-7" });
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith("-")).toBe(false);
    expect(isValidSlug(result)).toBe(true);
  });

  it("uses doc-{shortId} as a fallback when documentId itself has no alphanumeric characters", () => {
    const result = generateSlug({ documentId: "---" });
    expect(result).toBe("doc-00000000");
    expect(isValidSlug(result)).toBe(true);
  });
});

describe("generateSlug — determinism regression", () => {
  it("produces the same output across 100 runs for the same input", () => {
    const input = { title: "Expectations Investing — 2nd Edition!", documentId: "doc-repeat" };
    const first = generateSlug(input);
    for (let i = 0; i < 100; i++) {
      expect(generateSlug(input)).toBe(first);
    }
  });
});

describe("isValidSlug", () => {
  it("accepts every slug generateSlug can produce", () => {
    const cases = [
      generateSlug({ title: "Expectations Investing", documentId: "a" }),
      generateSlug({ filename: "MY Report FINAL.html", documentId: "b" }),
      generateSlug({ documentId: "c" }),
      generateSlug({ title: "word ".repeat(30), documentId: "d" }),
    ];
    for (const slug of cases) {
      expect(isValidSlug(slug)).toBe(true);
    }
  });

  it.each([
    ["Expectations-Investing", "uppercase"],
    ["-leading-hyphen", "leading hyphen"],
    ["trailing-hyphen-", "trailing hyphen"],
    ["double--hyphen", "double hyphen"],
    ["", "empty string"],
    ["café-résumé", "non-ASCII"],
  ])("rejects %s (%s)", (value) => {
    expect(isValidSlug(value)).toBe(false);
  });

  it("accepts the simplest valid slug", () => {
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("a-b-c")).toBe(true);
    expect(isValidSlug("abc123")).toBe(true);
  });
});

describe("resolveCollision", () => {
  it("returns the base slug unchanged when it does not exist", async () => {
    const exists = async () => false;
    await expect(resolveCollision("expectations-investing", exists)).resolves.toBe(
      "expectations-investing",
    );
  });

  it("walks the collision chain base -> base-2 -> base-3", async () => {
    const taken = new Set(["slug", "slug-2"]);
    const exists = async (candidate: string) => taken.has(candidate);
    await expect(resolveCollision("slug", exists)).resolves.toBe("slug-3");
  });

  it("returns base-4 when base, base-2 and base-3 are all already taken", async () => {
    const taken = new Set(["slug", "slug-2", "slug-3"]);
    const exists = async (candidate: string) => taken.has(candidate);
    await expect(resolveCollision("slug", exists)).resolves.toBe("slug-4");
  });

  it("raises SLUG_CONFLICT once the bounded attempt limit is exhausted, without looping forever", async () => {
    let calls = 0;
    const exists = async () => {
      calls++;
      return true; // every candidate is always taken
    };

    await expect(resolveCollision("slug", exists)).rejects.toMatchObject({
      code: "SLUG_CONFLICT",
    });

    // Bounded: base check (1) + at most 50 suffixed probes.
    expect(calls).toBeLessThanOrEqual(51);
  });

  it("raises an AppError instance carrying the SLUG_CONFLICT code", async () => {
    const exists = async () => true;
    await expect(resolveCollision("slug", exists)).rejects.toBeInstanceOf(AppError);
  });
});

describe("slug pattern sanity (regression against SPEC.md §10)", () => {
  it("SLUG_PATTERN and isValidSlug agree on a battery of inputs", () => {
    const samples = [
      "expectations-investing",
      "doc-abc123de",
      "a",
      "Expectations-Investing",
      "-leading",
      "trailing-",
      "double--hyphen",
      "",
    ];
    for (const sample of samples) {
      expect(isValidSlug(sample)).toBe(SLUG_PATTERN.test(sample));
    }
  });
});
