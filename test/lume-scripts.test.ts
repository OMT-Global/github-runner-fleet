import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
    expect(runSlot).toContain('collect_guest_audit "${RUNNER_ROOT}/audit.jsonl" "${LUME_AUDIT_LOG_FILE}"');
    expect(read("scripts/guest/macos-runner-bootstrap.sh")).toContain("audit_event runner_registered");
    expect(read("scripts/guest/macos-runner-bootstrap.sh")).toContain("audit_event runner_job_start");
    expect(runSlot).toContain("trap cleanup_slot EXIT");
    expect(runSlot).toContain("trap shutdown_slot INT TERM");
    expect(runSlot).toContain("trap - EXIT INT TERM");
    expect(reconcile).toContain("retire_removed_slots_from_state");
    expect(reconcile).toContain('terminate_tracked_process "${worker_pid_file}" "run-slot.sh"');
    expect(reconcile).toContain("wait_for_registration_env");
    expect(reconcile).toContain("missing GitHub auth");
    expect(reconcile).toContain("write_reconcile_state");
    expect(reconcile).toContain('reconcile_state_file="${LUME_RECONCILE_STATE_FILE}"');
    expect(reconcile).toContain('spawn_detached');
    expect(reconcile).toContain('"${SCRIPT_DIR}/run-slot.sh" --slot "${slot}"');
    expect(read("scripts/lume/lib.sh")).toContain("default_guest_runner_path");
    expect(read("scripts/lume/lib.sh")).toContain('local runner_version="${RUNNER_VERSION}"');
    expect(read("scripts/lume/lib.sh")).toContain("RUNNER_PATH=${runner_path}");
    expect(read("scripts/lume/lib.sh")).toContain("RUNNER_VERSION=${runner_version}");
    expect(createBase).toContain('unattended="$(default_lume_unattended_path)"');
    expect(createBase).toContain('ipsw="$(ensure_cached_lume_ipsw "$(resolve_lume_ipsw_path)")"');
    expect(setupBase).toContain('lume stop "${LUME_VM_BASE_NAME}"');
    expect(setupBase).toContain('lume "${setup_args[@]}"');
    expect(provisionBase).toContain("tar -C");
    expect(provisionBase).toContain("install-ios-simulator-runtime.sh");
    expect(provisionBase).toContain("sudo -S -p '' tar -xf");
    expect(provisionBase).toContain("sudo -S -p '' xcodebuild -runFirstLaunch");
    expect(installRuntime).toContain("GITHUB_RUNNER_FLEET_RUNTIME_ROOT");
    expect(installRuntime).toContain("Library/Application Support/github-runner-fleet/controller");
    expect(installRuntime).toContain("rsync -a --delete");
    expect(installRuntime).toContain("pnpm --dir");
    expect(installRuntime).toContain("${REPO_ROOT}/.runner-version");
    expect(installRuntime).toContain("RUNNER_VERSION=${runner_version}");
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

  test("provisions pinned Sparkle tools in the Lume base VM", () => {
    const provisionBase = read("scripts/lume/provision-base-vm.sh");
    const sparkleInstaller = read("scripts/guest/install-sparkle-tools.sh");

    expect(provisionBase).toContain("install-sparkle-tools.sh");
    expect(provisionBase).toContain("sparkle-release labels");
    expect(sparkleInstaller).toContain('SPARKLE_VERSION="2.9.4"');
    expect(sparkleInstaller).toContain("SPARKLE_SHA256=");
    expect(sparkleInstaller).toContain("SPARKLE_ARCHIVE_PATH");
    expect(sparkleInstaller).toContain(".local/share/omt-tools/sparkle");
    expect(sparkleInstaller).toContain("generate_appcast");
    expect(sparkleInstaller).toContain("generate_keys");
  });

  test("preinstalls and verifies an iOS Simulator runtime in the Lume base VM", () => {
    const provisionBase = read("scripts/lume/provision-base-vm.sh");
    const runtimeInstaller = read("scripts/guest/install-ios-simulator-runtime.sh");

    expect(provisionBase).toContain("installing and verifying the iOS Simulator runtime");
    expect(provisionBase).toContain("install-ios-simulator-runtime.sh");
    expect(runtimeInstaller).toContain("xcodebuild -downloadPlatform iOS");
    expect(runtimeInstaller).toContain("IOS_SIMULATOR_DOWNLOAD_TIMEOUT_SECONDS");
    expect(runtimeInstaller).toContain("xcrun simctl list runtimes available -j");
    expect(runtimeInstaller).toContain('runtime.get("isAvailable")');
    expect(runtimeInstaller).toContain("No available iOS Simulator runtime exists after Xcode platform provisioning.");
  });

  test("downloads a missing iOS runtime and skips an available one", () => {
    const missing = runRuntimeInstaller({ downloadInstallsRuntime: true });
    expect(missing.status).toBe(0);
    expect(missing.commands).toContain("-downloadPlatform iOS");

    const available = runRuntimeInstaller({ runtimeInitiallyAvailable: true, downloadInstallsRuntime: true });
    expect(available.status).toBe(0);
    expect(available.commands).not.toContain("-downloadPlatform iOS");
    expect(available.stdout).toContain("already installed");
  });

  test("fails closed when Xcode does not make an iOS runtime available", () => {
    const result = runRuntimeInstaller({ downloadInstallsRuntime: false });

    expect(result.status).toBe(1);
    expect(result.commands).toContain("-downloadPlatform iOS");
    expect(result.stderr).toContain("No available iOS Simulator runtime exists");
  });

  test("bounds a stalled iOS platform download", () => {
    const result = runRuntimeInstaller({
      downloadInstallsRuntime: true,
      downloadSleepSeconds: 3,
      timeoutSeconds: 1,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("failed or exceeded 1 seconds");
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function runRuntimeInstaller(options: {
  downloadSleepSeconds?: number;
  runtimeInitiallyAvailable?: boolean;
  downloadInstallsRuntime: boolean;
  timeoutSeconds?: number;
}): { commands: string; status: number | null; stderr: string; stdout: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ios-runtime-installer-"));
  const runtimeState = path.join(directory, "runtime-available");
  const commandLog = path.join(directory, "commands.log");
  if (options.runtimeInitiallyAvailable) {
    fs.writeFileSync(runtimeState, "available\n", "utf8");
  }

  writeExecutable(
    path.join(directory, "xcrun"),
    [
      "#!/bin/bash",
      'if [[ -f "${RUNTIME_STATE}" ]]; then',
      "  printf '%s\\n' '{\"runtimes\":[{\"name\":\"iOS 26.5\",\"isAvailable\":true}]}'",
      "else",
      "  printf '%s\\n' '{\"runtimes\":[]}'",
      "fi",
    ].join("\n"),
  );
  writeExecutable(
    path.join(directory, "xcodebuild"),
    [
      "#!/bin/bash",
      'printf "%s\\n" "$*" >> "${COMMAND_LOG}"',
      'if [[ "$1" == "-downloadPlatform" && "${DOWNLOAD_SLEEP_SECONDS}" != "0" ]]; then',
      '  sleep "${DOWNLOAD_SLEEP_SECONDS}"',
      "fi",
      'if [[ "$1" == "-downloadPlatform" && "${DOWNLOAD_INSTALLS_RUNTIME}" == "true" ]]; then',
      '  printf "available\\n" > "${RUNTIME_STATE}"',
      "fi",
    ].join("\n"),
  );

  const result = spawnSync("bash", [path.resolve("scripts/guest/install-ios-simulator-runtime.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      COMMAND_LOG: commandLog,
      DOWNLOAD_INSTALLS_RUNTIME: String(options.downloadInstallsRuntime),
      DOWNLOAD_SLEEP_SECONDS: String(options.downloadSleepSeconds ?? 0),
      IOS_SIMULATOR_DOWNLOAD_TIMEOUT_SECONDS: String(options.timeoutSeconds ?? 60),
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      RUNTIME_STATE: runtimeState,
    },
  });
  const commands = fs.existsSync(commandLog) ? fs.readFileSync(commandLog, "utf8") : "";
  fs.rmSync(directory, { force: true, recursive: true });
  return { commands, status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function writeExecutable(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, `${contents}\n`, { encoding: "utf8", mode: 0o755 });
}
