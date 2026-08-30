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
