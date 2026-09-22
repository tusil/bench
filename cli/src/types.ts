export interface SystemConfig {
  domain: string;
  network: string;
  caddyContainer: string;
  generatedDirectory: string;
  projectsDirectory: string;
}

export interface ProjectRoute {
  service: string;
  port: number;
  domain: string;
  alias: string;
  preserveHost: boolean;
}

export interface ProjectCommands {
  compose: string;
  up: string;
  down: string;
}

export interface ProjectConfig {
  name: string;
  root: string;
  routes: ProjectRoute[];
  commands: ProjectCommands;
  workspace?: string;
}

export interface CommandRunner {
  capture(command: string, args: string[], cwd?: string): string;
  captureShell(command: string, cwd: string): string;
  interactiveShell(command: string, cwd: string): void;
  interactive(command: string, args: string[], cwd?: string): void;
}

export type ProjectState = "running" | "stopped" | "degraded" | "invalid";

export interface ProjectSummary {
  id: string;
  root: string;
  name?: string;
  workspace?: string;
  routes: string[];
  state: ProjectState;
  error?: string;
}

export interface CapacityUsage {
  usedBytes: number;
  totalBytes: number;
}

export interface SystemResourceUsage {
  cpu: {
    usagePercent: number;
    logicalCores: number;
  };
  memory: CapacityUsage;
  swap: CapacityUsage;
  disk: CapacityUsage;
}

export type ProjectResourceUsage =
  | {
      id: string;
      available: true;
      cpuPercent: number;
      memoryUsedBytes: number;
      containerCount: number;
    }
  | {
      id: string;
      available: false;
    };

export interface ResourcesResponse {
  sampledAt: string;
  system: SystemResourceUsage;
  projects: ProjectResourceUsage[];
}
