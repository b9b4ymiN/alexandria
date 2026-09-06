// Node G4.2 — Library search, pagination and recently updated, in a real
// browser. Runs against `pnpm dev` with the local D1 seeded by
// tests/browser/seed-local.sql (node G1.10's "Expectations Investing" and
// node G2.6's tagged/nested-category fixtures).
//
// Deterministic pagination, deep-link and empty-state scenarios are
// exercised by intercepting `GET /api/public/documents` with `page.route`
// and returning a canned envelope rather than depending on exactly how many
// real documents other specs' seed data happens to contain at the moment
// this file runs — the same technique tests/browser/library.spec.ts already
// uses for its "categories are unavailable" case, and
// tests/browser/admin-categories.spec.ts uses (via `route.continue()` after
// an awaited promise) to make a race deterministic. `q` is matched via
// `URL.searchParams`, which decodes both `%20` and `+` the same way `.fill()`
// produces, so route matching never depends on which encoding the browser
// happened to choose.
import { expect, test, type Route } from "@playwright/test";

interface MockSummary {
  slug: string;
  title: string;
  description: string;
  categoryPath: never[];
  tags: never[];
  updatedAt: string;
}

function mockSummary(slug: string, title: string): MockSummary {
  return { slug, title, description: "", categoryPath: [], tags: [], updatedAt: "2026-09-01T00:00:00.000Z" };
}

async function fulfillListing(
  route: Route,
  data: { items: MockSummary[]; page: number; pageSize: number; total: number; query: string },
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data }),
  });
}

test.describe("Library search box", () => {
  test("typing a query filters results and updates the URL", async ({ page }) => {
    await page.goto("/");

    const search = page.getByRole("searchbox", { name: "Search the library" });
    await search.fill("Expectations Investing");

    await expect(page.getByRole("heading", { name: "Matches for “Expectations Investing”", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Expectations Investing/i }).first()).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("Expectations Investing");
  });

  test("clearing the query returns to the recently updated view without a full reload", async ({ page }) => {
    let loadCount = 0;
    page.on("load", () => {
      loadCount += 1;
    });

    await page.goto("/");
    loadCount = 0; // discount the initial navigation's own load event

    const search = page.getByRole("searchbox", { name: "Search the library" });
    await search.fill("Expectations");
    await expect(page.getByRole("heading", { name: "Matches for “Expectations”", level: 2 })).toBeVisible();

    await page.getByRole("button", { name: "Clear", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Recently updated", level: 2 })).toBeVisible();
    await expect(search).toHaveValue("");
    expect(loadCount).toBe(0);
  });

  test("a Thai query typed with an IME does not fire a request mid-composition", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Recently updated", level: 2 })).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Search the library" });
    await search.click();

    // Playwright has no built-in IME simulator, so the composition sequence
    // real browsers fire — compositionstart, then `input` events while
    // isComposing is true, then compositionend — is dispatched directly on
    // the element. This is what proves the debounce timer in SearchBox.tsx
    // is gated on compositionstart/compositionend rather than on every
    // `input` event. The committed query landing in the URL (proof: a
    // fetch, and the resulting re-render, actually happened) is the
    // observable signal checked below, rather than counting network
    // requests directly — the PWA service worker sits in front of every
    // fetch, so a raw request count is not a reliable proxy for "did the
    // app commit a search".
    await search.evaluate((el: HTMLInputElement) => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      el.value = "ท";
      el.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
      el.value = "ทดสอบ";
      el.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    });

    // Well past the ~250ms debounce window: if a mid-composition `input`
    // event had wrongly scheduled a commit, the URL would already carry it.
    // (A controlled input's displayed value is not asserted here mid-
    // composition: React does not invoke a text input's onChange for an
    // `input` event whose `isComposing` flag is set, so the DOM value this
    // test forces in directly can legitimately be reconciled back to the
    // component's own unchanged state by an unrelated re-render before
    // compositionend — that is a controlled-input characteristic, not
    // something requirement 2 is about.)
    await page.waitForTimeout(400);
    expect(new URL(page.url()).searchParams.get("q")).toBeNull();

    await search.evaluate((el: HTMLInputElement) => {
      el.value = "ทดสอบ";
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "ทดสอบ" }));
    });

    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("ทดสอบ");
    await expect(page.getByRole("heading", { name: "Matches for “ทดสอบ”", level: 2 })).toBeVisible();
  });

  // Added by the orchestrator while reviewing this node. A commit sends the
  // TRIMMED term to the URL, so pausing after a space made the committed
  // value differ from the draft, and the draft resync then deleted the space
  // the reader had just typed — turning "expectations investing" into
  // "expectationsinvesting" for anyone who thinks between two words.
  test("keeps a trailing space in the box when the debounce commits mid-phrase", async ({ page }) => {
    await page.goto("/");

    const search = page.getByRole("searchbox", { name: "Search the library" });
    await search.pressSequentially("expectations ");
    // Longer than the 250ms debounce, so the commit definitely lands while
    // the reader is still mid-phrase.
    await page.waitForTimeout(400);
    await expect(search).toHaveValue("expectations ");

    await search.pressSequentially("investing");
    await expect(search).toHaveValue("expectations investing");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("expectations investing");
  });
});

