// Tiny resolver hook so Node's ESM loader accepts extensionless TS imports
// the way Next/TypeScript does. Used only by the smoke test.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const parentURL = context.parentURL ?? import.meta.url;
    const parentPath = fileURLToPath(parentURL);
    const base = new URL(specifier, pathToFileURL(parentPath));
    const filePath = fileURLToPath(base);
    if (!filePath.match(/\.(m?[jt]sx?|json)$/)) {
      for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
        if (existsSync(filePath + ext)) {
          return nextResolve(specifier + ext, context);
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
