import { defineConfig } from "vitest/config";
import path from "node:path";

// Network-backed checks. Separate config so `npm test` stays offline.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      /*
       * `server-only` throws on import to keep server modules out of client
       * bundles, which is exactly what it should do in the app and exactly
       * what makes a server module untestable here. Next resolves it to an
       * empty module under the `react-server` condition; this points at that
       * same empty module rather than switching the whole resolver over to a
       * condition the rest of these tests do not want.
       */
      "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
    },
  },
  test: { environment: "node", include: ["**/*.devnet.test.ts"], testTimeout: 120_000 },
});
