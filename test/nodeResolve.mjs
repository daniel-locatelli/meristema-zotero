// Module hooks that let `node --test` load the plugin's TypeScript sources
// directly, so `npm run test:unit` needs no bundler and no extra dependency.
//
// Two gaps between Node's ESM resolver and the way esbuild bundles this plugin:
//
//   * `src/` writes relative imports without a file extension, which Node's ESM
//     resolver rejects. The resolve hook appends `.ts` when such a file exists.
//   * `package.json` is imported for named bindings (`config`, `version`), while
//     Node's JSON modules expose a default export only. The load hook re-emits
//     the JSON as a module with one named export per top-level key.
//
// Everything reached this way must stay free of `Zotero.*` and the DOM; tests
// that need either belong in `test/zotero/`, which runs under real Zotero.

import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[A-Za-z0-9]+$/.test(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return {
          url: candidate.href,
          format: "module-typescript",
          shortCircuit: true,
        };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".json")) return nextLoad(url, context);
    const data = JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
    const names = Object.keys(data).filter((key) => IDENTIFIER.test(key));
    const lines = [
      `const data = ${JSON.stringify(data)};`,
      "export default data;",
      ...names.map(
        (name, index) =>
          `const binding${index} = data[${JSON.stringify(name)}];` +
          ` export { binding${index} as ${name} };`,
      ),
    ];
    return { format: "module", source: lines.join("\n"), shortCircuit: true };
  },
});
