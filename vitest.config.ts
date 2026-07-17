import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@/domain": path.resolve(__dirname, "./src/core/domain"),
      "@/application": path.resolve(__dirname, "./src/core/application"),
      "@/infrastructure": path.resolve(__dirname, "./src/core/infrastructure"),
      "@/presentation": path.resolve(__dirname, "./src/presentation"),
      "@/components": path.resolve(__dirname, "./src/presentation/components"),
      "@/hooks": path.resolve(__dirname, "./src/presentation/hooks"),
      "@/lib": path.resolve(__dirname, "./src/lib"),
      "@/shared": path.resolve(__dirname, "./src/shared"),
    },
  },
});
