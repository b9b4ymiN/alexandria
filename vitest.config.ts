import { configDefaults, defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// @cloudflare/vitest-pool-workers 0.22.x integrates as a Vite/Vitest plugin
// (`cloudflareTest`) rather than the older `defineWorkersConfig` wrapper —
// that package no longer publishes a "./config" subpath export.
//
// Node G1.9 note: `cloudflareTest`'s pool maps one Vitest project to one
// wrangler config, and Alexandria now has two real Workers (app,
// content), each with its own bindings. Vitest's `test.projects` (stable
// since Vitest 3.2, present in the installed 4.1.11) is the sanctioned way
// to run more than one pool in a single `vitest run` invocation, so the
// "content" project below points at wrangler.content.jsonc and picks up
// only the two content-worker test files; the pre-existing "app" project
// is unchanged except for excluding those two files, which it can no
// longer resolve against the app Worker's bindings (no R2 binding there
// yet, and the content Worker's D1 rows would be seeded into the wrong
// database). `pnpm test -- <path>` still works unmodified: Vitest matches
// the given paths against every project's `include`.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: {
          name: "app",
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "tests/integration/content-worker*.test.ts"],
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.content.jsonc" } })],
        test: {
          name: "content",
          include: ["tests/integration/content-worker*.test.ts"],
        },
      },
    ],
  },
});
