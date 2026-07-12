import { describe, expect, test, vi } from "vitest";
import { runBoundedCommand, sshTransportArgs } from "../src/lib/process.js";

describe("bounded process execution", () => {
  test("sets a finite timeout and returns stdout", () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: "ok\n", stderr: "", error: undefined }));
    expect(runBoundedCommand("ssh", ["runner@host"], "failed", { spawn: spawn as never, timeoutMs: 1234 })).toBe("ok\n");
    expect(spawn).toHaveBeenCalledWith("ssh", ["runner@host"], expect.objectContaining({ timeout: 1234, killSignal: "SIGTERM" }));
  });

  test("reports timeout context without retrying", () => {
    const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    const spawn = vi.fn(() => ({ status: null, stdout: "", stderr: "", error }));
    expect(() => runBoundedCommand("scp", ["file", "runner@host:/tmp"], "upload failed", {
      spawn: spawn as never, timeoutMs: 50, now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(175)
    })).toThrow("operation=scp target=runner@host:/tmp elapsed_ms=75 retries=0 timeout_ms=50 timed_out=true");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test("does not retry non-timeout failures", () => {
    const spawn = vi.fn(() => ({ status: 23, stdout: "", stderr: "permission denied", error: undefined }));
    expect(() => runBoundedCommand("ssh", ["runner@host"], "remote failed", { spawn: spawn as never })).toThrow("permission denied");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test("accepts a successful command that closes stdin early", () => {
    const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    const spawn = vi.fn(() => ({ status: 0, stdout: "", stderr: "", error }));
    expect(runBoundedCommand("true", [], "installer failed", { spawn: spawn as never, input: "plan" })).toBe("");
  });

  test("uses noninteractive SSH liveness options", () => {
    expect(sshTransportArgs(9)).toEqual(expect.arrayContaining(["BatchMode=yes", "ConnectTimeout=9", "ServerAliveInterval=15", "ServerAliveCountMax=2"]));
  });
});
