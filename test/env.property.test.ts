import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { loadDeploymentEnv } from "../src/lib/env.js";

const propertyOptions = { numRuns: 40 };
const booleanKeys = [
  "SYNOLOGY_SECURE",
  "SYNOLOGY_CERT_VERIFY",
  "SYNOLOGY_INSTALL_PULL_IMAGES",
  "SYNOLOGY_INSTALL_FORCE_RECREATE",
  "SYNOLOGY_INSTALL_REMOVE_ORPHANS",
  "LINUX_DOCKER_INSTALL_PULL_IMAGES",
  "LINUX_DOCKER_INSTALL_FORCE_RECREATE",
  "LINUX_DOCKER_INSTALL_REMOVE_ORPHANS"
];
const truthyValues = ["1", "true", "TRUE", " yes ", "On"];
const falseyValues = ["0", "false", "FALSE", " no ", "Off"];

describe("loadDeploymentEnv property validation", () => {
  test("accepts supported truthy boolean spellings", () => {
    fc.assert(
      fc.property(fc.constantFrom(...truthyValues), (value) => {
        const env = withEnv({ SYNOLOGY_SECURE: value }, () =>
          loadDeploymentEnv({
            envPath: "/nonexistent/.env",
            requirePat: false
          })
        );

        expect(env.synologySecure).toBe(true);
        expect(env.raw.SYNOLOGY_SECURE).toBe("true");
      }),
      propertyOptions
    );
  });

  test("accepts supported falsey boolean spellings", () => {
    fc.assert(
      fc.property(fc.constantFrom(...falseyValues), (value) => {
        const env = withEnv(
          {
            SYNOLOGY_SECURE: value,
            SYNOLOGY_PORT: undefined
          },
          () =>
            loadDeploymentEnv({
              envPath: "/nonexistent/.env",
              requirePat: false
            })
        );

        expect(env.synologySecure).toBe(false);
        expect(env.synologyPort).toBe("5000");
        expect(env.raw.SYNOLOGY_SECURE).toBe("false");
      }),
      propertyOptions
    );
  });

  test("rejects arbitrary unsupported boolean values for every boolean option", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...booleanKeys),
        fc
          .string({ minLength: 1, maxLength: 24 })
          .filter((value) => !isSupportedBoolean(value) && !value.includes("\0")),
        (key, value) => {
          expect(() =>
            withEnv({ [key]: value }, () =>
              loadDeploymentEnv({
                envPath: "/nonexistent/.env",
                requirePat: false
              })
            )
          ).toThrow(/invalid boolean value/);
        }
      ),
      propertyOptions
    );
  });

  test("strips any run of trailing slashes from the GitHub API URL", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9._~-]{1,24}$/),
        fc.integer({ min: 1, max: 8 }),
        (segment, slashCount) => {
          const baseUrl = `https://ghe.example.com/api/${segment}`;
          const env = withEnv(
            {
              GITHUB_API_URL: `${baseUrl}${"/".repeat(slashCount)}`
            },
            () =>
              loadDeploymentEnv({
                envPath: "/nonexistent/.env",
                requirePat: false
              })
          );

          expect(env.githubApiUrl).toBe(baseUrl);
          expect(env.raw.GITHUB_API_URL).toBe(baseUrl);
        }
      ),
      propertyOptions
    );
  });

  test("expands home-relative Linux runner base directories", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9._-]{1,24}$/), (segment) => {
        const env = withEnv(
          {
            LINUX_DOCKER_RUNNER_BASE_DIR: `~/${segment}`
          },
          () =>
            loadDeploymentEnv({
              envPath: "/nonexistent/.env",
              requirePat: false
            })
        );

        expect(env.linuxDockerRunnerBaseDir).toBe(pathFromHome(segment));
        expect(env.linuxDockerProjectDir).toBe(pathFromHome(segment));
      }),
      propertyOptions
    );
  });

  test("round-trips arbitrary non-empty compose project names", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((value) => !value.includes("\0")),
        (composeProjectName) => {
          const env = withEnv({ COMPOSE_PROJECT_NAME: composeProjectName }, () =>
            loadDeploymentEnv({
              envPath: "/nonexistent/.env",
              requirePat: false
            })
          );

          expect(env.composeProjectName).toBe(composeProjectName);
          expect(env.raw.COMPOSE_PROJECT_NAME).toBe(composeProjectName);
        }
      ),
      propertyOptions
    );
  });
});

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => T
): T {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function isSupportedBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return [
    "1",
    "true",
    "yes",
    "on",
    "0",
    "false",
    "no",
    "off"
  ].includes(normalized);
}

function pathFromHome(segment: string): string {
  return path.join(os.homedir(), segment);
}
