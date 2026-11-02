import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["server/**/*.test.ts", "client/src/**/*.test.ts", "client/src/**/*.test.tsx"],
    environment: "node",
    environmentMatchGlobs: [
      ["client/src/**/*.test.tsx", "jsdom"],
    ],
    globals: true,
    testTimeout: 15000,
    fileParallelism: false,
    setupFiles: ["./client/src/test-setup.ts", "./server/test-database-setup.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
});
