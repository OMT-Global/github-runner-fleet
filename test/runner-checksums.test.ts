import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { fetchLatestRunnerRelease } from "../src/lib/github.js";
import {
  deployedRunnerAssetNames,
  formatRunnerChecksums,
  missingRunnerChecksums,
  parseRunnerChecksums,
  readCanonicalRunnerVersion,
  readRunnerChecksums,
  releaseAssetSha256
} from "../src/lib/runner-version.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function runBash(lines: string[], env: Record<string, string> = {}) {
  return spawnSync("bash", ["-c", ["set -Eeuo pipefail", ...lines].join("\n")], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

describe("runner checksum manifest", () => {
  test("covers every deployed asset of the canonical runner version", () => {
    const version = readCanonicalRunnerVersion();
    expect(missingRunnerChecksums(version, readRunnerChecksums())).toEqual([]);
  });

  test("parses sha256sum lines, skipping comments and blanks", () => {
    const checksums = parseRunnerChecksums(
      `# header\n\n${DIGEST_A.toUpperCase()}  actions-runner-linux-x64-2.0.0.tar.gz\n`
    );
    expect(checksums.get("actions-runner-linux-x64-2.0.0.tar.gz")).toBe(DIGEST_A);
  });

  test("rejects malformed lines and conflicting duplicates", () => {
    expect(() => parseRunnerChecksums("deadbeef  asset.tar.gz\n")).toThrow(/:1 is not/);
    expect(() =>
      parseRunnerChecksums(`${DIGEST_A}  asset.tar.gz\n${DIGEST_B}  asset.tar.gz\n`)
    ).toThrow(/conflicting digest/);
  });

  test("reports which deployed assets lack a digest", () => {
    const checksums = parseRunnerChecksums(`${DIGEST_A}  actions-runner-linux-x64-2.0.0.tar.gz\n`);
    expect(missingRunnerChecksums("v2.0.0", checksums)).toEqual([
      "actions-runner-linux-arm64-2.0.0.tar.gz",
      "actions-runner-osx-arm64-2.0.0.tar.gz",
      "actions-runner-win-x64-2.0.0.zip"
    ]);
  });

  test("formats manifest lines from GitHub release-asset digests", () => {
    const assets = deployedRunnerAssetNames("2.0.0").map((name) => ({
      name,
      digest: `sha256:${DIGEST_A}`
    }));
    const text = formatRunnerChecksums("2.0.0", [
      ...assets,
      { name: "actions-runner-linux-arm-2.0.0.tar.gz", digest: `sha256:${DIGEST_B}` }
    ]);
    expect(text.trim().split("\n")).toHaveLength(4);
    expect(parseRunnerChecksums(text).get("actions-runner-win-x64-2.0.0.zip")).toBe(DIGEST_A);
    expect(() => formatRunnerChecksums("2.0.0", assets.slice(1))).toThrow(
      /no SHA-256 digest for actions-runner-linux-x64-2.0.0.tar.gz/
    );
  });

  test("accepts only sha256 release digests", () => {
    expect(releaseAssetSha256(`sha256:${DIGEST_A.toUpperCase()}`)).toBe(DIGEST_A);
    expect(releaseAssetSha256("sha512:abc")).toBeUndefined();
    expect(releaseAssetSha256(undefined)).toBeUndefined();
    expect(releaseAssetSha256("sha256:short")).toBeUndefined();
  });

  test("surfaces release-asset digests from the GitHub API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          tag_name: "v2.0.0",
          assets: [
            { name: "actions-runner-osx-arm64-2.0.0.tar.gz", digest: `sha256:${DIGEST_A}` },
            { name: "notes.txt" },
            { digest: "sha256:orphan" }
          ]
        })
    });
    const release = await fetchLatestRunnerRelease(undefined, undefined, fetchMock);
    expect(release.assets).toEqual([
      { name: "actions-runner-osx-arm64-2.0.0.tar.gz", digest: `sha256:${DIGEST_A}` },
      { name: "notes.txt", digest: undefined }
    ]);
  });
});

