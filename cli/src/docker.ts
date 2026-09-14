import { BenchError } from "./errors.js";
import type { CommandRunner, ProjectConfig, SystemConfig } from "./types.js";

export function validateComposeServices(project: ProjectConfig, runner: CommandRunner): void {
  const services = new Set(
    runner.captureShell(`${project.commands.compose} config --services`, project.root).split(/\s+/).filter(Boolean),
  );
  for (const route of project.routes) {
    if (!services.has(route.service)) {
      throw new BenchError(`Service "${route.service}" does not exist in docker-compose.yml`);
    }
  }
}

export function runningContainers(project: ProjectConfig, runner: CommandRunner): Map<string, string> {
  const result = new Map<string, string>();
  for (const service of new Set(project.routes.map((route) => route.service))) {
    const ids = runner.captureShell(`${project.commands.compose} ps -q ${service}`, project.root)
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length === 0) throw new BenchError(`Service "${service}" is not running`);
    if (ids.length > 1) throw new BenchError(`Service "${service}" has multiple running containers`);
    result.set(service, ids[0]!);
  }
  return result;
}

export function connectContainers(
  project: ProjectConfig,
  system: SystemConfig,
  containers: Map<string, string>,
  runner: CommandRunner,
  connected: string[],
): void {
  for (const [service, container] of containers) {
    const route = project.routes.find((candidate) => candidate.service === service)!;
    const raw = runner.capture("docker", ["inspect", "--format", "{{json .NetworkSettings.Networks}}", container]);
    const networks = JSON.parse(raw) as Record<string, { Aliases?: string[] | null }>;
    const existing = networks[system.network];
    if (existing) {
      if (!existing.Aliases?.includes(route.alias)) {
        throw new BenchError(
          `Service "${service}" is already connected to ${system.network} without alias ${route.alias}`,
        );
      }
      continue;
    }
    runner.interactive("docker", ["network", "connect", "--alias", route.alias, system.network, container]);
    connected.push(container);
  }
}

export function disconnectContainers(network: string, containers: string[], runner: CommandRunner): void {
  for (const container of containers.reverse()) {
    try {
      runner.interactive("docker", ["network", "disconnect", network, container]);
    } catch {
      // Preserve the original failure; the user receives a manual cleanup command.
    }
  }
}

export function validateCaddy(system: SystemConfig, runner: CommandRunner): void {
  runner.interactive("docker", [
    "exec", system.caddyContainer, "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile",
  ]);
}

export function reloadCaddy(system: SystemConfig, runner: CommandRunner): void {
  runner.interactive("docker", [
    "exec", system.caddyContainer, "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile",
  ]);
}
