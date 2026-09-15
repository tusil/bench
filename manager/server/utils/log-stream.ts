import type { ChildProcess } from "node:child_process";

type LogProcess = Pick<ChildProcess, "pid" | "exitCode" | "signalCode" | "kill" | "once">;
type ProcessKiller = (pid: number, signal: NodeJS.Signals) => boolean;

export function stopLogProcess(
  child: LogProcess,
  killProcess: ProcessKiller = process.kill,
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const pid = child.pid;
  try {
    if (pid === undefined) {
      child.kill("SIGTERM");
    } else {
      killProcess(-pid, "SIGTERM");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGTERM");
  }

  const forceKill = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (pid === undefined) child.kill("SIGKILL");
      else killProcess(-pid, "SIGKILL");
    } catch {
      // The process group has already exited.
    }
  }, 2_000);
  forceKill.unref();
  child.once("close", () => clearTimeout(forceKill));
}
