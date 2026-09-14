export interface SystemConfig {
  domain: string;
  network: string;
  caddyContainer: string;
  generatedDirectory: string;
}

export interface ProjectRoute {
  service: string;
  port: number;
  domain: string;
  alias: string;
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
}

export interface CommandRunner {
  capture(command: string, args: string[], cwd?: string): string;
  captureShell(command: string, cwd: string): string;
  interactiveShell(command: string, cwd: string): void;
  interactive(command: string, args: string[], cwd?: string): void;
}
