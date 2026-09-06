// Node G2.5 — Admin tag management, in a real browser.
//
// Names carry a RUN suffix so this spec never collides with tags any
// other concurrently-running suite creates against the same local D1
// (IMPLEMENTATION_PLAN.md §9: G2.5 and G2.6 run in parallel). Serial
// within this file for the same reason as admin-categories.spec.ts: one
// shared SQLite-backed D1 file, many sequential admin mutations per test.
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./admin-session";

const RUN = Date.now().toString(36);

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Same collision as CategoryTree's rows: a tag's name renders both as a
 * <p data-testid="tag-name"> and, whenever a merge <select> is open
 * anywhere on the page, as an <option> too. Scope to the testid.
 */
function tagRow(page: Page, name: string) {
  return page.getByTestId("tag-name").filter({ hasText: new RegExp(`^${escapeForRegExp(name)}$`) });
}

// Signs in over the API rather than through the login form: node G1.6
// rate-limits login to 10 attempts per minute per IP, and these specs would
// otherwise blow that budget between them. The login SCREEN itself stays
// covered by admin-upload.spec.ts, which still drives the real form.
async function signInAt(page: Page, path: string) {
  await signInAs(page, path);
}

async function createTag(page: Page, name: string) {
  await page.getByRole("textbox", { name: "New tag" }).fill(name);
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(tagRow(page, name)).toBeVisible();
}

test.describe("Admin tags", () => {
  test.describe.configure({ mode: "serial" });

  test("creates, renames and merges tags from the UI", async ({ page }) => {
    await signInAt(page, "/admin/tags");
    await expect(page.getByRole("heading", { name: "Tags" })).toBeVisible();

    const a = `tag-a-${RUN}`;
    const b = `tag-b-${RUN}`;
    const renamedA = `tag-a-renamed-${RUN}`;

    await createTag(page, a);
    await createTag(page, b);

    await page.getByRole("button", { name: `Rename tag "${a}"` }).click();
    await page.getByRole("textbox", { name: `New name for tag "${a}"` }).fill(renamedA);
    await page.getByRole("button", { name: `Save new name for tag "${a}"` }).click();
    await expect(tagRow(page, renamedA)).toBeVisible();
    await expect(tagRow(page, a)).toHaveCount(0);

    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("button", { name: `Merge tag "${renamedA}" into another tag` }).click();
    await page.getByRole("combobox", { name: `Merge "${renamedA}" into` }).selectOption({ label: `${b} (0)` });
    await page.getByRole("button", { name: `Confirm merge of tag "${renamedA}"` }).click();

    await expect(tagRow(page, renamedA)).toHaveCount(0);
    await expect(tagRow(page, b)).toBeVisible();
  });

  test("merge confirmation names both tags and the affected document count before committing", async ({ page }) => {
    await signInAt(page, "/admin/tags");
    const source = `tag-src-${RUN}`;
    const target = `tag-dst-${RUN}`;

    await createTag(page, source);
    await createTag(page, target);

    let dialogMessage = "";
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: `Merge tag "${source}" into another tag` }).click();
    await page.getByRole("combobox", { name: `Merge "${source}" into` }).selectOption({ label: `${target} (0)` });
    await page.getByRole("button", { name: `Confirm merge of tag "${source}"` }).click();

    expect(dialogMessage).toContain(source);
    expect(dialogMessage).toContain(target);
    expect(dialogMessage).toMatch(/0 document/);

    // Dismissed, so nothing actually merged.
    await expect(tagRow(page, source)).toBeVisible();
    await expect(tagRow(page, target)).toBeVisible();
  });

  test("renaming a tag into an existing name explains the conflict and offers merge instead", async ({ page }) => {
    await signInAt(page, "/admin/tags");
    const x = `tag-x-${RUN}`;
    const y = `tag-y-${RUN}`;

    await createTag(page, x);
    await createTag(page, y);

    await page.getByRole("button", { name: `Rename tag "${x}"` }).click();
    await page.getByRole("textbox", { name: `New name for tag "${x}"` }).fill(y);
    await page.getByRole("button", { name: `Save new name for tag "${x}"` }).click();

    await expect(page.getByRole("alert").filter({ hasText: /already has that name/i })).toBeVisible();
    await expect(page.getByRole("button", { name: `Merge "${x}" into "${y}" instead` })).toBeVisible();
    // Nothing renamed — both tags still present under their own names.
    await expect(tagRow(page, x)).toBeVisible();
    await expect(tagRow(page, y)).toBeVisible();
  });

  test("a tag's merge control never offers itself as the destination", async ({ page }) => {
    await signInAt(page, "/admin/tags");
    const z = `tag-z-${RUN}`;
    await createTag(page, z);

    await page.getByRole("button", { name: `Merge tag "${z}" into another tag` }).click();
    const optionLabels = await page
      .getByRole("combobox", { name: `Merge "${z}" into` })
      .locator("option")
      .allTextContents();
    expect(optionLabels.some((label) => label.startsWith(`${z} (`))).toBe(false);
  });

  test("no destructive tag action proceeds without confirmation", async ({ page }) => {
    await signInAt(page, "/admin/tags");
    const name = `tag-dismiss-${RUN}`;
    await createTag(page, name);

    page.once("dialog", (dialog) => {
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: `Delete tag "${name}"` }).click();

    await expect(tagRow(page, name)).toBeVisible();
  });

  test("deletes a tag after confirmation, reporting how many documents it comes off of", async ({ page }) => {
    await signInAt(page, "/admin/tags");
    const name = `tag-delete-${RUN}`;
    await createTag(page, name);

    let dialogMessage = "";
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });
    await page.getByRole("button", { name: `Delete tag "${name}"` }).click();

    expect(dialogMessage).toContain(name);
    await expect(tagRow(page, name)).toHaveCount(0);
  });

  test("tag actions are usable at 375px with no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAt(page, "/admin/tags");
    const name = `tag-mobile-${RUN}`;
    await createTag(page, name);

    await expect(page.getByRole("button", { name: `Delete tag "${name}"` })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
