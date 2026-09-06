import { copyFileSync } from "node:fs";

copyFileSync(
  new URL("../.runner-version", import.meta.url),
  new URL("../dist/.runner-version", import.meta.url)
);
