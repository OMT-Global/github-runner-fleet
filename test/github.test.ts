import { describe, expect, test, vi } from "vitest";
import {
  buildRegistrationTokenRequest,
  buildRemoveTokenRequest,
  fetchLatestRunnerRelease,
  fetchRunnerToken
} from "../src/lib/github.js";

describe("github runner API helpers", () => {
  test("builds organization token endpoints", () => {
    const registration = buildRegistrationTokenRequest(
      "https://api.github.com",
      "example",
      "secret"
    );
    const removal = buildRemoveTokenRequest(
      "https://api.github.com",
      "example",
      "secret"
    );

    expect(registration.url).toBe(
      "https://api.github.com/orgs/example/actions/runners/registration-token"
    );
    expect(removal.url).toBe(
      "https://api.github.com/orgs/example/actions/runners/remove-token"
    );
    expect(registration.headers.Authorization).toBe("Bearer secret");
  });

  test("parses runner token responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ token: "registration-token" })
    });

    await expect(
      fetchRunnerToken(
        buildRegistrationTokenRequest(
          "https://api.github.com",
          "example",
          "secret"
        ),
        fetchMock
      )
    ).resolves.toBe("registration-token");
  });

  test("parses latest runner release metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          tag_name: "v2.327.1",
          published_at: "2026-03-25T00:00:00Z",
          html_url: "https://github.com/actions/runner/releases/tag/v2.327.1"
        })
    });

    await expect(fetchLatestRunnerRelease(undefined, undefined, fetchMock)).resolves
      .toMatchObject({
        version: "2.327.1",
        publishedAt: "2026-03-25T00:00:00Z"
      });
  });

  test("throws on non-ok token response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Bad credentials"
    });

    await expect(
      fetchRunnerToken(
        buildRegistrationTokenRequest("https://api.github.com", "example", "bad"),
        fetchMock
      )
    ).rejects.toThrow(/failed with 401/);
  });

  test("throws when token field is missing from response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({})
    });

    await expect(
      fetchRunnerToken(
        buildRegistrationTokenRequest("https://api.github.com", "example", "secret"),
        fetchMock
      )
    ).rejects.toThrow(/did not include a token/);
  });

  test("throws on non-ok release response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found"
    });

    await expect(
      fetchLatestRunnerRelease("https://api.github.com", "secret", fetchMock)
    ).rejects.toThrow(/failed with 404/);
  });
});
