import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// MapLibre v6 builds its worker URL from import.meta.url at runtime, which
// the bundler cannot follow, so the worker and the shared module it imports
// are served as static files instead. Copied from the installed package on
// every dev/build so the served worker always matches the library version.
const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve("maplibre-gl/package.json"));
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");

mkdirSync(outDir, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(packageDir, "dist", file), join(outDir, file));
}
