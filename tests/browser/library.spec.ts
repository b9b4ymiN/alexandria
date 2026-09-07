// Node G1.10 — public Library, in a real browser.
//
// These specs run against `pnpm dev` (the Cloudflare Vite plugin serving
// the SPA and the app Worker together) with the local D1 seeded by
// tests/browser/seed-local.mjs.
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

test.describe("Library", () => {
  test("lists the seeded document and links to its Reader", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Alexandria", level: 1 })).toBeVisible();
    const link = page.getByRole("link", { name: /Expectations Investing/i }).first();
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(/\/docs\//);
  });

  test("reads without any sign-in", async ({ page }) => {
    // No credential is set anywhere in this context; the library must still
    // answer. Public read is the product's core promise (GOAL.md §8).
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Alexandria", level: 1 })).toBeVisible();

    const storage = await page.evaluate(() => ({
      session: window.sessionStorage.length,
      local: window.localStorage.length,
    }));
    expect(storage.session).toBe(0);
    expect(storage.local).toBe(0);
  });

  test("never downloads admin code while browsing", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Alexandria", level: 1 })).toBeVisible();

    expect(requested.filter((url) => /admin/i.test(url))).toEqual([]);
  });

  test("filters the library from its public search field", async ({ page }) => {
    await page.goto("/");

    const search = page.getByRole("searchbox", { name: "Search the library" });
    await expect(search).toBeVisible();
    await search.fill("no matching document title");

    await expect(page.getByText("No documents match this search.")).toBeVisible();
  });

  test("does not strand a search on its loading state after a whitespace-only edit", async ({ page }) => {
    await page.goto("/");

    const search = page.getByRole("searchbox", { name: "Search the library" });
    await search.fill("no matching document title");
    await expect(page.getByText("No documents match this search.")).toBeVisible();
    await search.fill("no matching document title ");

    await expect(page.getByText("No documents match this search.")).toBeVisible();
  });

  test("keeps reading available when category routes cannot load", async ({ page }) => {
    await page.route("**/api/public/categories", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
    await page.goto("/");

    await expect(page.getByRole("link", { name: /Expectations Investing/i }).first()).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Routes are temporarily unavailable.");
  });

  test("exposes the manifest and registers the offline reading worker", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration()) !== undefined))
      .toBe(true);
  });

  test("keeps API responses out of the offline shell cache", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    const responseOk = await page.evaluate(async () => (await fetch("/api/public/documents")).ok);
    expect(responseOk).toBe(true);

    const apiWasCached = await page.evaluate(async () => {
      for (const cacheName of await caches.keys()) {
        const cached = await (await caches.open(cacheName)).match("/api/public/documents");
        if (cached !== undefined) return true;
      }
      return false;
    });
    expect(apiWasCached).toBe(false);
  });

  test("keeps a large tag collection compact and searchable", async ({ page }) => {
    const tags = Array.from({ length: 30 }, (_, index) => ({
      id: `tag-${index + 1}`,
      name: `topic-${String(index + 1).padStart(2, "0")}`,
      documentCount: 30 - index,
    }));
    await page.route("**/api/public/tags", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: tags }),
      }),
    );

    await page.goto("/");

    const explorer = page.getByTestId("tag-explorer");
    await expect(explorer.getByRole("link")).toHaveCount(12);

    const filter = explorer.getByRole("searchbox", { name: "Filter topics" });
    await filter.fill("topic-29");
    await expect(explorer.getByRole("link", { name: /topic-29/ })).toBeVisible();
    await expect(explorer.getByRole("link")).toHaveCount(1);
  });

  test("treats the mobile category drawer as a keyboard-contained surface", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const trigger = page.getByRole("button", { name: /Browse categories/ });
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "Category routes" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close categories" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("uses a category route as a category filter", async ({ page }) => {
    // Node G2.6: category selection now navigates to the shareable
    // `/category/*` route (tests/browser/public-browse.spec.ts covers that
    // page's own behaviour in depth) rather than filtering in place.
    await page.goto("/");

    // Disambiguated by href: migration 0002 seeds its own unrelated
    // "Books" category (slug "books"), alongside this spec's own "Books"
    // fixture (slug "books-seed") — both share the display name "Books".
    const categoryFilter = page.getByRole("searchbox", { name: "Filter categories" });
    if (await categoryFilter.isVisible()) await categoryFilter.fill("Books");
    await page.locator('a[href="/category/books-seed"]').click();
    await expect(page).toHaveURL(/\/category\/books-seed$/);
    await expect(page.getByRole("heading", { name: "Books", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Expectations Investing/i }).first()).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`has no horizontal overflow at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Alexandria", level: 1 })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    });
  }
});
