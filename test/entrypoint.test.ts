import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("runner entrypoint", () => {
  test("recreates container-local runtime directories when root-mode chmod fails", () => {
    const script = fs.readFileSync(
      path.resolve("docker/runner-entrypoint.sh"),
      "utf8"
    );

    expect(script).toContain('ensure_root_runtime_dir "${RUNNER_WORK_DIR}"');
    expect(script).toContain('ensure_root_runtime_dir "${RUNNER_TEMP}"');
    expect(script).toContain('ensure_root_runtime_dir "${RUNNER_TOOL_CACHE}"');
    expect(script).toContain(
      'log "runtime directory permission update failed for ${dir}; recreating it for root runner execution"'
    );
    expect(script).toContain('rm -rf "${dir}"');
  });
});
