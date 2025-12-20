import * as esbuild from "esbuild";
import { glob } from "node:fs/promises";

// Find all TypeScript source files
const entryPoints = [];
for await (const file of glob("src/**/*.ts")) {
  entryPoints.push(file);
}

// Build ESM
await esbuild.build({
  entryPoints,
  outdir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,
  bundle: false,
  // Preserve directory structure
  outbase: "src",
});

console.log(`Built ${entryPoints.length} files to dist/`);
