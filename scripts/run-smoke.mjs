import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./ts-resolver.mjs", import.meta.url);
await import("./smoke.mjs");
