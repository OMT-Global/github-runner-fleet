import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("Lume pool scripts", () => {
  test("creates and recycles cloned macOS VM slots", () => {
    const createSlot = read("scripts/lume/create-slot.sh");
    const destroySlot = read("scripts/lume/destroy-slot.sh");
    const runSlot = read("scripts/lume/run-slot.sh");
    const reconcile = read("scripts/lume/reconcile-pool.sh");
    const createBase = read("scripts/lume/create-base-vm.sh");
    const setupBase = read("scripts/lume/setup-base-vm.sh");
    const provisionBase = read("scripts/lume/provision-base-vm.sh");
    const installRuntime = read("scripts/lume/install-runtime.sh");
    const installLaunchAgent = read("scripts/lume/install-launch-agent.sh");
    const installLaunchDaemons = read("scripts/lume/install-system-launch-daemons.sh");

    expect(createSlot).toContain('lume clone "${LUME_VM_BASE_NAME}" "${LUME_VM_NAME}"');
    expect(createSlot).toContain('lume set "${LUME_VM_NAME}" --cpu "${LUME_VM_CPU}"');
    expect(createSlot).toContain('spawn_detached');
    expect(createSlot).toContain('lume run "${LUME_VM_NAME}" --no-display');
    expect(destroySlot).toContain('lume stop "${LUME_VM_NAME}"');
    expect(destroySlot).toContain('lume delete "${LUME_VM_NAME}" --force');
    expect(runSlot).toContain("uploading guest bootstrap assets");
    expect(runSlot).toContain('guest_env_file="$(render_guest_runner_env "${env_path}")"');
    expect(runSlot).toContain('lume ssh "${LUME_VM_NAME}"');
    expect(reconcile).toContain("retire_removed_slots_from_state");
    expect(reconcile).toContain("wait_for_registration_env");
    expect(reconcile).toContain("missing GITHUB_PAT");
    expect(reconcile).toContain("write_reconcile_state");
    expect(reconcile).toContain('reconcile_state_file="${LUME_RECONCILE_STATE_FILE}"');
    expect(reconcile).toContain('spawn_detached');
    expect(reconcile).toContain('"${SCRIPT_DIR}/run-slot.sh" --slot "${slot}"');
    expect(read("scripts/lume/lib.sh")).toContain("default_guest_runner_path");
    expect(read("scripts/lume/lib.sh")).toContain("RUNNER_PATH=${runner_path}");
    expect(createBase).toContain('unattended="$(default_lume_unattended_path)"');
    expect(createBase).toContain('ipsw="$(ensure_cached_lume_ipsw "$(resolve_lume_ipsw_path)")"');
    expect(setupBase).toContain('lume stop "${LUME_VM_BASE_NAME}"');
    expect(setupBase).toContain('lume "${setup_args[@]}"');
    expect(provisionBase).toContain("tar -C");
    expect(provisionBase).toContain("sudo -S -p '' tar -xf");
    expect(provisionBase).toContain("sudo -S -p '' xcodebuild -runFirstLaunch");
    expect(installRuntime).toContain("GITHUB_RUNNER_FLEET_RUNTIME_ROOT");
    expect(installRuntime).toContain("Library/Application Support/github-runner-fleet/controller");
    expect(installRuntime).toContain("rsync -a --delete");
    expect(installRuntime).toContain("pnpm --dir");
    expect(installRuntime).toContain("install_lume_controller_runtime");
    expect(installRuntime).toContain('if [[ -f "${runtime_env}" ]]');
    expect(installRuntime.indexOf('if [[ -f "${runtime_env}" ]]')).toBeLessThan(
      installRuntime.indexOf('install -m 0600 "${REPO_ROOT}/.env" "${runtime_env}"'),
    );
    expect(installLaunchAgent).toContain('com.omt.github-runner-fleet.lume-pool');
    expect(installLaunchAgent).toContain('source "${SCRIPT_DIR}/install-runtime.sh"');
    expect(installLaunchAgent).toContain('install_lume_controller_runtime "${HOME}"');
    expect(installLaunchAgent).toContain('scripts/lume/reconcile-pool.sh --config config/lume-runners.yaml --env \'${runtime_env}\'');
    expect(installLaunchAgent).toContain('launchctl bootstrap "${DOMAIN_TARGET}" "${PLIST_PATH}"');
    expect(installLaunchAgent.indexOf('launchctl enable "${DOMAIN_TARGET}/${LAUNCH_AGENT_LABEL}"')).toBeLessThan(
      installLaunchAgent.indexOf('launchctl bootstrap "${DOMAIN_TARGET}" "${PLIST_PATH}"'),
    );
    expect(installLaunchDaemons).toContain('run as root: sudo $0');
    expect(installLaunchDaemons).toContain('/Library/LaunchDaemons');
    expect(installLaunchDaemons).toContain('com.omt.github-runner-fleet.lume-serve');
    expect(installLaunchDaemons).toContain('com.omt.github-runner-fleet.lume-pool.system');
    expect(installLaunchDaemons).toContain('disable_user_pool_agent');
    expect(installLaunchDaemons).toContain('install_lume_controller_runtime "${TARGET_HOME}" "${TARGET_USER}" "${TARGET_GROUP}"');
    expect(installLaunchDaemons).toContain('launchctl bootstrap system "${plist_path}"');
    expect(installLaunchDaemons.indexOf('launchctl enable "system/${label}"')).toBeLessThan(
      installLaunchDaemons.indexOf('launchctl bootstrap system "${plist_path}"'),
    );
    const installLaunchDaemonsMain = installLaunchDaemons.slice(installLaunchDaemons.indexOf("main() {"));
    expect(installLaunchDaemonsMain.indexOf('bootstrap_daemon "${POOL_LABEL}" "${POOL_PLIST_PATH}"')).toBeLessThan(
      installLaunchDaemonsMain.indexOf("disable_user_pool_agent"),
    );
  });

  test("documents operator-facing lume script usage", () => {
    const scriptPaths = [
      "scripts/lume/create-base-vm.sh",
      "scripts/lume/create-slot.sh",
      "scripts/lume/destroy-slot.sh",
      "scripts/lume/install-runtime.sh",
      "scripts/lume/install-launch-agent.sh",
      "scripts/lume/install-system-launch-daemons.sh",
      "scripts/lume/provision-base-vm.sh",
      "scripts/lume/reconcile-pool.sh",
      "scripts/lume/run-slot.sh",
      "scripts/lume/setup-base-vm.sh",
      "scripts/lume/status.sh",
    ];

    for (const relativePath of scriptPaths) {
      const script = read(relativePath);
      expect(script, `${relativePath} should define usage text`).toContain("Usage:");
      expect(script, `${relativePath} should accept --help`).toMatch(/-h\|--help/);
    }
  });

  test("bootstraps ephemeral macOS runners inside guest VMs", () => {
    const bootstrap = read("scripts/guest/macos-runner-bootstrap.sh");
    const helper = read("scripts/lib/github-runner-common.sh");

    expect(bootstrap).toContain("actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz");
    expect(bootstrap).toContain("--ephemeral");
    expect(bootstrap).toContain("--disableupdate");
    expect(bootstrap).toContain('if [[ ! -f "${RUNNER_ROOT}/.runner" ]]');
    expect(bootstrap).toContain('export PATH="${RUNNER_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.local/bin}"');
    expect(bootstrap).toContain('cleanup_runner_registration');
    expect(helper).toContain("github_runner_endpoint_base");
    expect(helper).toContain("request_runner_token");
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}
