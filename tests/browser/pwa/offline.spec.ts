import { expect, test } from "@playwright/test";

test("boots the built public library shell offline after its first visit", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Alexandria", level: 1 })).toBeVisible();
  await context.setOffline(false);
});
