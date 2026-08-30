// Node G1.11 — Admin login, upload, review and publish, in a real browser.
//
// The security assertions here are the point: the session token must live
// in sessionStorage and nowhere else, and the file must cross the network
// exactly once.
import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../mauboussin-expectations-investing-summary.html");
const PASSWORD = "local-dev-password-not-a-real-secret";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/admin");
  await page.getByLabel("Admin password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("HTML file")).toBeVisible();
}

test.describe("Admin", () => {
  test("rejects a wrong password and stores no token", async ({ page }) => {
    await page.goto("/admin");
    await page.getByLabel("Admin password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    const stored = await page.evaluate(() => window.sessionStorage.length);
    expect(stored).toBe(0);
  });

  test("keeps the session token out of cookies, localStorage and every URL", async ({ page }) => {
    await signIn(page);

    const surfaces = await page.evaluate(() => ({
      cookie: document.cookie,
      local: window.localStorage.length,
      session: window.sessionStorage.length,
      url: window.location.href,
    }));

    expect(surfaces.cookie).toBe("");
    expect(surfaces.local).toBe(0);
    expect(surfaces.session).toBe(1);
    expect(surfaces.url).not.toMatch(/token|bearer/i);

    const cookies = await page.context().cookies();
    expect(cookies).toEqual([]);
  });

  test("previews metadata locally, then publishes with a single upload", async ({ page }) => {
    await signIn(page);

    // Count only requests that actually carry the file body.
    let uploadRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/admin/documents")) {
        uploadRequests += 1;
      }
    });

    await page.getByLabel("HTML file").setInputFiles(FIXTURE);

    // The preview is produced in the browser, before anything is uploaded.
    await expect(page.getByLabel("Title")).toHaveValue(/Expectations Investing/);
    expect(uploadRequests).toBe(0);

    await page.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByText(/This URL is permanent/i)).toBeVisible({ timeout: 15000 });
    expect(uploadRequests).toBe(1);

    const link = page.getByRole("link", { name: "Open in the Reader" });
    await expect(link).toBeVisible();
  });

  test("marks a field as edited when the operator overrides it", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("HTML file").setInputFiles(FIXTURE);

    await expect(page.getByText("read from the file").first()).toBeVisible();
    await page.getByLabel("Title").fill("An Operator Chosen Title");
    await expect(page.getByText("edited").first()).toBeVisible();
  });

  test("blocks a non-.html file before any upload", async ({ page }, testInfo) => {
    await signIn(page);

    let uploadRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/admin/documents")) {
        uploadRequests += 1;
      }
    });

    const notHtml = testInfo.outputPath("notes.txt");
    await page.getByLabel("HTML file").setInputFiles({
      name: path.basename(notHtml),
      mimeType: "text/plain",
      buffer: Buffer.from("not html at all"),
    });

    await expect(page.getByRole("alert")).toContainText(/Only \.html files/i);
    expect(uploadRequests).toBe(0);
  });

  test("is usable at 375px with no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
