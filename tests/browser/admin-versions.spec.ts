// Node G3.5 — Admin UI: Version History, in a real browser.
//
// Every document this spec creates is its own throwaway, published fresh
// through the real Upload screen with a RUN-suffixed title so this spec
// never collides with, or is affected by, whatever else is running
// against the same local D1 (IMPLEMENTATION_PLAN.md §9; see
// admin-categories.spec.ts and admin-tags.spec.ts for the same
// convention). One of the two documents this file deletes for real is the
// one built specifically to be deleted — the shared `expectations-investing`
// and `admin-editable-document` fixtures other specs read/mutate are never
// touched.
//
// Serial within this file: several tests build on the SAME document
// created by the first test (upload v1 -> upload v2 -> restore -> delete),
// so later tests depend on the version history left behind by earlier
// ones, exactly like admin-categories.spec.ts's serial nested-category
// flow.
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./admin-session";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(here, "../../mauboussin-expectations-investing-summary.html");
const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);

const RUN = Date.now().toString(36);
// Different bytes from FIXTURE_PATH (a distinct sha256), so uploading this
// as version 2 is a real change and re-uploading it a second time is a
// genuine UNCHANGED no-op rather than an accident of identical fixtures.
const V2_BYTES = Buffer.concat([FIXTURE_BYTES, Buffer.from(`\n<!-- version 2 marker ${RUN} -->\n`)]);

/** Scopes assertions to one version's row via its (version-number-unique) Preview button. */
function versionRow(page: Page, versionNo: number) {
  return page.locator("li").filter({
    has: page.getByRole("button", { name: `Preview version ${versionNo}`, exact: true }),
  });
}

/**
 * Publishes the shared fixture through the real Upload screen with an
 * overridden, RUN-unique title, so the resulting slug is predictable and
 * never fights the slug this exact fixture already occupies
 * (`expectations-investing`, seeded for node G1.10) or any collision chain
 * other specs re-uploading the same file have left behind.
 */
async function publishDocument(page: Page, title: string): Promise<string> {
  await page.goto("/admin");
  await page.getByLabel("HTML file").setInputFiles(FIXTURE_PATH);
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/This URL is permanent/i)).toBeVisible({ timeout: 15000 });

  const href = await page.getByRole("link", { name: "Open in the Reader" }).getAttribute("href");
  const slug = (href ?? "").replace(/^\/docs\//, "");
  expect(slug).not.toBe("");
  return slug;
}

