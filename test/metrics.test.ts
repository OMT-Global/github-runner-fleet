import { describe, expect, test, vi } from "vitest";
import {
  doctorCheckResult,
  emitMetrics,
  poolSlotCount,
  renderPrometheusSamples,
  runnerRegistrationTotal,
  runnerTokenFetchDurationSeconds
} from "../src/lib/metrics.js";

describe("metrics", () => {
  test("renders Prometheus-compatible sample lines", () => {
    expect(
      renderPrometheusSamples([
        runnerRegistrationTotal({
          plane: "synology",
          pool: "synology-private",
          status: "ok"
        }),
        runnerTokenFetchDurationSeconds({
          plane: "lume",
          durationSeconds: 0.125
        }),
        poolSlotCount({
          plane: "lume",
          pool: "macos-private",
          count: 3
        }),
        doctorCheckResult({
          check: "lume-config",
          status: "pass"
        })
      ])
    ).toBe(
      [
        'runner_registration_total{plane="synology",pool="synology-private",status="ok"} 1',
        'runner_token_fetch_duration_seconds{plane="lume"} 0.125',
        'pool_slot_count{plane="lume",pool="macos-private"} 3',
        'doctor_check_result{check="lume-config",status="pass"} 1',
        ""
      ].join("\n")
    );
  });

  test("posts metrics only when an endpoint is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202
    });

    await expect(
      emitMetrics(
        [
          doctorCheckResult({
            check: "synology-env",
            status: "fail"
          })
        ],
        {
          endpoint: "https://metrics.example.test/ingest",
          fetchImpl: fetchMock
        }
      )
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://metrics.example.test/ingest",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8"
        }),
        body: 'doctor_check_result{check="synology-env",status="fail"} 1\n'
      })
    );
  });

  test("is a no-op without a metrics endpoint", async () => {
    const fetchMock = vi.fn();

    await expect(
      emitMetrics(
        [
          doctorCheckResult({
            check: "synology-env",
            status: "fail"
          })
        ],
        {
          endpoint: "",
          fetchImpl: fetchMock
        }
      )
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
