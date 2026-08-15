import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    // Network-backed checks are opt-in, so a plain `npm test` stays offline.
    exclude: ["**/node_modules/**", "**/*.devnet.test.ts"],
  },
});
