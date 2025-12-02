import { build } from "esbuild";
import { gzipSync } from "zlib";

const entries = [
  { name: "@ai2070/l0 (full)", entry: "./src/index.ts" },
  { name: "@ai2070/l0/core", entry: "./src/core.ts" },
  { name: "@ai2070/l0/structured", entry: "./src/structured.ts" },
  { name: "@ai2070/l0/consensus", entry: "./src/consensus.ts" },
  { name: "@ai2070/l0/parallel", entry: "./src/runtime/parallel.ts" },
  { name: "@ai2070/l0/window", entry: "./src/window.ts" },
  { name: "@ai2070/l0/guardrails", entry: "./src/guardrails.ts" },
  { name: "@ai2070/l0/monitoring", entry: "./src/monitoring.ts" },
  { name: "@ai2070/l0/drift", entry: "./src/drift.ts" },
];

console.log("| Import | Size | Gzipped |");
console.log("|--------|------|---------|");

for (const { name, entry } of entries) {
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      external: [
        "ai",
        "@ai-sdk/*",
        "zod",
        "@effect/schema",
        "@sentry/*",
        "@opentelemetry/*",
      ],
      minify: true,
    });

    const code = result.outputFiles[0].text;
    const size = Buffer.byteLength(code);
    const gzipped = gzipSync(code).length;

    const sizeKB = Math.round(size / 1024);
    const gzipKB = Math.round(gzipped / 1024);

    console.log(`| ${name} | ${sizeKB}KB | ${gzipKB}KB |`);
  } catch (e) {
    console.log(`| ${name} | ERROR | ${e.message} |`);
  }
}
