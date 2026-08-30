// Client-side metadata preview.
//
// Written by node G1.11.
//
// THIS IS A PREVIEW, NOT AN AUTHORITY.
// The browser reads the chosen file locally with DOMParser purely so the
// operator can see and correct the title, description and tags BEFORE
// publishing. The server re-validates and re-extracts on publish, and any
// field the operator edited is sent as an explicit override. That keeps the
// file on a single upload — the bytes cross the network once, at publish —
// while leaving the server the sole source of truth.
//
// The extraction chain below mirrors SPEC.md §8 so the preview matches what
// the server will decide in the ordinary case. Where they ever disagree,
// the server wins and the success state shows the server's values.

export interface ClientMetadata {
  title: string;
  description: string;
  keywords: string[];
}

const MIN_PARAGRAPH_LENGTH = 20;
const MAX_DESCRIPTION_LENGTH = 300;

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export async function extractClientMetadata(file: File): Promise<ClientMetadata> {
  const text = await file.text();
  const parsed = new DOMParser().parseFromString(text, "text/html");

  const titleText = collapse(parsed.querySelector("title")?.textContent ?? "");
  const h1Text = collapse(parsed.querySelector("h1")?.textContent ?? "");
  const filenameTitle = file.name.replace(/\.html$/i, "");
  const title = titleText !== "" ? titleText : h1Text !== "" ? h1Text : filenameTitle;

  const metaDescription = collapse(
    parsed.querySelector('meta[name="description" i]')?.getAttribute("content") ?? "",
  );
  const ogDescription = collapse(
    parsed.querySelector('meta[property="og:description" i]')?.getAttribute("content") ?? "",
  );
  let paragraph = "";
  for (const element of Array.from(parsed.querySelectorAll("p"))) {
    if (element.closest("template") !== null) continue;
    const candidate = collapse(element.textContent ?? "");
    if (candidate.length >= MIN_PARAGRAPH_LENGTH) {
      paragraph = candidate.slice(0, MAX_DESCRIPTION_LENGTH);
      break;
    }
  }
  const description = metaDescription !== "" ? metaDescription : ogDescription !== "" ? ogDescription : paragraph;

  const keywordsRaw = parsed.querySelector('meta[name="keywords" i]')?.getAttribute("content") ?? "";
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of keywordsRaw.split(",")) {
    const trimmed = collapse(part);
    if (trimmed === "" || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    keywords.push(trimmed.slice(0, 50));
    if (keywords.length === 20) break;
  }

  return { title, description, keywords };
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Mirrors the server's cheap checks so a 20 MiB round trip is not wasted on
 * a file that will certainly be rejected. It never REPLACES server
 * validation — the server runs the full chain again on publish.
 */
export function preflight(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".html")) {
    return "Only .html files can be published.";
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`;
  }
  return null;
}
