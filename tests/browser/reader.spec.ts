// Node G1.10 — Reader Shell, in a real browser.
//
// The assertions that matter most here are the security ones: the frame's
// sandbox attribute and the fact that its src points at a DIFFERENT origin
// from the app. Those are the two halves of the isolation guarantee, and
// they are cheap to regress silently in a refactor.
import { expect, test } from "@playwright/test";

const SEEDED_SLUG = "expectations-investing";

test.describe("Reader", () => {
  test("shows the document header and frames the content", async ({ page }) => {
    await page.goto(`/docs/${SEEDED_SLUG}`);

    await expect(page.getByRole("link", { name: "← Library" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Expectations Investing/i);
    await expect(page.locator("iframe")).toHaveCount(1);
  });

  test("sandboxes the frame and never grants allow-same-origin", async ({ page }) => {
    await page.goto(`/docs/${SEEDED_SLUG}`);

    const sandbox = await page.locator("iframe").getAttribute("sandbox");
    expect(sandbox).toBe("allow-scripts allow-popups allow-downloads");
    expect(sandbox).not.toContain("allow-same-origin");

    const referrerPolicy = await page.locator("iframe").getAttribute("referrerpolicy");
    expect(referrerPolicy).toBe("strict-origin-when-cross-origin");
  });

  test("points the frame at the content origin, not the app origin", async ({ page }) => {
    await page.goto(`/docs/${SEEDED_SLUG}`);

    const src = await page.locator("iframe").getAttribute("src");
    expect(src).toBeTruthy();
    const frameOrigin = new URL(src as string).origin;
    const appOrigin = new URL(page.url()).origin;
    expect(frameOrigin).not.toBe(appOrigin);
  });

  test("never passes a credential to the frame", async ({ page }) => {
    await page.goto(`/docs/${SEEDED_SLUG}`);
    const src = (await page.locator("iframe").getAttribute("src")) ?? "";

    for (const forbidden of ["token", "password", "secret", "key", "authorization"]) {
      expect(src.toLowerCase()).not.toContain(forbidden);
    }
  });

  test("shows a recoverable not-found state for an unknown slug", async ({ page }) => {
    await page.goto("/docs/no-such-document-exists");

    await expect(page.getByText(/No document lives at this address/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to the Library/i })).toBeVisible();
  });

  test("fills the viewport at 375px without overflowing horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/docs/${SEEDED_SLUG}`);
    await expect(page.locator("iframe")).toBeVisible();

    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      frameHeight: document.querySelector("iframe")?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    }));

    expect(metrics.overflow).toBe(false);
    // The frame takes everything the header does not, so the reading area
    // is never squeezed into a fraction of the screen.
    expect(metrics.frameHeight).toBeGreaterThan(metrics.viewportHeight * 0.7);
  });
});
