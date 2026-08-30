import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests cover the pure calculation layer only — money math, hour splits,
// date helpers. No jsdom, no React, no live Supabase. Anything that needs a
// database round-trip is out of scope here by design; see tests/README.md.
export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./*" mapping in tsconfig.json.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
