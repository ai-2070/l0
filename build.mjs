import * as esbuild from "esbuild";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

// Recursively find all TypeScript files
async function findTsFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findTsFiles(path)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

const entryPoints = await findTsFiles("src");

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
