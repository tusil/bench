import { spawnSync } from "node:child_process";
import { BenchError } from "./errors.js";
import type { CommandRunner } from "./types.js";

function failure(command: string, status: number | null, stderr?: string): BenchError {
  const detail = stderr?.trim();
  return new BenchError(
    `Command failed (${status ?? "unknown"}): ${command}${detail ? `\n${detail}` : ""}`,
  );
}

export class SystemCommandRunner implements CommandRunner {
  capture(command: string, args: string[], cwd?: string): string {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    if (result.error) {
      throw new BenchError(`Failed to run ${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw failure([command, ...args].join(" "), result.status, result.stderr);
    }
    return result.stdout.trim();
  }

  captureShell(command: string, cwd: string): string {
    return this.capture("/bin/sh", ["-c", command], cwd);
  }

  interactiveShell(command: string, cwd: string): void {
    this.interactive("/bin/sh", ["-c", command], cwd);
  }

  interactive(command: string, args: string[], cwd?: string): void {
    const result = spawnSync(command, args, { cwd, stdio: "inherit" });
    if (result.error) {
      throw new BenchError(`Failed to run ${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw failure([command, ...args].join(" "), result.status);
    }
  }
}
