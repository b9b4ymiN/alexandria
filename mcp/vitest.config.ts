import { defineConfig } from "vitest/config";

// Standalone vitest config for the mcp/ workspace package. Without this,
// vitest walks up to the repo root's vitest.config.ts, whose `include`
// patterns (tests/unit, tests/integration) are relative to the repo root
// and never match mcp/tests — `pnpm --filter alexandria-mcp test` would
// find zero test files. The root config is untouched (node G5.2 §2/§5).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
