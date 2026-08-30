import { describe, expect, it } from "vitest";
import appWorker from "../../src/index";
import contentWorker from "../../src/content/index";

// Compile-time guard: this line only type-checks (via @ts-expect-error)
// while strict null checks are enabled. If strict mode is ever disabled,
// `pnpm typecheck` fails because the suppressed error stops occurring.
function strictModeGuard(input: string | null): string {
  // @ts-expect-error strict mode forbids assigning `string | null` to `string`
  const value: string = input;
  return value;
}
void strictModeGuard;

// Orchestrator note (2026-08-30): this file originally asserted that BOTH
// Worker entry points returned a placeholder 404 when called with a bare
// Request. Node G1.9 replaced the content Worker's placeholder with a real
// handler that requires its D1 and R2 bindings, so calling it without an
// env no longer type-checks and no longer describes real behaviour. The
// content Worker's request handling is now covered properly, with real
// bindings, by tests/integration/content-worker*.test.ts. This file keeps
// its original stated purpose from node G1.0: prove the shared module
// graph loads and prove strict mode is active.
describe("scaffold smoke test", () => {
  it("loads the shared worker module graph", () => {
    expect(typeof appWorker.fetch).toBe("function");
    expect(typeof contentWorker.fetch).toBe("function");
  });

  it("serves a non-API path from the app Worker without touching bindings", async () => {
    const appResponse = await appWorker.fetch(new Request("https://example.com/not-an-api-path"));

    expect(appResponse.status).toBe(404);
  });
});