test.describe("Admin version history", () => {
  test.describe.configure({ mode: "serial" });

  // Shared across the tests below, exactly as `admin-categories.spec.ts`
  // shares category/document names created by an earlier test in the
  // same file — set once, by the first test.
  let mainSlug = "";

  test("uploads a new version, moving the current flag and showing size/timestamp/note", async ({ page }) => {
    await signInAs(page, "/admin");
    mainSlug = await publishDocument(page, `Version History ${RUN}`);

    await page.goto(`/admin/documents/${mainSlug}`);
    await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
    await expect(versionRow(page, 1)).toContainText("Current");
    await expect(versionRow(page, 1)).toContainText("admin");

    const longNote = "N".repeat(120);
    await page.getByLabel("Upload a new version").setInputFiles({
      name: "v2.html",
      mimeType: "text/html",
      buffer: V2_BYTES,
    });
    await page.getByLabel("Note (optional)").fill(longNote);
    await page.getByRole("button", { name: "Upload new version" }).click();

    await expect(page.getByText(/Published as version 2/i)).toBeVisible();
    await expect(versionRow(page, 2)).toContainText("Current");
    await expect(versionRow(page, 1)).not.toContainText("Current");

    // Requirement 7 (note shown) + Edge Case ("very long note -> truncated
    // with the full text available").
    await expect(versionRow(page, 2).getByRole("button", { name: "Show full note" })).toBeVisible();
    await expect(versionRow(page, 2)).not.toContainText(longNote);
    await versionRow(page, 2).getByRole("button", { name: "Show full note" }).click();
    await expect(versionRow(page, 2)).toContainText(longNote);
  });

  test("reports UNCHANGED as a calm outcome, not an error, and leaves the table unchanged", async ({ page }) => {
    await signInAs(page, `/admin/documents/${mainSlug}`);

    await page.getByLabel("Upload a new version").setInputFiles({
      name: "v2-again.html",
      mimeType: "text/html",
      buffer: V2_BYTES,
    });
    await page.getByRole("button", { name: "Upload new version" }).click();

    const outcome = page.getByRole("status").filter({ hasText: /nothing changed/i });
    await expect(outcome).toBeVisible();
    // A non-alarming outcome, never an alert.
    await expect(page.getByRole("alert")).toHaveCount(0);
    // No third version was created.
    await expect(page.getByRole("button", { name: "Preview version 3" })).toHaveCount(0);
    await expect(versionRow(page, 2)).toContainText("Current");
  });

  test("previews a historical version in the Reader's exact sandbox, with a freshly requested URL each time", async ({
    page,
  }) => {
    await signInAs(page, `/admin/documents/${mainSlug}`);

    let previewUrlRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/preview-url")) previewUrlRequests += 1;
    });

    await versionRow(page, 1).getByRole("button", { name: "Preview version 1" }).click();

    const dialog = page.getByRole("dialog", { name: /Preview of version 1/i });
    await expect(dialog).toBeVisible();

    const frame = dialog.locator("iframe");
    await expect(frame).toBeVisible();
    // Same sandbox contract as the public Reader (DocumentFrame.tsx /
    // reader.spec.ts) — no allow-same-origin, ever.
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-downloads");
    const sandbox = await frame.getAttribute("sandbox");
    expect(sandbox).not.toContain("allow-same-origin");
    await expect(frame).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");

    // <= 2, not exactly 1: React StrictMode double-invokes effects on
    // mount in dev (see public-browse.spec.ts's identical allowance), so
    // one *logical* open can legitimately fire two requests. The point
    // this proves is a request happens on open at all — never zero, i.e.
    // never a value read from somewhere already in memory.
    expect(previewUrlRequests).toBeGreaterThanOrEqual(1);
    expect(previewUrlRequests).toBeLessThanOrEqual(2);
    const afterFirstOpen = previewUrlRequests;

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);

    // Reopening — even the SAME version — requests a brand-new URL rather
    // than reusing the one from a moment ago (requirement 4): the count
    // strictly increases past whatever the first open produced.
    await versionRow(page, 1).getByRole("button", { name: "Preview version 1" }).click();
    await expect(page.getByRole("dialog", { name: /Preview of version 1/i })).toBeVisible();
    await expect(dialog.locator("iframe")).toBeVisible();
    expect(previewUrlRequests).toBeGreaterThan(afterFirstOpen);
  });

  test("restores an older version, creating a new current version with provenance", async ({ page }) => {
    await signInAs(page, `/admin/documents/${mainSlug}`);

    let dialogMessage = "";
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });
    await versionRow(page, 1).getByRole("button", { name: "Restore version 1" }).click();

    // Requirement 3: plainly not a rewind, and names the source version.
    expect(dialogMessage).toMatch(/does not rewind/i);
    expect(dialogMessage).toMatch(/brand-new version/i);
    expect(dialogMessage).toContain("version 1");

    await expect(versionRow(page, 3)).toBeVisible();
    await expect(versionRow(page, 3)).toContainText("Current");
    await expect(versionRow(page, 3)).toContainText("restored from v1");
    await expect(versionRow(page, 2)).not.toContainText("Current");
    await expect(versionRow(page, 1)).not.toContainText("Current");
  });

  test("deletes a non-current version and leaves the numbering gap", async ({ page }) => {
    await signInAs(page, `/admin/documents/${mainSlug}`);

    page.once("dialog", (dialog) => void dialog.accept());
    await versionRow(page, 2).getByRole("button", { name: "Delete version 2" }).click();

    await expect(page.getByRole("button", { name: "Preview version 2" })).toHaveCount(0);
    // Not renumbered: v1 and v3 remain exactly v1 and v3, with the gap
    // where v2 was.
    await expect(versionRow(page, 1)).toBeVisible();
    await expect(versionRow(page, 3)).toBeVisible();
    await expect(versionRow(page, 3)).toContainText("Current");
  });

  test("disables deleting the current version, with a visible, always-on explanation", async ({ page }) => {
    await signInAs(page, `/admin/documents/${mainSlug}`);

    // v3 is current after the tests above.
    const deleteButton = versionRow(page, 3).getByRole("button", { name: "Delete version 3" });
    await expect(deleteButton).toBeDisabled();
    await expect(versionRow(page, 3)).toContainText(/current version.*restore or upload another version first/i);

    // A non-current version's delete control stays enabled.
    await expect(versionRow(page, 1).getByRole("button", { name: "Delete version 1" })).toBeEnabled();
  });

  test("keeps the public Reader on the current version after every version-history operation performed above", async ({
    page,
  }) => {
    await page.goto(`/docs/${mainSlug}`);

    await expect(page.getByText(/No document lives at this address/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Version History ${RUN}`);
    await expect(page.locator("iframe")).toHaveCount(1);
  });

  test("guards the only remaining version and requires typing the slug before deleting the document", async ({
    page,
  }) => {
    await signInAs(page, "/admin");
    const soloSlug = await publishDocument(page, `Version History Solo ${RUN}`);
    await page.goto(`/admin/documents/${soloSlug}`);

    const deleteVersionButton = versionRow(page, 1).getByRole("button", { name: "Delete version 1" });
    await expect(deleteVersionButton).toBeDisabled();
    await expect(versionRow(page, 1)).toContainText(/only version of this document/i);

    const deleteDocButton = page.getByRole("button", { name: "Delete document permanently" });
    await expect(deleteDocButton).toBeDisabled();

    const confirmInput = page.getByLabel(`Type "${soloSlug}" to confirm deletion`);
    await confirmInput.fill("not-the-right-slug");
    await expect(deleteDocButton).toBeDisabled();
    await expect(page.getByText(/must match the slug exactly/i)).toBeVisible();

    await confirmInput.fill(soloSlug);
    await expect(deleteDocButton).toBeEnabled();
    await deleteDocButton.click();

    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test("version history controls are usable at 375, 768 and 1440 with no horizontal overflow", async ({ page }) => {
    await signInAs(page, "/admin");
    const slug = await publishDocument(page, `Version History Viewport ${RUN}`);
    await page.goto(`/admin/documents/${slug}`);

    for (const size of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(size);
      await expect(page.getByRole("button", { name: "Preview version 1" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Restore version 1" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete version 1" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete document permanently" })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    }
  });
});
