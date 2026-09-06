// Node G2.5 — Admin category tree and document metadata, in a real browser.
//
// Every category/tag name created here carries a RUN suffix so this spec
// can share the local D1 database with whatever else is running against
// the same dev server without colliding on names or asserting exact
// counts of the full list (SPEC.md §26; IMPLEMENTATION_PLAN.md §9 notes
// G2.5 and G2.6 run in parallel on the same branch).
//
// Serial within this file: the local D1 file is one SQLite database, and
// this suite issues many sequential admin mutations per test — running
// them fully parallel starves the shared dev server rather than testing
// anything meaningfully different.
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./admin-session";

const PASSWORD = "local-dev-password-not-a-real-secret";
const RUN = Date.now().toString(36);
const SEEDED_SLUG = "expectations-investing";
// A document seeded solely for the metadata-edit test below. That test
// mutates title, description, tags AND category, so it must not touch the
// shared `expectations-investing` fixture that reader.spec.ts,
// public-browse.spec.ts and the PWA specs all read and assert on.
const EDITABLE_SLUG = "admin-editable-document";

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The category tree renders the SAME name both as a row's <p
 * data-testid="category-name"> AND, whenever a "Move" form happens to be
 * open anywhere on the page, as plain text inside a <select><option> — a
 * bare getByText(name, {exact:true}) can resolve to either and fail
 * strict mode. Scoping to the testid and anchoring the regex keeps this
 * to exactly the tree row.
 */
function categoryRow(page: Page, name: string) {
  return page.getByTestId("category-name").filter({ hasText: new RegExp(`^${escapeForRegExp(name)}$`) });
}

// Signs in over the API rather than through the login form: node G1.6
// rate-limits login to 10 attempts per minute per IP, and these specs would
// otherwise blow that budget between them. The login SCREEN itself stays
// covered by admin-upload.spec.ts, which still drives the real form.
async function signInAt(page: Page, path: string) {
  await signInAs(page, path);
}

