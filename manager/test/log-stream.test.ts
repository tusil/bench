import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { stopLogProcess } from "../server/utils/log-stream";

describe("log process cleanup", () => {
  it("terminates the detached process group", () => {
    const child = {
      pid: 123,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
      once: vi.fn(),
    } as unknown as ChildProcess;
    const killProcess = vi.fn(() => true);

    stopLogProcess(child, killProcess);

    expect(killProcess).toHaveBeenCalledWith(-123, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("does nothing after the process has exited", () => {
    const child = {
      pid: 123,
      exitCode: 0,
      signalCode: null,
      kill: vi.fn(),
      once: vi.fn(),
    } as unknown as ChildProcess;
    const killProcess = vi.fn(() => true);

    stopLogProcess(child, killProcess);

    expect(killProcess).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
