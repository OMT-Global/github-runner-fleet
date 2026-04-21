import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("Dockerfile packaging", () => {
  test("installs procps when the healthcheck uses pgrep", () => {
    const dockerfile = fs.readFileSync(
      path.resolve("docker/Dockerfile"),
      "utf8"
    );

    expect(dockerfile).toContain('CMD pgrep -f "Runner.Listener" > /dev/null || exit 1');
    expect(dockerfile).toMatch(/\bprocps\b/);
  });

  test("pins the shell-runner toolchain and Actions cache paths", () => {
    const dockerfile = fs.readFileSync(
      path.resolve("docker/Dockerfile"),
      "utf8"
    );

    expect(dockerfile).toContain("FROM --platform=$TARGETPLATFORM python:3.12-slim-bookworm");
    expect(dockerfile).toContain("ARG NODE_VERSION=18.20.8");
    expect(dockerfile).toContain("ARG TERRAFORM_VERSION=1.6.6");
    expect(dockerfile).toContain("RUNNER_TEMP=/tmp/github-runner-temp");
    expect(dockerfile).toContain("RUNNER_TOOL_CACHE=/opt/hostedtoolcache");
    expect(dockerfile).toContain("AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache");
    expect(dockerfile).toContain(
      "COPY scripts/lib/github-runner-common.sh /usr/local/lib/github-runner-common.sh"
    );
    expect(dockerfile).toContain("COPY docker/runner-entrypoint.sh /usr/local/bin/runner-entrypoint.sh");
    expect(dockerfile).toContain('python_cache_root="${RUNNER_TOOL_CACHE}/Python/${python_version}"');
    expect(dockerfile).toContain('ln -sfn /usr/local "${python_cache_root}/${python_arch}"');
    expect(dockerfile).toContain(': > "${python_cache_root}/${python_arch}.complete"');
    expect(dockerfile).toMatch(/\btar\b/);
    expect(dockerfile).toMatch(/\bzstd\b/);
    expect(dockerfile).toContain("node-v${NODE_VERSION}-linux-${node_arch}.tar.xz");
    expect(dockerfile).toContain(
      "terraform_${TERRAFORM_VERSION}_linux_${terraform_arch}.zip"
    );
  });

  test("adds a Windows Server Core runner image with PowerShell entrypoint", () => {
    const dockerfile = fs.readFileSync(
      path.resolve("docker/Dockerfile.windows"),
      "utf8"
    );

    expect(dockerfile).toContain("mcr.microsoft.com/windows/servercore:ltsc2022");
    expect(dockerfile).toContain("ARG RUNNER_VERSION=2.333.0");
    expect(dockerfile).toContain("choco install -y git nodejs-lts powershell-core");
    expect(dockerfile).toContain("actions-runner-win-x64-");
    expect(dockerfile).toContain("COPY docker/runner-entrypoint.ps1 C:/runner-entrypoint.ps1");
    expect(dockerfile).toContain("ENTRYPOINT");
  });
});
