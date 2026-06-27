import { build } from "esbuild";

// Bundle the server and all of its runtime dependencies into a single ESM file.
// This means the .mcpb package ships only dist/ + manifest + icon — no node_modules.
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/index.js",
  banner: {
    // createRequire shim so bundled CJS deps can call require() under ESM.
    // No shebang: Claude Desktop launches the server via `node dist/index.js`.
    js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});
