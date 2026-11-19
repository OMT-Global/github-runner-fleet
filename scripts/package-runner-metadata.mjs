import { copyFileSync } from "node:fs";
// The compiled reader is dist/src/lib/runner-version.js; its relative data
// contract resolves to dist/.runner-version and dist/.runner-checksums,
// independent of the caller cwd.
for (const file of [".runner-version", ".runner-checksums"]) {
  copyFileSync(new URL(`../${file}`, import.meta.url),
               new URL(`../dist/${file}`, import.meta.url));
}
