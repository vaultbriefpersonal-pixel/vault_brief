import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*": ["./src/*"] — Next.js resolves this
    // alias itself, but Vitest runs outside Next's build pipeline and
    // needs its own mapping. Only needed once a test's module graph
    // reaches a real (non type-only) `@/...` import.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
