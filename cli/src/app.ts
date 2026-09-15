import { unlinkSync } from "node:fs";
import {
  assertFragmentAvailable,
  assertFragmentOwned,
  atomicWrite,
  fragmentPath,
  readFragment,
  renderFragment,
  restoreFragment,
} from "./caddy.js";
import { BenchError } from "./errors.js";
import {
  connectContainers,
  disconnectContainers,
  reloadCaddy,
  runningContainers,
  validateCaddy,
  validateComposeServices,
} from "./docker.js";
import type { CommandRunner, ProjectConfig, SystemConfig } from "./types.js";

function rollbackFragment(path: string, previous: string | null, system: SystemConfig, runner: CommandRunner): void {
  restoreFragment(path, previous);
  try {
    validateCaddy(system, runner);
    reloadCaddy(system, runner);
  } catch {
    // Preserve the original failure; the restored file remains authoritative for the next restart.
  }
}

export function up(
  project: ProjectConfig,
  system: SystemConfig,
  runner: CommandRunner,
  output: (message: string) => void,
): void {
  validateComposeServices(project, runner);
  assertFragmentAvailable(system.generatedDirectory, project);
  const path = fragmentPath(system.generatedDirectory, project);
  const previous = readFragment(path);
  const connected: string[] = [];
  let fragmentChanged = false;

  try {
    runner.interactiveShell(project.commands.up, project.root);
    const containers = runningContainers(project, runner);
    connectContainers(project, system, containers, runner, connected);
    atomicWrite(path, renderFragment(project));
    fragmentChanged = true;
    validateCaddy(system, runner);
    reloadCaddy(system, runner);
  } catch (error) {
    if (fragmentChanged) rollbackFragment(path, previous, system, runner);
    disconnectContainers(system.network, connected, runner);
    const reason = error instanceof Error ? error.message : String(error);
    throw new BenchError(`${reason}\nProject containers were left running; use the configured down command if needed.`);
  }

  output(`Project ${project.name} started.\n\nRoutes:\n${project.routes.map((route) => `  https://${route.domain}`).join("\n")}`);
}

export function down(
  project: ProjectConfig,
  system: SystemConfig,
  runner: CommandRunner,
  output: (message: string) => void,
): void {
  assertFragmentOwned(system.generatedDirectory, project);
  const path = fragmentPath(system.generatedDirectory, project);
  const previous = readFragment(path);

  if (previous !== null) {
    unlinkSync(path);
    try {
      validateCaddy(system, runner);
      reloadCaddy(system, runner);
    } catch (error) {
      rollbackFragment(path, previous, system, runner);
      throw error;
    }
  }

  try {
    runner.interactiveShell(project.commands.down, project.root);
  } catch (error) {
    if (previous !== null) rollbackFragment(path, previous, system, runner);
    throw error;
  }
  output(`Project ${project.name} stopped.`);
}

export function logs(
  project: ProjectConfig,
  runner: CommandRunner,
  tail: number,
  follow: boolean,
): void {
  const followFlag = follow ? " --follow" : "";
  runner.interactiveShell(
    `${project.commands.compose} logs --no-color --timestamps --tail ${tail}${followFlag}`,
    project.root,
  );
}
