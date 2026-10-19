import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["oracle/test/**/*.test.ts"], testTimeout: 30_000 },
});
