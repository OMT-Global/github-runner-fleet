import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("build-image helper", () => {
  test("loads local single-platform builds and rejects multi-platform non-push builds", () => {
    const script = fs.readFileSync(
      path.resolve("scripts/build-image.sh"),
      "utf8"
    );

    expect(script).toContain('LOAD_FLAG="--load"');
    expect(script).toContain('if [[ -n "${PUSH_FLAG}" ]]; then');
    expect(script).toContain('elif [[ "${PLATFORM}" == *,* ]]; then');
    expect(script).toContain(
      "multi-platform builds require --push; local non-pushed builds must target a single platform"
    );
  });
});
