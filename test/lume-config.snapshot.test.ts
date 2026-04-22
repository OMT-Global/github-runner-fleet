import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadLumeConfig } from "../src/lib/lume-config.js";
import { deploymentEnvFixture } from "./fixtures/rendered-artifacts.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("loadLumeConfig snapshots", () => {
  test("locks the full Lume runner manifest", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "lume-runners.yaml");
    fs.writeFileSync(
      configPath,
      `version: 1
pool:
  key: macos-private
  organization: example
  runnerGroup: macos-private
  labels:
    - gpu
  size: 2
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner-slot
  imageTag: macos-15.4-xcode-16.3
  cpu: 6
  memory: 14GB
  diskSize: 80GB
  network: shared
  storage: /Users/tester/.lume
  guestUser: lume
  guestPassword: fake-password
  guestRunnerRoot: /Users/lume/actions-runner
  guestWorkRoot: /Users/lume/actions-runner/_work
  runnerVersion: 2.340.0
`,
      "utf8"
    );

    const manifest = loadLumeConfig(configPath, deploymentEnvFixture());
    expect({
      ...manifest,
      host: {
        ...manifest.host,
        configPath: "<fixture>/lume-runners.yaml"
      }
    }).toMatchSnapshot();
  });
});

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-snapshot-"));
  tempPaths.push(directory);
  return directory;
}
