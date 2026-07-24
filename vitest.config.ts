import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // next-auth ships native ESM and is normally left external so
        // Vitest loads it via Node's own ESM loader. But `next-auth/lib/env.js`
        // does `import { NextRequest } from "next/server"`, and Next.js'
        // package.json has no `exports` map (by design — see the
        // `@ts-expect-error` comment right above that import in next-auth's
        // source), so Node's strict ESM resolver refuses the extensionless
        // subpath ("Cannot find module .../next/server ... Did you mean to
        // import next/server.js?"). Forcing next-auth through Vite's own
        // resolver (which — unlike Node's native ESM loader — falls back to
        // probing file extensions for packages without an `exports` field)
        // resolves it to the real `next/server.js` file, exactly like
        // Next's own webpack build and a plain Node `require()` do.
        inline: ["next-auth"],
      },
    },
  },
  resolve: {
  alias: {
    "@/application": path.resolve(__dirname, "./src/core/application"),
    "@/domain": path.resolve(__dirname, "./src/core/domain"),
    "@/infrastructure": path.resolve(__dirname, "./src/core/infrastructure"),
    "@/presentation": path.resolve(__dirname, "./src/presentation"),
    "@/components": path.resolve(__dirname, "./src/presentation/components"),
    "@/hooks": path.resolve(__dirname, "./src/presentation/hooks"),
    "@/lib": path.resolve(__dirname, "./src/lib"),
    "@/shared": path.resolve(__dirname, "./src/shared"),
    "@": path.resolve(__dirname, "./src"),
  },
},
});
