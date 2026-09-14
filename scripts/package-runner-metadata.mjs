import { copyFileSync } from "node:fs";
// The compiled reader is dist/src/lib/runner-version.js; its relative data
// contract resolves to dist/.runner-version, independent of the caller cwd.
copyFileSync(new URL("../.runner-version", import.meta.url),
             new URL("../dist/.runner-version", import.meta.url));
