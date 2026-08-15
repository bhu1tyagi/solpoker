import { defineConfig } from "vitest/config";
import path from "node:path";

// Network-backed checks. Separate config so `npm test` stays offline.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: { environment: "node", include: ["**/*.devnet.test.ts"], testTimeout: 120_000 },
});
