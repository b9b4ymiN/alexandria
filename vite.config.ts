import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// Builds the React SPA and the app Worker (src/index.ts) together.
// The content Worker (wrangler.content.jsonc) is a separate deployable
// and is NOT built through this config — see package.json "dev:content".
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
});
