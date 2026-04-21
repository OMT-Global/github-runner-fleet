import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import YAML from "yaml";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "../src/lib/config.js";
import type { DeploymentEnv } from "../src/lib/env.js";

const propertyOptions = { numRuns: 40 };
const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("loadConfig property validation", () => {
  test("rejects pool sizes below one", () => {
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (size) => {
        expect(() => loadPoolConfig({ size })).toThrow();
      }),
      propertyOptions
    );
  });

  test("rejects non-integer pool sizes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (size) => {
        expect(() => loadPoolConfig({ size: size + 0.5 })).toThrow();
      }),
      propertyOptions
    );
  });

  test("rejects pool keys containing control characters", () => {
    fc.assert(
      fc.property(fc.constantFrom("\0", "\n", "\r", "\t"), (badChar) => {
        expect(() => loadPoolConfig({ key: `pool${badChar}name` })).toThrow();
      }),
      propertyOptions
    );
  });

  test("rejects labels outside the shell-safe label pattern", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", "bad label", "bad/label", "bad:label", "snowman-☃"),
        (label) => {
          expect(() => loadPoolConfig({ labels: ["shell-safe", label] })).toThrow();
        }
      ),
      propertyOptions
    );
  });

  test("keeps generated shell-safe labels and injects required labels once", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Za-z0-9._-]{1,16}$/), {
          maxLength: 8
        }),
        (labels) => {
          const config = loadPoolConfig({
            visibility: "public",
            labels: ["synology", "shell-only", "public", ...labels]
          });

          expect(config.pools[0].labels).toEqual([
            ...new Set(["synology", "shell-only", "public", ...labels])
          ]);
        }
      ),
      propertyOptions
    );
  });

  test("rejects malformed selected repository names", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", "repo", "example/", "/repo", "example/repo/extra", "bad owner/repo"),
        (repository) => {
          expect(() =>
            loadPoolConfig({
              repositoryAccess: "selected",
              allowedRepositories: [repository]
            })
          ).toThrow();
        }
      ),
      propertyOptions
    );
  });

  test("rejects selected repository access without repositories", () => {
    fc.assert(
      fc.property(fc.constant("selected" as const), (repositoryAccess) => {
        expect(() =>
          loadPoolConfig({ repositoryAccess, allowedRepositories: [] })
        ).toThrow(/allowedRepositories must contain at least one repository/);
      }),
      propertyOptions
    );
  });

  test("rejects allow-lists when repository access is all", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^example\/[A-Za-z0-9_.-]{1,16}$/), {
          minLength: 1,
          maxLength: 5
        }),
        (allowedRepositories) => {
          expect(() =>
            loadPoolConfig({
              repositoryAccess: "all",
              allowedRepositories
            })
          ).toThrow(/allowedRepositories must be omitted/);
        }
      ),
      propertyOptions
    );
  });

  test("rejects selected repositories outside the pool organization", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9_.-]{1,16}$/),
        fc.stringMatching(/^[A-Za-z0-9_.-]{1,16}$/),
        (owner, repo) => {
          fc.pre(owner !== "example");

          expect(() =>
            loadPoolConfig({
              repositoryAccess: "selected",
              allowedRepositories: [`${owner}/${repo}`]
            })
          ).toThrow(/outside organization example/);
        }
      ),
      propertyOptions
    );
  });

  test("rejects malformed CPU resource strings", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", "abc", "-1", "1.", ".5", "1m", "1/2"),
        (cpus) => {
          expect(() =>
            loadPoolConfig({
              resources: {
                cpus
              }
            })
          ).toThrow();
        }
      ),
      propertyOptions
    );
  });

  test("rejects non-positive PID limits", () => {
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (pidsLimit) => {
        expect(() =>
          loadPoolConfig({
            resources: {
              pidsLimit
            }
          })
        ).toThrow();
      }),
      propertyOptions
    );
  });

  test("accepts arbitrary non-empty memory strings", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }).filter((value) => !value.includes("\0")),
        (memory) => {
          const config = loadPoolConfig({
            resources: {
              memory
            }
          });

          expect(config.pools[0].resources.memory).toBe(memory);
        }
      ),
      propertyOptions
    );
  });

  test("uses default interpolation values containing malformed placeholder text", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("${", "${NAME", "${NAME:", "${NAME:-", "${name}", "${NAME-default}"),
        (defaultValue) => {
          const config = loadPoolConfig({
            runnerRoot: `/runners/${"${MISSING:-" + defaultValue + "}"}`
          });

          expect(config.pools[0].runnerRoot).toBe(`/runners/${defaultValue}`);
        }
      ),
      propertyOptions
    );
  });
});

function loadPoolConfig(poolOverrides: Record<string, unknown>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "config-property-"));
  tempPaths.push(directory);
  const configPath = path.join(directory, "pools.yaml");
  const pool = {
    key: "synology-private",
    visibility: "private",
    organization: "example",
    runnerGroup: "synology-private",
    repositoryAccess: "selected",
    allowedRepositories: ["example/private-app"],
    labels: [],
    size: 1,
    architecture: "arm64",
    runnerRoot: "/volume1/docker/github-runner-fleet/pools/synology-private",
    ...poolOverrides
  };

  fs.writeFileSync(
    configPath,
    YAML.stringify({
      version: 1,
      image: {
        repository: "ghcr.io/example/github-runner-fleet",
        tag: "0.1.5"
      },
      pools: [pool]
    }),
    "utf8"
  );

  return loadConfig(configPath, deploymentEnv());
}

function deploymentEnv(): DeploymentEnv {
  return {
    githubApiUrl: "https://api.github.com",
    synologyRunnerBaseDir: "/volume1/docker/github-runner-fleet",
    synologyHost: "nas.example.com",
    synologyPort: "5001",
    synologyUsername: "admin",
    synologyPassword: "secret",
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
    lumeRunnerBaseDir:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume",
    lumeRunnerEnvFile:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/runner.env",
    composeProjectName: "github-runner-fleet",
    runnerVersion: "2.327.1",
    raw: {}
  };
}