test.describe("Library URL state", () => {
  test("a deep link to ?q=…&page=3 renders directly with the correct query and page", async ({ page }) => {
    const TERM = "deep-link-term";
    await page.route(
      (url) => url.pathname === "/api/public/documents",
      async (route) => {
        const params = new URL(route.request().url()).searchParams;
        const q = params.get("q") ?? "";
        if (q !== TERM) return route.continue();
        const pageNum = Number(params.get("page") ?? "1");
        await fulfillListing(route, {
          items: [mockSummary(`deep-link-doc-${pageNum}`, `Deep Link Result ${pageNum}`)],
          page: pageNum,
          pageSize: 20,
          total: 45, // 3 pages at pageSize 20 — page 3 is the last one
          query: q,
        });
      },
    );

    await page.goto(`/?q=${TERM}&page=3`);

    await expect(page.getByRole("heading", { name: `Matches for “${TERM}”`, level: 2 })).toBeVisible();
    await expect(page.getByText("Deep Link Result 3")).toBeVisible();
    await expect(page.getByText("Page 3 of 3")).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Search the library" });
    await expect(search).toHaveValue(TERM);

    const nav = page.getByRole("navigation", { name: "Pagination" });
    await expect(nav.getByRole("button", { name: "Next" })).toBeDisabled();
    await expect(nav.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  test("pagination navigates and preserves the query", async ({ page }) => {
    const TERM = "paginate-term";
    await page.route(
      (url) => url.pathname === "/api/public/documents",
      async (route) => {
        const params = new URL(route.request().url()).searchParams;
        const q = params.get("q") ?? "";
        if (q !== TERM) return route.continue();
        const pageNum = Number(params.get("page") ?? "1");
        await fulfillListing(route, {
          items: [mockSummary(`paginate-doc-${pageNum}`, `Paginate Result ${pageNum}`)],
          page: pageNum,
          pageSize: 20,
          total: 45,
          query: q,
        });
      },
    );

    await page.goto(`/?q=${TERM}`);
    await expect(page.getByText("Paginate Result 1")).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Pagination" });
    await nav.getByRole("button", { name: "Next" }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(TERM);
    await expect(page.getByText("Paginate Result 2")).toBeVisible();

    await nav.getByRole("button", { name: "Previous" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBeNull();
    await expect(page.getByText("Paginate Result 1")).toBeVisible();
  });

  test("pagination remains usable at 375px", async ({ page }) => {
    const TERM = "mobile-pagination-term";
    await page.route(
      (url) => url.pathname === "/api/public/documents",
      async (route) => {
        const params = new URL(route.request().url()).searchParams;
        const q = params.get("q") ?? "";
        if (q !== TERM) return route.continue();
        const pageNum = Number(params.get("page") ?? "1");
        await fulfillListing(route, {
          items: [mockSummary(`mobile-doc-${pageNum}`, `Mobile Result ${pageNum}`)],
          page: pageNum,
          pageSize: 20,
          total: 45,
          query: q,
        });
      },
    );

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/?q=${TERM}`);

    const nav = page.getByRole("navigation", { name: "Pagination" });
    await expect(nav.getByRole("button", { name: "Next" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Previous" })).toBeVisible();

    await nav.getByRole("button", { name: "Next" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe("Library empty states", () => {
  test("distinguishes an empty library from a no-match query", async ({ page }) => {
    // Only the UNFILTERED listing (no `q`, no `tag`) is faked here — the
    // real seeded documents are untouched, so this proves the two states
    // render from genuinely different data shapes, not from two code paths
    // that happen to both be reachable today.
    await page.route(
      (url) => url.pathname === "/api/public/documents",
      async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if ((params.get("q") ?? "") !== "" || params.get("tag") !== null) return route.continue();
        await fulfillListing(route, { items: [], page: 1, pageSize: 20, total: 0, query: "" });
      },
    );

    await page.goto("/");
    await expect(page.getByTestId("library-empty")).toHaveText("Nothing has been published yet.");
    await expect(page.getByTestId("library-no-match")).toHaveCount(0);
  });

  test("offers to clear the query when a search has no matches", async ({ page }) => {
    await page.goto("/");

    const search = page.getByRole("searchbox", { name: "Search the library" });
    await search.fill("zzz nonexistent search term xyz");

    await expect(page.getByTestId("library-no-match")).toBeVisible();
    await expect(page.getByText("No documents match this search.")).toBeVisible();
    await expect(page.getByTestId("library-empty")).toHaveCount(0);

    await page.getByRole("button", { name: "Clear search" }).click();

    await expect(page.getByRole("heading", { name: "Recently updated", level: 2 })).toBeVisible();
    await expect(search).toHaveValue("");
  });

  test("a page beyond the last shows a distinct state with working navigation back", async ({ page }) => {
    const TERM = "beyond-range-term";
    await page.route(
      (url) => url.pathname === "/api/public/documents",
      async (route) => {
        const params = new URL(route.request().url()).searchParams;
        const q = params.get("q") ?? "";
        if (q !== TERM) return route.continue();
        const pageNum = Number(params.get("page") ?? "1");
        // The backend clamps page NUMBER, never total — a page past the
        // last one legitimately returns `items: []` alongside the real,
        // nonzero `total` (src/domain/documents/document-read.ts).
        const items = pageNum === 1 ? [mockSummary("beyond-range-doc-1", "Beyond Range Result 1")] : [];
        await fulfillListing(route, { items, page: pageNum, pageSize: 20, total: 5, query: q });
      },
    );

    await page.goto(`/?q=${TERM}&page=9`);

    await expect(page.getByTestId("library-page-beyond-range")).toBeVisible();
    await expect(page.getByText("This page has nothing to show.")).toBeVisible();
    await expect(page.getByTestId("library-no-match")).toHaveCount(0);
    await expect(page.getByTestId("library-empty")).toHaveCount(0);

    await page.getByRole("button", { name: "Back to the first page" }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBeNull();
    await expect(page.getByText("Beyond Range Result 1")).toBeVisible();
  });
});

test.describe("Library search performance and isolation", () => {
  test("no search request fires when the page loads without a query", async ({ page }) => {
    const documentRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/public/documents") documentRequests.push(url.search);
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Recently updated", level: 2 })).toBeVisible();

    // <= 2, not exactly 1: React StrictMode double-invokes effects on mount
    // in dev (the same tolerance tests/browser/public-browse.spec.ts uses for
    // the category-tree fetch), so one *logical* fetch can legitimately
    // produce two requests. What requirement 6 rules out is a SECOND,
    // DIFFERENT request — e.g. the search box committing an empty value on
    // mount — which the uniqueness check below catches.
    expect(documentRequests.length).toBeLessThanOrEqual(2);
    const uniqueSearches = new Set(documentRequests);
    expect(uniqueSearches.size).toBe(1);
  });

  test("no admin chunk requested while searching the library", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await page.goto("/");
    const search = page.getByRole("searchbox", { name: "Search the library" });
    await search.fill("Expectations");
    await expect(page.getByRole("heading", { name: "Matches for “Expectations”", level: 2 })).toBeVisible();

    expect(requested.filter((url) => /admin/i.test(url))).toEqual([]);
  });

  test("out-of-order responses never render, verified by delaying one response", async ({ page }) => {
    let releaseSlow: () => void = () => {};
    const slowReleased = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    await page.route(
      (url) => url.pathname === "/api/public/documents",
      async (route) => {
        const q = new URL(route.request().url()).searchParams.get("q") ?? "";
        if (q === "slow term") {
          await slowReleased;
          await fulfillListing(route, { items: [], page: 1, pageSize: 20, total: 111, query: q });
          return;
        }
        if (q === "fast term") {
          await fulfillListing(route, { items: [], page: 1, pageSize: 20, total: 222, query: q });
          return;
        }
        await route.continue();
      },
    );

    await page.goto("/");
    const search = page.getByRole("searchbox", { name: "Search the library" });

    await search.fill("slow term");
    // Let the debounce commit and the (held-open) request for "slow term"
    // actually start before it gets superseded.
    await page.waitForTimeout(400);

    await search.fill("fast term");
    await expect(page.getByText("0 of 222 shown")).toBeVisible();

    // Only now does the stale "slow term" response resolve. If the
    // superseded request were merely ignored rather than genuinely
    // cancelled (node G4.2 requirement 2), this is where its result would
    // still be able to overwrite what "fast term" already rendered.
    releaseSlow();
    await page.waitForTimeout(300);
    await expect(page.getByText("0 of 222 shown")).toBeVisible();
  });
});