describe("image builds verify the runner archive", () => {
  test("the Linux image checks the digest before extracting", () => {
    const dockerfile = fs.readFileSync(path.resolve("docker/Dockerfile"), "utf8");
    expect(dockerfile).toContain("COPY .runner-version .runner-checksums /");
    const verify = dockerfile.indexOf("sha256sum -c runner.sha256");
    expect(dockerfile).toContain(`awk -v asset="\${runner_asset}" '$2 == asset' /.runner-checksums > runner.sha256`);
    expect(dockerfile).toContain('test "$(wc -l < runner.sha256)" -eq 1');
    expect(verify).toBeGreaterThan(0);
    expect(verify).toBeLessThan(dockerfile.indexOf('tar -xzf "${runner_asset}"'));
  });

  test("the Linux verification step rejects a tampered or unlisted archive", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "runner-verify-"));
    try {
      const asset = "actions-runner-linux-x64-9.9.9.tar.gz";
      fs.writeFileSync(path.join(directory, asset), "genuine");
      const genuine = sha256(path.join(directory, asset));
      const verify = [
        `cd "${directory}"`,
        `awk -v asset="${asset}" '$2 == asset' manifest > runner.sha256`,
        'test "$(wc -l < runner.sha256)" -eq 1',
        "sha256sum -c runner.sha256"
      ];

      fs.writeFileSync(path.join(directory, "manifest"), `# c\n${genuine}  ${asset}\n`);
      expect(runBash(verify).status).toBe(0);

      fs.writeFileSync(path.join(directory, asset), "tampered");
      expect(runBash(verify).status).not.toBe(0);

      fs.writeFileSync(path.join(directory, "manifest"), `${genuine}  other.tar.gz\n`);
      expect(runBash(verify).status).not.toBe(0);
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  test("the Windows image checks Get-FileHash before Expand-Archive", () => {
    const dockerfile = fs.readFileSync(path.resolve("docker/Dockerfile.windows"), "utf8");
    expect(dockerfile).toContain("COPY .runner-checksums C:/.runner-checksums");
    const hash = dockerfile.indexOf("Get-FileHash -Algorithm SHA256 -Path $runnerZip");
    expect(hash).toBeGreaterThan(0);
    expect(hash).toBeLessThan(dockerfile.indexOf("Expand-Archive"));
    expect(dockerfile).toContain("if ($expectedSha256.Count -ne 1) { throw");
    expect(dockerfile).toContain("if ($actualSha256 -ne $expectedSha256[0]) { Remove-Item $runnerZip; throw");
  });
});