test.describe("Admin categories", () => {
  test.describe.configure({ mode: "serial" });

  test("creates a nested category from the UI and files a document into it", async ({ page }) => {
    await signInAt(page, "/admin/categories");
    await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();

    const rootName = `Root ${RUN}`;
    const childName = `Child ${RUN}`;

    await page.getByRole("textbox", { name: "New top-level category" }).fill(rootName);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(categoryRow(page, rootName)).toBeVisible();

    await page.getByRole("button", { name: `Add a subcategory under "${rootName}"` }).click();
    await page.getByRole("textbox", { name: `New subcategory name under "${rootName}"` }).fill(childName);
    await page.getByRole("button", { name: `Confirm new subcategory under "${rootName}"` }).click();
    await expect(categoryRow(page, childName)).toBeVisible();

    // File the seeded document into the brand-new subcategory.
    await page.goto(`/admin/documents/${SEEDED_SLUG}`);
    await expect(page.locator("code")).toHaveText(SEEDED_SLUG);
    await page.getByRole("combobox", { name: "Category" }).selectOption({ label: childName });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/slug and public URL did not change/i)).toBeVisible();

    // The category now reports one document filed in it. A fresh
    // navigation to /admin/categories is a new mount of the page, so the
    // root's expansion (Requirement 3 covers persistence WITHIN a screen,
    // not across leaving it) has to be reopened here.
    await page.goto("/admin/categories");
    await page.getByRole("button", { name: `Expand "${rootName}"` }).click();
    const childMeta = categoryRow(page, childName).locator("xpath=following-sibling::p[1]");
    await expect(childMeta).toContainText("1 document");
  });

  test("renames and moves a category", async ({ page }) => {
    await signInAt(page, "/admin/categories");
    const original = `Rename Me ${RUN}`;
    const renamed = `Renamed ${RUN}`;
    const target = `Target Home ${RUN}`;

    await page.getByRole("textbox", { name: "New top-level category" }).fill(original);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(categoryRow(page, original)).toBeVisible();

    await page.getByRole("textbox", { name: "New top-level category" }).fill(target);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(categoryRow(page, target)).toBeVisible();

    await page.getByRole("button", { name: `Rename "${original}"` }).click();
    await page.getByRole("textbox", { name: `New name for "${original}"` }).fill(renamed);
    await page.getByRole("button", { name: `Save new name for "${original}"` }).click();
    await expect(categoryRow(page, renamed)).toBeVisible();
    await expect(categoryRow(page, original)).toHaveCount(0);

    await page.getByRole("button", { name: `Move "${renamed}"` }).click();
    await page.getByRole("combobox", { name: `Move "${renamed}" under` }).selectOption({ label: target });
    await page.getByRole("button", { name: `Confirm move of "${renamed}"` }).click();

    await page.getByRole("button", { name: `Expand "${target}"` }).click();
    const targetMeta = categoryRow(page, target).locator("xpath=following-sibling::p[1]");
    await expect(targetMeta).toContainText(/1 subcategory/);
    await expect(categoryRow(page, renamed)).toBeVisible();
  });

  test("edits a document's title, description, tags and category", async ({ page }) => {
    await signInAt(page, `/admin/documents/${EDITABLE_SLUG}`);
    await expect(page.locator("code")).toHaveText(EDITABLE_SLUG);

    const category = `Editing Home ${RUN}`;
    await page.goto("/admin/categories");
    await page.getByRole("textbox", { name: "New top-level category" }).fill(category);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(categoryRow(page, category)).toBeVisible();

    await page.goto(`/admin/documents/${EDITABLE_SLUG}`);
    const newTitle = `Admin Editable Document — edited ${RUN}`;
    await page.getByRole("textbox", { name: "Title" }).fill(newTitle);
    await page.getByRole("textbox", { name: "Description" }).fill(`Edited by the G2.5 browser spec, run ${RUN}.`);
    await page.getByRole("textbox", { name: "Tags (comma separated)" }).fill(`edited, run-${RUN}`);
    await page.getByRole("combobox", { name: "Category" }).selectOption({ label: category });

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/slug and public URL did not change/i)).toBeVisible();
    // Slug never moves, even after every other field changed.
    await expect(page.locator("code")).toHaveText(EDITABLE_SLUG);

    // Refetch (this screen always reloads after a save — Requirement 6)
    // shows the saved values, not an optimistic guess.
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(newTitle);
    await expect(page.getByRole("combobox", { name: "Category" }).locator("option:checked")).toHaveText(category);

    // Regression, verified end to end in the browser: the public URL for
    // this slug still resolves, now showing the edited title.
    await page.goto(`/docs/${EDITABLE_SLUG}`);
    await expect(page.getByRole("heading", { name: newTitle })).toBeVisible();
  });

  test("moving a category into its own descendant shows the guard and leaves the tree unchanged", async ({ page }) => {
    await signInAt(page, "/admin/categories");
    const parent = `Cycle Parent ${RUN}`;
    const child = `Cycle Child ${RUN}`;

    await page.getByRole("textbox", { name: "New top-level category" }).fill(parent);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(categoryRow(page, parent)).toBeVisible();

    await page.getByRole("button", { name: `Add a subcategory under "${parent}"` }).click();
    await page.getByRole("textbox", { name: `New subcategory name under "${parent}"` }).fill(child);
    await page.getByRole("button", { name: `Confirm new subcategory under "${parent}"` }).click();
    await expect(categoryRow(page, child)).toBeVisible();

    await page.getByRole("button", { name: `Move "${parent}"` }).click();
    await page.getByRole("combobox", { name: `Move "${parent}" under` }).selectOption({ label: child });
    await page.getByRole("button", { name: `Confirm move of "${parent}"` }).click();

    await expect(page.getByRole("alert").filter({ hasText: /subtree|own parent/i })).toBeVisible();
    // The tree is untouched: parent is still a root and child is still under it.
    await expect(categoryRow(page, parent)).toBeVisible();
    await expect(categoryRow(page, child)).toBeVisible();
  });

  test("deleting a non-empty category names what is still inside", async ({ page }) => {
    await signInAt(page, "/admin/categories");
    const parent = `NonEmpty ${RUN}`;
    const child = `Inside ${RUN}`;

    await page.getByRole("textbox", { name: "New top-level category" }).fill(parent);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(categoryRow(page, parent)).toBeVisible();

    await page.getByRole("button", { name: `Add a subcategory under "${parent}"` }).click();
    await page.getByRole("textbox", { name: `New subcategory name under "${parent}"` }).fill(child);
    await page.getByRole("button", { name: `Confirm new subcategory under "${parent}"` }).click();
    await expect(categoryRow(page, child)).toBeVisible();

    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("button", { name: `Delete "${parent}"` }).click();

    const banner = page.getByRole("alert").filter({ hasText: parent });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/subcategor/i);
    // Not actually deleted.
    await expect(categoryRow(page, parent)).toBeVisible();
  });

  test("no destructive category action proceeds without confirmation", async ({ page }) => {
    await signInAt(page, "/admin/categories");
    const name = `Dismissible ${RUN}`;

    await page.getByRole("textbox", { name: "New top-level category" }).fill(name);
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(categoryRow(page, name)).toBeVisible();

    page.once("dialog", (dialog) => {
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: `Delete "${name}"` }).click();

    await expect(categoryRow(page, name)).toBeVisible();
  });

  test("session expiry mid-operation returns to login, then back to the same screen", async ({ page }) => {
    await signInAt(page, "/admin/categories");
    await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();

    await page.evaluate(() => window.sessionStorage.setItem("alexandria.admin.token", "tampered-not-a-real-token"));
    await page.getByRole("textbox", { name: "New top-level category" }).fill(`expired-${RUN}`);
    await page.getByRole("button", { name: "Add category" }).click();

    await expect(page.getByLabel("Admin password")).toBeVisible();
    expect(page.url()).toContain("/admin/categories");

    await page.getByLabel("Admin password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  });

  test("a ten-level-deep category tree is navigable at 375px with no horizontal overflow", async ({ page }) => {
    await signInAt(page, "/admin/categories");

    let previousName = "";
    for (let depth = 1; depth <= 10; depth += 1) {
      const name = `L${depth}-${RUN}`;
      if (depth === 1) {
        await page.getByRole("textbox", { name: "New top-level category" }).fill(name);
        await page.getByRole("button", { name: "Add category" }).click();
      } else {
        await page.getByRole("button", { name: `Add a subcategory under "${previousName}"` }).click();
        await page.getByRole("textbox", { name: `New subcategory name under "${previousName}"` }).fill(name);
        await page.getByRole("button", { name: `Confirm new subcategory under "${previousName}"` }).click();
      }
      await expect(categoryRow(page, name)).toBeVisible();
      previousName = name;
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(categoryRow(page, previousName)).toBeVisible();
    // The deepest row's action is still reachable with no hover.
    await expect(page.getByRole("button", { name: `Delete "${previousName}"` })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
