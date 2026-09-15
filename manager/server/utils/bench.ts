import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  ActionResponse,
  ProjectOperationEvent,
  ProjectState,
  ProjectSummary,
  ProjectsResponse,
  StartOperationResponse,
} from "~~/shared/types/projects";
import { ProjectOperationRegistry } from "./operations";

interface CliProject extends ProjectSummary {
  root: string;
}

export type BenchExecutor = (args: string[], cwd?: string) => Promise<string>;
export type BenchProcessSpawner = (args: string[], cwd: string) => ChildProcessWithoutNullStreams;

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

export const spawnBenchProcess: BenchProcessSpawner = (args, cwd) => {
  const child = spawn(
    process.env.BENCH_CLI_PATH || "/usr/local/bin/bench",
    args,
    { cwd, detached: true, stdio: "pipe" },
  );
  child.stdin.end();
  return child;
};

function validProjectId(id: string): boolean {
  return Boolean(id) && !id.includes("/") && id !== "." && id !== "..";
}

function assertProjectId(id: string): void {
  if (!validProjectId(id)) throw new ManagerError("Project not found", 404);
}

export function createProjectService(
  execute: BenchExecutor = executeBench,
  spawnProcess: BenchProcessSpawner = spawnBenchProcess,
  operations = new ProjectOperationRegistry(),
) {
  let activeLifecycleOperation: symbol | undefined;

  function acquireLifecycleOperation(): symbol {
    if (activeLifecycleOperation) {
      throw new ManagerError("Another project operation is already running", 409);
    }
    const token = Symbol("lifecycle operation");
    activeLifecycleOperation = token;
    return token;
  }

  function releaseLifecycleOperation(token: symbol): void {
    if (activeLifecycleOperation === token) activeLifecycleOperation = undefined;
  }

  async function rawProjects(): Promise<CliProject[]> {
    return parseProjectList(await execute(["list", "--json"]));
  }

  async function findProject(id: string): Promise<CliProject> {
    assertProjectId(id);
    const project = (await rawProjects()).find((candidate) => candidate.id === id);
    if (!project) throw new ManagerError("Project not found", 404);
    return project;
  }

  return {
    async list(): Promise<ProjectsResponse> {
      const projects = (await rawProjects()).map(({ root: _root, ...project }) => project);
      return { projects };
    },

    async action(id: string, action: "up" | "down", routeOrigin?: string): Promise<ActionResponse> {
      assertProjectId(id);
      if (routeOrigin && action !== "up") {
        throw new ManagerError("Project routes may only start their own project", 403);
      }
      const token = acquireLifecycleOperation();
      try {
        const project = await findProject(id);
        if (routeOrigin && !project.routes.includes(routeOrigin)) {
          throw new ManagerError("Project route does not match this project", 403);
        }
        if (project.state === "invalid") {
          throw new ManagerError(project.error || "Project configuration is invalid", 409);
        }
        const output = await execute([action], project.root);
        return { message: output || `Project ${project.name || project.id} ${action === "up" ? "started" : "stopped"}.` };
      } finally {
        releaseLifecycleOperation(token);
      }
    },

    async openLogs(id: string): Promise<ChildProcessWithoutNullStreams> {
      const project = await findProject(id);
      if (project.state === "invalid") {
        throw new ManagerError(project.error || "Project configuration is invalid", 409);
      }
      return spawnProcess(["logs", "--tail", "200", "--follow"], project.root);
    },

    async start(id: string, routeOrigin?: string): Promise<StartOperationResponse> {
      assertProjectId(id);
      const token = acquireLifecycleOperation();
      let processStarted = false;

      try {
        const project = await findProject(id);
        if (routeOrigin && !project.routes.includes(routeOrigin)) {
          throw new ManagerError("Project route does not match this project", 403);
        }
        if (project.state === "invalid") {
          throw new ManagerError(project.error || "Project configuration is invalid", 409);
        }

        const operationId = operations.create(project.id);
        let child: ChildProcessWithoutNullStreams;
        try {
          child = spawnProcess(["up"], project.root);
        } catch (error) {
          operations.remove(operationId);
          throw error;
        }

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (text: string) => {
          operations.append(operationId, { stream: "stdout", text });
        });
        child.stderr.on("data", (text: string) => {
          operations.append(operationId, { stream: "stderr", text });
        });

        let settled = false;
        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          operations.complete(operationId, {
            event: "failure",
            data: { message: error.message },
          });
          releaseLifecycleOperation(token);
        });
        child.once("close", (code, signal) => {
          if (settled) return;
          settled = true;
          operations.complete(operationId, {
            event: "end",
            data: { code, signal },
          });
          releaseLifecycleOperation(token);
        });

        processStarted = true;
        return { operationId };
      } finally {
        if (!processStarted) releaseLifecycleOperation(token);
      }
    },

    observeOperation(
      projectId: string,
      operationId: string,
      listener: (event: ProjectOperationEvent) => void,
    ) {
      assertProjectId(projectId);
      const subscription = operations.subscribe(projectId, operationId, listener);
      if (!subscription) throw new ManagerError("Start operation not found", 404);
      return subscription;
    },
  };
}

export const projectService = createProjectService();
