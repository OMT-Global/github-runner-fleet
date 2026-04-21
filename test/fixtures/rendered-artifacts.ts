import type { ResolvedConfig } from "../../src/lib/config.js";
import type { DeploymentEnv } from "../../src/lib/env.js";
import type { ResolvedLinuxDockerConfig } from "../../src/lib/linux-docker-config.js";
import type { ResolvedWindowsDockerConfig } from "../../src/lib/windows-config.js";

export function synologyConfigFixture(): ResolvedConfig {
  return {
    version: 1,
    image: {
      repository: "ghcr.io/example/github-runner-fleet",
      tag: "0.1.9"
    },
    pools: [
      {
        key: "synology-private",
        visibility: "private",
        organization: "example",
        runnerGroup: "synology-private",
        repositoryAccess: "all",
        allowedRepositories: [],
        labels: ["synology", "shell-only", "private"],
        size: 2,
        architecture: "auto",
        runnerRoot: "/volume1/docker/github-runner-fleet/pools/synology-private",
        resources: {
          memory: "2g"
        },
        imageRef: "ghcr.io/example/github-runner-fleet:0.1.9"
      },
      {
        key: "synology-public",
        visibility: "public",
        organization: "example",
        runnerGroup: "synology-public",
        repositoryAccess: "selected",
        allowedRepositories: ["example/public-demo"],
        labels: ["synology", "shell-only", "public"],
        size: 1,
        architecture: "arm64",
        runnerRoot: "/volume1/docker/github-runner-fleet/pools/synology-public",
        resources: {
          cpus: "2",
          memory: "1g",
          pidsLimit: 512
        },
        imageRef: "ghcr.io/example/github-runner-fleet:0.1.9"
      }
    ]
  };
}

export function linuxDockerConfigFixture(): ResolvedLinuxDockerConfig {
  return {
    version: 1,
    image: {
      repository: "ghcr.io/example/github-runner-fleet",
      tag: "0.1.9"
    },
    pools: [
      {
        key: "linux-docker-private",
        visibility: "private",
        organization: "example",
        runnerGroup: "linux-docker-private",
        repositoryAccess: "selected",
        allowedRepositories: ["example/private-app"],
        labels: ["linux", "docker-capable", "private", "x64"],
        size: 2,
        architecture: "amd64",
        runnerRoot: "/srv/github-runner-fleet/linux-docker/pools/linux-docker-private",
        resources: {
          cpus: "4",
          memory: "8g",
          pidsLimit: 1024
        },
        imageRef: "ghcr.io/example/github-runner-fleet:0.1.9"
      }
    ]
  };
}

export function windowsDockerConfigFixture(): ResolvedWindowsDockerConfig {
  return {
    version: 1,
    plane: "windows-docker",
    pools: [
      {
        key: "windows-private",
        visibility: "private",
        organization: "example",
        runnerGroup: "windows-private",
        repositoryAccess: "selected",
        allowedRepositories: ["example/windows-app"],
        labels: ["windows", "docker-capable", "private", "x64"],
        size: 2,
        host: "windows-host.example.com",
        sshUser: "administrator",
        sshPort: "22",
        runnerRoot:
          "C:\\github-runner-fleet\\windows-docker\\pools\\windows-private",
        resources: {
          cpus: "4",
          memory: "8g",
          pidsLimit: 1024
        },
        imageRef: "ghcr.io/example/github-runner-fleet:0.1.9-windows"
      }
    ]
  };
}

export function deploymentEnvFixture(): DeploymentEnv {
  return {
    githubPat: "fixture-token",
    githubApiUrl: "https://api.github.com",
    synologyRunnerBaseDir: "/volume1/docker/github-runner-fleet",
    synologyHost: "nas.example.com",
    synologyPort: "5001",
    synologyUsername: "admin",
    synologyPassword: "fake-password",
    synologySecure: true,
    synologyCertVerify: false,
    synologyDsmVersion: 7,
    synologyApiRepo: "/Users/tester/src/synology-api",
    synologyProjectDir: "/volume1/docker/github-runner-fleet",
    synologyProjectComposeFile: "compose.yaml",
    synologyProjectEnvFile: ".env",
    synologyInstallPullImages: true,
    synologyInstallForceRecreate: true,
    synologyInstallRemoveOrphans: true,
    linuxDockerRunnerBaseDir: "/srv/github-runner-fleet/linux-docker",
    linuxDockerHost: "docker-host.example.com",
    linuxDockerPort: "22",
    linuxDockerUsername: "runner",
    linuxDockerProjectDir: "/srv/github-runner-fleet/linux-docker",
    linuxDockerProjectComposeFile: "compose.yaml",
    linuxDockerProjectEnvFile: ".env",
    linuxDockerInstallPullImages: true,
    linuxDockerInstallForceRecreate: true,
    linuxDockerInstallRemoveOrphans: true,
    windowsDockerRunnerBaseDir: "C:\\github-runner-fleet\\windows-docker",
    windowsDockerHost: "windows-host.example.com",
    windowsDockerPort: "22",
    windowsDockerUsername: "administrator",
    windowsDockerProjectDir: "C:\\github-runner-fleet\\windows-docker",
    windowsDockerProjectComposeFile: "compose.yaml",
    windowsDockerProjectEnvFile: ".env",
    windowsDockerInstallPullImages: true,
    windowsDockerInstallForceRecreate: true,
    windowsDockerInstallRemoveOrphans: true,
    lumeRunnerBaseDir:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume",
    lumeRunnerEnvFile:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/runner.env",
    lumeRunnerIpswPath:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/cache/latest.ipsw",
    composeProjectName: "github-runner-fleet",
    runnerVersion: "2.333.0",
    raw: {
      GITHUB_API_URL: "https://api.github.com",
      SYNOLOGY_RUNNER_BASE_DIR: "/volume1/docker/github-runner-fleet",
      LINUX_DOCKER_RUNNER_BASE_DIR: "/srv/github-runner-fleet/linux-docker",
      WINDOWS_DOCKER_RUNNER_BASE_DIR:
        "C:\\github-runner-fleet\\windows-docker",
      LUME_RUNNER_BASE_DIR:
        "/Users/tester/Library/Application Support/github-runner-fleet/lume",
      LUME_RUNNER_ENV_FILE:
        "/Users/tester/Library/Application Support/github-runner-fleet/lume/runner.env",
      LUME_RUNNER_IPSW_PATH:
        "/Users/tester/Library/Application Support/github-runner-fleet/lume/cache/latest.ipsw",
      COMPOSE_PROJECT_NAME: "github-runner-fleet",
      RUNNER_VERSION: "2.333.0"
    }
  };
}
