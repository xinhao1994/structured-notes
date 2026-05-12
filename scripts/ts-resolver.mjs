// Tiny resolver hook so Node's ESM loader accepts extensionless TS imports
// the way Next/TypeScript does. Also stubs `next/server` and `@/lib/*` for
// route tests that run outside the Next build.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    const base = new URL("./next-server-stub.mjs", import.meta.url);
    return nextResolve(base.href, context);
  }
  if (specifier.startsWith("@/lib/")) {
    const rel = "../" + specifier.slice(2);
    return resolve(rel, context, nextResolve);
  }
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
