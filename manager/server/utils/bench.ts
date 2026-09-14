import { execFile } from "node:child_process";
import type {
  ActionResponse,
  ProjectState,
  ProjectSummary,
  ProjectsResponse,
} from "~~/shared/types/projects";

interface CliProject extends ProjectSummary {
  root: string;
}

export type BenchExecutor = (args: string[], cwd?: string) => Promise<string>;

export class ManagerError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
  ) {
    super(message);
  }
}

function isState(value: unknown): value is ProjectState {
  return value === "running" || value === "stopped" || value === "degraded" || value === "invalid";
}

function parseProject(value: unknown): CliProject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManagerError("bench list returned an invalid project");
  }
  const project = value as Record<string, unknown>;
  if (
    typeof project.id !== "string"
    || typeof project.root !== "string"
    || (project.name !== undefined && typeof project.name !== "string")
    || !Array.isArray(project.routes)
    || !project.routes.every((route) => typeof route === "string")
    || !isState(project.state)
    || (project.error !== undefined && typeof project.error !== "string")
  ) {
    throw new ManagerError("bench list returned an invalid project");
  }
  return {
    id: project.id,
    root: project.root,
    name: project.name,
    routes: project.routes,
    state: project.state,
    error: project.error,
  };
}

export function parseProjectList(output: string): CliProject[] {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new ManagerError("bench list returned invalid JSON");
  }
  if (typeof value !== "object" || value === null || !Array.isArray((value as Record<string, unknown>).projects)) {
    throw new ManagerError("bench list returned an invalid response");
  }
  return ((value as { projects: unknown[] }).projects).map(parseProject);
}

export const executeBench: BenchExecutor = (args, cwd) => new Promise((resolve, reject) => {
  execFile(
    process.env.BENCH_CLI_PATH || "/usr/local/bin/bench",
    args,
    { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 },
    (error, stdout, stderr) => {
      if (error) {
        reject(new ManagerError(stderr.trim() || error.message));
        return;
      }
      resolve(stdout.trim());
    },
  );
});

export function createProjectService(execute: BenchExecutor = executeBench) {
  let actionInProgress = false;

  async function rawProjects(): Promise<CliProject[]> {
    return parseProjectList(await execute(["list", "--json"]));
  }

  return {
    async list(): Promise<ProjectsResponse> {
      const projects = (await rawProjects()).map(({ root: _root, ...project }) => project);
      return { projects };
    },

    async action(id: string, action: "up" | "down"): Promise<ActionResponse> {
      if (!id || id.includes("/") || id === "." || id === "..") {
        throw new ManagerError("Project not found", 404);
      }
      if (actionInProgress) {
        throw new ManagerError("Another project operation is already running", 409);
      }

      actionInProgress = true;
      try {
        const project = (await rawProjects()).find((candidate) => candidate.id === id);
        if (!project) throw new ManagerError("Project not found", 404);
        if (project.state === "invalid") {
          throw new ManagerError(project.error || "Project configuration is invalid", 409);
        }
        const output = await execute([action], project.root);
        return { message: output || `Project ${project.name || project.id} ${action === "up" ? "started" : "stopped"}.` };
      } finally {
        actionInProgress = false;
      }
    },
  };
}

export const projectService = createProjectService();
