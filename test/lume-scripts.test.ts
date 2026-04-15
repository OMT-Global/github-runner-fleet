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
    const installLaunchAgent = read("scripts/lume/install-launch-agent.sh");
    const installLaunchDaemons = read("scripts/lume/install-system-launch-daemons.sh");

    expect(createSlot).toContain('lume clone "${LUME_VM_BASE_NAME}" "${LUME_VM_NAME}"');
    expect(createSlot).toContain('lume set "${LUME_VM_NAME}" --cpu "${LUME_VM_CPU}"');
    expect(createSlot).toContain('nohup lume run "${LUME_VM_NAME}" --no-display');
    expect(destroySlot).toContain('lume stop "${LUME_VM_NAME}"');
    expect(destroySlot).toContain('lume delete "${LUME_VM_NAME}" --force');
    expect(runSlot).toContain("uploading guest bootstrap assets");
    expect(runSlot).toContain('guest_env_file="$(render_guest_runner_env "${env_path}")"');
    expect(runSlot).toContain('lume ssh "${LUME_VM_NAME}"');
    expect(reconcile).toContain('nohup "${SCRIPT_DIR}/run-slot.sh" --slot "${slot}"');
    expect(createBase).toContain('unattended="$(default_lume_unattended_path)"');
    expect(createBase).toContain('ipsw="$(ensure_cached_lume_ipsw "$(resolve_lume_ipsw_path)")"');
    expect(setupBase).toContain('lume stop "${LUME_VM_BASE_NAME}"');
    expect(setupBase).toContain('lume "${setup_args[@]}"');
    expect(provisionBase).toContain("tar -C");
    expect(provisionBase).toContain("sudo -S -p '' tar -xf");
    expect(provisionBase).toContain("sudo -S -p '' xcodebuild -runFirstLaunch");
    expect(installLaunchAgent).toContain('com.omt.github-runner-fleet.lume-pool');
    expect(installLaunchAgent).toContain('scripts/lume/reconcile-pool.sh --config config/lume-runners.yaml --env .env');
    expect(installLaunchAgent).toContain('launchctl bootstrap "${DOMAIN_TARGET}" "${PLIST_PATH}"');
    expect(installLaunchDaemons).toContain('run as root: sudo $0');
    expect(installLaunchDaemons).toContain('/Library/LaunchDaemons');
    expect(installLaunchDaemons).toContain('com.omt.github-runner-fleet.lume-serve');
    expect(installLaunchDaemons).toContain('com.omt.github-runner-fleet.lume-pool.system');
    expect(installLaunchDaemons).toContain('launchctl bootstrap system "${plist_path}"');
  });

  test("bootstraps ephemeral macOS runners inside guest VMs", () => {
    const bootstrap = read("scripts/guest/macos-runner-bootstrap.sh");
    const helper = read("scripts/lib/github-runner-common.sh");

    expect(bootstrap).toContain("actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz");
    expect(bootstrap).toContain("--ephemeral");
    expect(bootstrap).toContain("--disableupdate");
    expect(bootstrap).toContain('cleanup_runner_registration');
    expect(helper).toContain("github_runner_endpoint_base");
    expect(helper).toContain("request_runner_token");
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}
