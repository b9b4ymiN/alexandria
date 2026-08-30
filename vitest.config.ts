import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// @cloudflare/vitest-pool-workers 0.22.x integrates as a Vite/Vitest plugin
// (`cloudflareTest`) rather than the older `defineWorkersConfig` wrapper —
// that package no longer publishes a "./config" subpath export.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
