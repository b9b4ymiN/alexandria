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

describe("scaffold smoke test", () => {
  it("loads the shared worker module graph", () => {
    expect(typeof appWorker.fetch).toBe("function");
    expect(typeof contentWorker.fetch).toBe("function");
  });

  it("serves a placeholder response from both Worker entry points", async () => {
    const appResponse = await appWorker.fetch(new Request("https://example.com/api/placeholder"));
    const contentResponse = await contentWorker.fetch(new Request("https://example.com/anything"));

    expect(appResponse.status).toBe(404);
    expect(contentResponse.status).toBe(404);
  });
});
