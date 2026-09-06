import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { readCanonicalRunnerVersion } from "../src/lib/runner-version.js";

test("packages canonical runner metadata for the built reader", () => {
  const repository = path.resolve(".");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "runner-build-test-"));
  try {
    // Exercise the real build command with one source module, not the full app.
    for (const relativePath of [
      "package.json", "tsconfig.json", ".runner-version",
      "src/lib/runner-version.ts", "scripts/copy-build-metadata.mjs"
    ]) {
      const destination = path.join(directory, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repository, relativePath), destination);
    }
    fs.symlinkSync(
      path.join(repository, "node_modules"),
      path.join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir"
    );
    const { scripts } = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    execSync(scripts.build, {
      cwd: directory,
      env: {
        ...process.env,
        PATH: [path.join(repository, "node_modules/.bin"), process.env.PATH].join(path.delimiter)
      },
      timeout: 20_000,
      stdio: "pipe"
    });

    expect(fs.readFileSync(path.join(directory, "dist/.runner-version"), "utf8"))
      .toBe(fs.readFileSync(path.join(repository, ".runner-version"), "utf8"));
    fs.rmSync(path.join(directory, ".runner-version"));
    const builtModule = pathToFileURL(path.join(directory, "dist/src/lib/runner-version.js"));
    const actual = execFileSync(process.execPath, [
      "--input-type=module", "--eval",
      `import { readCanonicalRunnerVersion } from ${JSON.stringify(builtModule.href)}; console.log(readCanonicalRunnerVersion());`
    ], { cwd: os.tmpdir(), encoding: "utf8", timeout: 5_000 });
    expect(actual.trim()).toBe(readCanonicalRunnerVersion());
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
