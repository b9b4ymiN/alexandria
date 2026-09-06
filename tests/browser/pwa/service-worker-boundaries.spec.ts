// Node G2.7 — PWA & Offline Shell Hardening.
//
// public/sw.js is on production-bound code and sits between every reader
// and the app. It is correct by inspection only: it declines `/api/*`,
// declines cross-origin requests (which is what keeps the content origin
// out of the cache), and declines anything carrying an `Authorization`
// header. These tests prove those three exclusions by driving a real
// browser and inspecting the Cache Storage API, rather than trusting the
// source. They do not change the worker's caching strategy — see
// IMPLEMENTATION_PLAN.md Node G2.7 and AGENT.md §8 / §25.
import { expect, test } from "@playwright/test";

const SEEDED_SLUG = "expectations-investing";
const CONTENT_ORIGIN_HOST = "alexandria-content.vcp-scanner.workers.dev";
const CURRENT_CACHE_NAME = "alexandria-public-shell-v2";
const STALE_CACHE_NAME = "alexandria-public-shell-v1";

/** Every URL cached under every `alexandria-public-shell-*` cache, flattened. */
async function allCachedUrls(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      urls.push(...requests.map((request) => request.url));
    }
    return urls;
  });
}

async function waitForActiveController(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test.describe("service worker boundaries", () => {
  test("never places an /api/* response in any cache", async ({ page }) => {
    await page.goto("/docs/" + SEEDED_SLUG);
    await waitForActiveController(page);

    // The reader loads document metadata from /api/public/documents/*, and
    // the library page (visited via the header link) loads /api/public/*
    // too, so both request shapes have had a chance to be cached if the
    // worker ever weakened its exclusion.
    await page.getByRole("link", { name: "← Library" }).click();
    await page.waitForLoadState("networkidle");

    const cachedUrls = await allCachedUrls(page);
    for (const url of cachedUrls) {
      expect(new URL(url).pathname.startsWith("/api/")).toBe(false);
    }
  });

  test("rejects an /api/* URL even when explicitly offered to the worker's own caching message", async ({ page }) => {
    // The natural page-load flow only offers the worker whatever resource
    // URLs happened to load before navigator.serviceWorker.ready resolved
    // (see src/app/lib/pwa.ts), which is a race that can leave a real /api/
    // fetch out of the message by pure timing. That race must not be the
    // thing standing between an /api/ response and the cache — the worker's
    // own CACHE_PUBLIC_ASSETS handler has to reject it regardless of what
    // it is offered. This drives that handler directly and deterministically.
    await page.goto("/");
    await waitForActiveController(page);

    const apiUrl = "/api/public/documents/" + SEEDED_SLUG;
    await page.evaluate((url) => {
      navigator.serviceWorker.controller?.postMessage({ type: "CACHE_PUBLIC_ASSETS", urls: [url] });
    }, apiUrl);
    // cacheLoadedPublicAssets awaits a fetch per URL; give it a moment to run.
    await page.waitForTimeout(300);

    const cachedUrls = await allCachedUrls(page);
    expect(cachedUrls.some((url) => url.includes("/api/"))).toBe(false);
  });

  test("never caches a content-origin URL, and the Reader iframe still loads from it", async ({ page }) => {
    const contentResponses: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).host === CONTENT_ORIGIN_HOST) {
        contentResponses.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto("/docs/" + SEEDED_SLUG);
    await waitForActiveController(page);

    // The frame still points at, and successfully loads from, the content
    // origin with the worker registered and active.
    const src = await page.locator("iframe").getAttribute("src");
    expect(src).toBeTruthy();
    expect(new URL(src as string).host).toBe(CONTENT_ORIGIN_HOST);
    await expect
      .poll(() => contentResponses.some((r) => r.url === src && r.status === 200))
      .toBe(true);

    // And nothing from that origin was ever written into the same-origin
    // cache the worker maintains.
    const cachedUrls = await allCachedUrls(page);
    for (const url of cachedUrls) {
      expect(new URL(url).host).not.toBe(CONTENT_ORIGIN_HOST);
    }
  });

  test("rejects a content-origin URL even when explicitly offered to the worker's own caching message", async ({ page }) => {
    // Same reasoning as the /api/* case above: this offers the URL
    // directly, so the assertion holds regardless of whether the natural
    // page-load flow happened to observe it before the opportunistic
    // message fired. (In practice the content origin sends no CORS
    // headers either, so a cross-origin fetch from the worker would fail
    // before reaching cache.put — but that is an incidental property of
    // deployment configuration, not a guarantee this test should rely on.)
    await page.goto("/");
    await waitForActiveController(page);

    const contentUrl = "https://" + CONTENT_ORIGIN_HOST + "/d/" + SEEDED_SLUG;
    await page.evaluate((url) => {
      navigator.serviceWorker.controller?.postMessage({ type: "CACHE_PUBLIC_ASSETS", urls: [url] });
    }, contentUrl);
    await page.waitForTimeout(300);

    const cachedUrls = await allCachedUrls(page);
    expect(cachedUrls.some((url) => new URL(url).host === CONTENT_ORIGIN_HOST)).toBe(false);
  });

  test("a request carrying an Authorization header is never served from cache", async ({ page }) => {
    await page.goto("/");
    await waitForActiveController(page);

    // /manifest.webmanifest is part of the precached static shell, so its
    // path is normally cacheable. Fetching a variant of it with an
    // Authorization header must bypass the worker entirely rather than be
    // written to (or read from) the cache — that is the guarantee that
    // keeps an admin response from ever being served stale to a reader.
    const authedUrl = "/manifest.webmanifest?authtest=1";
    await page.evaluate(
      async (url) => {
        await fetch(url, { headers: { Authorization: "Bearer test-token-not-real" } });
      },
      authedUrl,
    );

    const cachedUrls = await allCachedUrls(page);
    expect(cachedUrls.some((url) => url.endsWith(authedUrl))).toBe(false);
  });

  test("the Reader renders with the worker registered and activated, not only on a cold load", async ({ page }) => {
    await page.goto("/docs/" + SEEDED_SLUG);
    await waitForActiveController(page);

    // Navigate away and back by URL, as a reader would on a repeat visit,
    // fully under an activated worker (not the install-time first load).
    await page.goto("/");
    await page.goto("/docs/" + SEEDED_SLUG);

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Expectations Investing/i);
    await expect(page.locator("iframe")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  });

  test("deletes a stale cache version at activate time (redeploy path)", async ({ page }) => {
    await page.goto("/");

    // Start from a clean slate: no registration, no caches. This isolates
    // the activate handler's own behaviour from whatever the earlier tests
    // in this file left behind.
    await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    });

    // Simulate a reader stranded on an old deploy: a cache under the
    // previous version's name, left over from before the redeploy.
    await page.evaluate(async (staleName) => {
      const stale = await caches.open(staleName);
      await stale.put("/stale-shell-entry", new Response("stale"));
    }, STALE_CACHE_NAME);

    // Reloading re-registers the worker (main.tsx calls
    // registerOfflineReadingWorker unconditionally), driving it through
    // install and activate.
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);

    await expect.poll(() => page.evaluate(() => caches.keys())).toContain(CURRENT_CACHE_NAME);
    const namesAfterActivate = await page.evaluate(() => caches.keys());
    expect(namesAfterActivate).not.toContain(STALE_CACHE_NAME);
  });
});

test.describe("offline navigation", () => {
  test("an offline navigation to an unvisited route falls back to the cached shell", async ({ page, context }) => {
    await page.goto("/");
    await waitForActiveController(page);

    await context.setOffline(true);
    await page.goto("/docs/" + SEEDED_SLUG);
    // The worker's navigate handler falls back to the cached "/" shell on a
    // fetch failure; it does not (and cannot, offline) fake a document
    // response, so the client-side router takes over from the shell once
    // scripts execute.
    await expect(page.getByRole("heading", { name: "Alexandria", level: 1 }).or(page.getByRole("heading", { level: 1 }))).toBeVisible();
    await context.setOffline(false);
  });

  test("an /api/* request made while offline fails normally instead of being served from cache", async ({ page, context }) => {
    await page.goto("/");
    await waitForActiveController(page);

    await context.setOffline(true);
    const failed = await page.evaluate(async () => {
      try {
        await fetch("/api/public/documents");
        return false;
      } catch {
        return true;
      }
    });
    expect(failed).toBe(true);
    await context.setOffline(false);
  });
});
