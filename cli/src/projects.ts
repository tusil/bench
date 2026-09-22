import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fragmentOwner, fragmentPath, readFragment } from "./caddy.js";
import { loadProjectConfig } from "./project.js";
import type { CommandRunner, ProjectConfig, ProjectSummary, ProjectState, SystemConfig } from "./types.js";

export interface ProjectDirectory {
  id: string;
  root: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectState(
  project: ProjectConfig,
  system: SystemConfig,
  runner: CommandRunner,
): { state: ProjectState; error?: string } {
  try {
    const serviceCounts = [...new Set(project.routes.map((route) => route.service))].map((service) => ({
      service,
      count: runner.captureShell(`${project.commands.compose} ps -q ${service}`, project.root)
        .split(/\s+/)
        .filter(Boolean).length,
    }));
    const fragment = readFragment(fragmentPath(system.generatedDirectory, project));
    const fragmentIsOwned = fragment !== null && fragmentOwner(fragment) === project.root;
    const allRunning = serviceCounts.every(({ count }) => count === 1);
    const allStopped = serviceCounts.every(({ count }) => count === 0);

    if (allRunning && fragmentIsOwned) return { state: "running" };
    if (allStopped && fragment === null) return { state: "stopped" };

    const details: string[] = [];
    for (const { service, count } of serviceCounts) {
      if (count !== 1) details.push(`${service}: ${count} running containers`);
    }
    if (fragment !== null && !fragmentIsOwned) details.push("Caddy route is owned by another directory");
    if (fragment === null && !allStopped) details.push("Caddy route is missing");
    if (fragmentIsOwned && allStopped) details.push("Caddy route exists but services are stopped");
    return { state: "degraded", error: details.join("; ") || "Project state is inconsistent" };
  } catch (error) {
    return { state: "degraded", error: message(error) };
  }
}

export function discoverProjectDirectories(system: SystemConfig): ProjectDirectory[] {
  return readdirSync(system.projectsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): ProjectDirectory[] => {
      const root = join(system.projectsDirectory, entry.name);
      return existsSync(join(root, "bench.yml")) ? [{ id: entry.name, root }] : [];
    });
}

export function listProjects(system: SystemConfig, runner: CommandRunner): ProjectSummary[] {
  return discoverProjectDirectories(system).map(({ id, root }): ProjectSummary => {
    try {
      const project = loadProjectConfig(root, system.domain);
      const status = projectState(project, system, runner);
      const workspaces = project.workspace ? [] : readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".code-workspace"));
      return {
        id,
        root,
        name: project.name,
        workspace: project.workspace ?? (workspaces.length === 1 ? workspaces[0]?.name : undefined),
        routes: project.routes.map((route) => `https://${route.domain}`),
        ...status,
      };
    } catch (error) {
      return {
        id,
        root,
        routes: [],
        state: "invalid",
        error: message(error),
      };
    }
  });
}
