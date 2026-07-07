import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "fixtures/index": "src/fixtures/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  target: "node18",
  // socket.io / express are heavy; keep them external and let the consumer install them.
  external: ["@nerimity/nerimity.js"],
});
