// Node G2.6 — public category browsing and tag filtering, in a real
// browser. Runs against `pnpm dev` with the local D1 seeded by
// tests/browser/seed-local.sql, which node G2.6 extended with a
// four-level category branch (Markets > Equities > Southeast Asia >
// Thailand), an empty "Archive" category, and two tagged documents.
import { expect, test } from "@playwright/test";

test.describe("Public category browsing", () => {
  test("shows the subtree listing for a category with no direct documents of its own", async ({ page }) => {
    // "Markets" itself has zero direct documents — only its descendants
    // do — so this also proves the subtree default rather than an empty
    // page (edge case).
    await page.goto("/category/markets-seed");

    await expect(page.getByRole("heading", { name: "Markets", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Thailand Market Outlook/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Equities Primer/i }).first()).toBeVisible();
  });

  test("moves up correctly via breadcrumb navigation", async ({ page }) => {
    // Deep-linking straight to a four-level path with no prior visit to
    // the Library also covers "direct navigation to a filtered URL
    // renders correctly without first visiting the Library".
    await page.goto("/category/markets-seed/equities-seed/southeast-asia-seed/thailand-seed");
    // exact: true — otherwise this also matches the "Thailand Market
    // Outlook" document card's own heading, which contains "Thailand" too.
    await expect(page.getByRole("heading", { name: "Thailand", level: 2, exact: true })).toBeVisible();

    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Equities" }).click();

    await expect(page).toHaveURL(/\/category\/markets-seed\/equities-seed$/);
    // exact: true — the "Equities Primer" document card's own heading also
    // contains "Equities" and is visible on this same subtree listing.
    await expect(page.getByRole("heading", { name: "Equities", level: 2, exact: true })).toBeVisible();
  });

  test("truncates the breadcrumb from the middle at 375px, keeping root and current level", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/category/markets-seed/equities-seed/southeast-asia-seed/thailand-seed");

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByRole("link", { name: "Library" })).toBeVisible();
    await expect(breadcrumb.getByRole("link", { name: "Thailand" })).toBeVisible();
    await expect(breadcrumb.getByRole("link", { name: "Equities" })).toBeHidden();
    await expect(breadcrumb.getByRole("link", { name: "Southeast Asia" })).toBeHidden();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("renders a not-found state for an unknown category path with a route back to the Library", async ({ page }) => {
    await page.goto("/category/does-not-exist");

    await expect(page.getByTestId("category-not-found")).toBeVisible();
    await expect(page.getByText("No such category.")).toBeVisible();

    await page.getByRole("link", { name: /Back to the Library/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("renders an explanatory empty state for an empty category, not an error", async ({ page }) => {
    await page.goto("/category/archive-seed");

    await expect(page.getByRole("heading", { name: "Archive", level: 2 })).toBeVisible();
    await expect(page.getByTestId("category-empty")).toHaveText("Nothing is published in this category yet.");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("performs no per-card and no per-tag request while browsing a category", async ({ page }) => {
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/public/")) apiRequests.push(request.url());
    });

    await page.goto("/category/markets-seed");
    await expect(page.getByRole("heading", { name: "Markets", level: 2 })).toBeVisible();

    // <= 2, not exactly 1: React StrictMode double-invokes effects on
    // mount in dev, so one *logical* fetch can legitimately produce two
    // requests here. What requirement 7 actually rules out is a request
    // PER NODE — with a five-category tree that would be far more than 2.
    const categoryCalls = apiRequests.filter((url) => url.includes("/api/public/categories"));
    expect(categoryCalls.length).toBeLessThanOrEqual(2);
  });

  test("never downloads admin code while browsing a category", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await page.goto("/category/markets-seed");
    await expect(page.getByRole("heading", { name: "Markets", level: 2 })).toBeVisible();

    expect(requested.filter((url) => /admin/i.test(url))).toEqual([]);
  });
});

test.describe("Public tag filtering", () => {
  test("a tag chip navigates to a filtered listing", async ({ page }) => {
    await page.goto("/category/markets-seed");

    await page.getByRole("link", { name: "valuation" }).first().click();

    await expect(page).toHaveURL(/\/\?tag=valuation$/);
    await expect(page.getByRole("heading", { name: "Tagged “valuation”", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Thailand Market Outlook/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Equities Primer/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Expectations Investing/i })).toHaveCount(0);
  });

  test("renders a deep link to a tag-filtered URL directly, without visiting the Library first", async ({ page }) => {
    await page.goto("/?tag=thailand");

    await expect(page.getByRole("heading", { name: "Tagged “thailand”", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Thailand Market Outlook/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Equities Primer/i })).toHaveCount(0);
  });

  test("shows an empty state, not an error, for a tag with no documents", async ({ page }) => {
    await page.goto("/?tag=no-such-tag-exists");

    await expect(page.getByText("No documents carry this tag.")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("tag chips are keyboard reachable", async ({ page }) => {
    await page.goto("/?tag=thailand");

    // `exact: true` matters here: the CategorySidebar also has a category
    // named "Thailand", and role-name matching is case-insensitive by
    // default, so a loose match picks up that link instead of the chip.
    // Wait for the filtered listing to actually render before focusing.
    // The chips are React-rendered from a client-side fetch, so focusing
    // before that resolves puts focus on a node the next render replaces —
    // the assertion below then sees `inactive` and the test fails for a
    // reason that has nothing to do with keyboard reachability.
    await expect(page.getByRole("heading", { name: "Thailand Market Outlook" })).toBeVisible();

    const chip = page.getByRole("link", { name: "thailand", exact: true }).first();
    await chip.focus();
    await expect(chip).toBeFocused();
    await expect(chip).toHaveAttribute("href", "/?tag=thailand");
  });
});

test.describe("Reader regression after tag chips", () => {
  const SEEDED_SLUG = "expectations-investing";
  const TAGGED_SLUG = "thailand-market-outlook";

  test("still renders the original fixture and keeps its sandbox contract untouched", async ({ page }) => {
    await page.goto(`/docs/${SEEDED_SLUG}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Expectations Investing/i);
    await expect(page.locator("iframe")).toHaveCount(1);

    const sandbox = await page.locator("iframe").getAttribute("sandbox");
    expect(sandbox).toBe("allow-scripts allow-popups allow-downloads");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  test("shows tag chips on a tagged document's header, linking to a filtered listing", async ({ page }) => {
    await page.goto(`/docs/${TAGGED_SLUG}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Thailand Market Outlook/i);

    const chip = page.getByRole("link", { name: "valuation" });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("href", "/?tag=valuation");

    const sandbox = await page.locator("iframe").getAttribute("sandbox");
    expect(sandbox).toBe("allow-scripts allow-popups allow-downloads");
  });
});
