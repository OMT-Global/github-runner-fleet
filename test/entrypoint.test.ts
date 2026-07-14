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
    expect(script).toContain('ensure_root_tool_cache "${RUNNER_TOOL_CACHE}"');
    expect(script).toContain(
      'log "runtime directory permission update failed for ${dir}; recreating it for root runner execution"'
    );
    expect(script).toContain('rm -rf "${dir}"');
  });

  test("preserves the baked-in tool cache during root fallback", () => {
    const script = fs.readFileSync(
      path.resolve("docker/runner-entrypoint.sh"),
      "utf8"
    );

    expect(script).toContain("ensure_root_tool_cache()");
    expect(script).toContain(
      'log "tool cache top-level permission update failed for ${dir}; preserving baked-in tool cache for root runner execution"'
    );
    expect(script).not.toContain('rm -rf "${RUNNER_TOOL_CACHE}"');
  });

  test("records runner lifecycle audit events and installs the job-start hook", () => {
    const script = fs.readFileSync(
      path.resolve("docker/runner-entrypoint.sh"),
      "utf8"
    );

    expect(script).toContain(": \"${AUDIT_LOG_FILE:=/var/log/runner-fleet/audit.jsonl}\"");
    expect(script).toContain("install_runner_hooks");
    expect(script).toContain("ACTIONS_RUNNER_HOOK_JOB_STARTED");
    expect(script).toContain("audit_event runner_job_start");
    expect(script).toContain("audit_event token_fetch_failed");
    expect(script).toContain("audit_event runner_registered");
    expect(script).toContain('RUNNER_AUDIT_DEREGISTER_EVENT="runner_evicted"');
  });

  test("fails Docker-capable runners before registration when client and daemon APIs are incompatible", () => {
    const script = fs.readFileSync(
      path.resolve("docker/runner-entrypoint.sh"),
      "utf8"
    );

    expect(script).toContain("verify_docker_api_compatibility()");
    expect(script).toContain('DOCKER_MIN_SERVER_API_VERSION:-1.44');
    expect(script).toContain("client_version={{.Client.Version}}");
    expect(script).toContain("server_api={{.Server.APIVersion}}");
    expect(script).toContain("Docker compatibility preflight failed");
    expect(script.lastIndexOf("verify_docker_api_compatibility")).toBeLessThan(
      script.lastIndexOf("prepare_runner_home")
    );
  });
});