describe("Lume guest runner archive verification", () => {
  const bootstrapFunctions = [
    "log() { printf '%s\\n' \"$*\" >&2; }",
    "audit_event() { printf 'audit=%s\\n' \"$1\"; }",
    "eval \"$(sed -n '/^runner_file_sha256() {/,/^}/p' scripts/guest/macos-runner-bootstrap.sh)\"",
    "eval \"$(sed -n '/^expected_runner_sha256() {/,/^}/p' scripts/guest/macos-runner-bootstrap.sh)\"",
    "eval \"$(sed -n '/^download_runner_bundle() {/,/^}/p' scripts/guest/macos-runner-bootstrap.sh)\"",
    "eval \"$(sed -n '/^prepare_runner_home() {/,/^}/p' scripts/guest/macos-runner-bootstrap.sh)\""
  ];

  function withRunnerArchive(
    run: (input: { directory: string; archive: string; digest: string; root: string }) => void
  ): void {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-runner-sha-"));
    try {
      const payload = path.join(directory, "payload");
      fs.mkdirSync(payload);
      fs.writeFileSync(path.join(payload, "config.sh"), "#!/usr/bin/env bash\n", { mode: 0o755 });
      fs.writeFileSync(path.join(payload, "run.sh"), "#!/usr/bin/env bash\n", { mode: 0o755 });
      const archive = path.join(directory, "runner.tar.gz");
      expect(spawnSync("tar", ["-czf", archive, "-C", payload, "."]).status).toBe(0);
      run({ directory, archive, digest: sha256(archive), root: path.join(directory, "root") });
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  }

  function bootstrapEnv(root: string, archive: string, digest: string): Record<string, string> {
    return {
      RUNNER_ROOT: root,
      RUNNER_WORK_DIR: path.join(root, "_work-dir"),
      RUNNER_VERSION: "9.9.9",
      RUNNER_SHA256: digest,
      RUNNER_DOWNLOAD_URL: `file://${archive}`
    };
  }

  test("installs a verified archive and records its digest", () => {
    withRunnerArchive(({ archive, digest, root }) => {
      const result = runBash([...bootstrapFunctions, "prepare_runner_home"], bootstrapEnv(root, archive, digest.toUpperCase()));
      expect(result.status, result.stderr).toBe(0);
      expect(fs.existsSync(path.join(root, "config.sh"))).toBe(true);
      expect(fs.readFileSync(path.join(root, ".runner-sha256"), "utf8").trim()).toBe(digest);
    });
  });

  test("refuses a mismatched archive and leaves nothing installed", () => {
    withRunnerArchive(({ archive, root }) => {
      const result = runBash([...bootstrapFunctions, "prepare_runner_home"], bootstrapEnv(root, archive, "0".repeat(64)));
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("audit=runner_archive_checksum_mismatch");
      expect(result.stderr).toContain("SHA-256 mismatch for actions-runner-osx-arm64-9.9.9.tar.gz");
      expect(fs.existsSync(path.join(root, "config.sh"))).toBe(false);
      expect(fs.existsSync(path.join(root, "actions-runner-osx-arm64-9.9.9.tar.gz"))).toBe(false);
    });
  });

  test("refuses to run without RUNNER_SHA256", () => {
    withRunnerArchive(({ archive, root }) => {
      const result = runBash([...bootstrapFunctions, "prepare_runner_home"], bootstrapEnv(root, archive, ""));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("refusing to install an unverified runner");
      expect(fs.existsSync(path.join(root, "config.sh"))).toBe(false);
    });
  });

  test("replaces a poisoned cached archive", () => {
    withRunnerArchive(({ archive, digest, root }) => {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "actions-runner-osx-arm64-9.9.9.tar.gz"), "poisoned");
      const result = runBash([...bootstrapFunctions, "prepare_runner_home"], bootstrapEnv(root, archive, digest));
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain("discarding cached actions-runner-osx-arm64-9.9.9.tar.gz");
      expect(sha256(path.join(root, "actions-runner-osx-arm64-9.9.9.tar.gz"))).toBe(digest);
    });
  });

  test("re-verifies a runner installed before digests were recorded", () => {
    withRunnerArchive(({ archive, digest, root }) => {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "config.sh"), "#!/usr/bin/env bash\n# legacy\n", { mode: 0o755 });
      fs.writeFileSync(path.join(root, "run.sh"), "#!/usr/bin/env bash\n", { mode: 0o755 });
      fs.writeFileSync(path.join(root, ".runner-version"), "9.9.9\n");
      const result = runBash([...bootstrapFunctions, "prepare_runner_home"], bootstrapEnv(root, archive, digest));
      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(path.join(root, "config.sh"), "utf8")).not.toContain("legacy");
      expect(fs.readFileSync(path.join(root, ".runner-sha256"), "utf8").trim()).toBe(digest);
    });
  });

  describe("host env rendering", () => {
    function renderGuestEnv(env: Record<string, string>, envFileBody = "GITHUB_PAT=test\n") {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-guest-env-"));
      try {
        const envPath = path.join(directory, "runner.env");
        fs.writeFileSync(envPath, envFileBody);
        return runBash(
          [
            'source "scripts/lume/lib.sh"',
            `rendered="$(render_guest_runner_env "${envPath}")"`,
            'cat "${rendered}"',
            'rm -f "${rendered}"'
          ],
          {
            GITHUB_API_URL: "https://api.github.com",
            GITHUB_ORG: "example",
            RUNNER_GROUP: "group",
            RUNNER_LABELS: "self-hosted,macos",
            RUNNER_NAME: "slot-01",
            RUNNER_ROOT: "/Users/runner/actions-runner",
            RUNNER_WORK_DIR: "/Users/runner/work",
            ...env
          }
        );
      } finally {
        fs.rmSync(directory, { force: true, recursive: true });
      }
    }

    test("passes the manifest digest for the canonical version to the guest", () => {
      const version = readCanonicalRunnerVersion();
      const expected = readRunnerChecksums().get(`actions-runner-osx-arm64-${version}.tar.gz`);
      const result = renderGuestEnv({ RUNNER_VERSION: version });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`RUNNER_SHA256=${expected}\n`);
    });

    test("fails closed for a version the manifest does not cover", () => {
      const result = renderGuestEnv({ RUNNER_VERSION: "1.0.0" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("no SHA-256 for actions-runner-osx-arm64-1.0.0.tar.gz");
      expect(result.stdout).not.toContain("GITHUB_PAT=");
    });

    test("honours an explicit RUNNER_SHA256 for a per-pool version override", () => {
      const fromHost = renderGuestEnv({ RUNNER_VERSION: "1.0.0", RUNNER_SHA256: DIGEST_A });
      expect(fromHost.status, fromHost.stderr).toBe(0);
      expect(fromHost.stdout).toContain(`RUNNER_SHA256=${DIGEST_A}\n`);

      const fromEnvFile = renderGuestEnv(
        { RUNNER_VERSION: "1.0.0" },
        `GITHUB_PAT=test\nRUNNER_SHA256=${DIGEST_B}\n`
      );
      expect(fromEnvFile.status, fromEnvFile.stderr).toBe(0);
      expect(fromEnvFile.stdout).toContain(`RUNNER_SHA256=${DIGEST_B}\n`);
    });
  });
});
