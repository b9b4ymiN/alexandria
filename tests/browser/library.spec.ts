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

  test("uses a category route as a category filter", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /Books/ }).click();
    await expect(page.getByRole("heading", { name: "Recently updated in Books", level: 2 })).toBeVisible();
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
