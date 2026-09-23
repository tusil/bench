#!/opt/node/bin/node

import { resolve } from "node:path";
import { down, logs, up } from "./app.js";
import { BenchError } from "./errors.js";
import { loadSystemConfig } from "./config.js";
import { initializeProject, validateProjectName, validateTemplateName } from "./init.js";
import { loadProjectConfig } from "./project.js";
import { listProjects } from "./projects.js";
import { collectResources } from "./resources.js";
import { SystemCommandRunner } from "./runner.js";

const version = "0.1.0";
const initUsage = "Usage: bench init [--template <name>] [--name <slug>]";
const help = `Usage: bench <command>

Commands:
  init [--template <name>] [--name <slug>]
           Initialize a project in the current directory
  up       Start and expose the current project
  down     Remove routes and stop the current project
  logs     Show logs for the current project
  list --json List projects and their state as JSON
  stats --json Show server and project resource usage as JSON
  --help   Show this help
  --version Show the version`;

export interface InitArguments {
  name?: string;
  template?: string;
}

export function parseInitArguments(args: string[]): InitArguments {
  const result: InitArguments = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option) throw new BenchError(initUsage);

    let key: "name" | "template";
    let value: string | undefined;
    if (option === "--name" || option === "--template") {
      key = option.slice(2) as "name" | "template";
      value = args[index + 1];
      if (!value || value.startsWith("--")) throw new BenchError(initUsage);
      index += 1;
    } else if (option.startsWith("--name=") || option.startsWith("--template=")) {
      const separator = option.indexOf("=");
      key = option.slice(2, separator) as "name" | "template";
      value = option.slice(separator + 1);
      if (!value) throw new BenchError(initUsage);
    } else {
      throw new BenchError(initUsage);
    }

    if (result[key] !== undefined) throw new BenchError(initUsage);
    result[key] = key === "name" ? validateProjectName(value) : validateTemplateName(value);
  }
  return result;
}

export function main(args = process.argv.slice(2)): number {
  const command = args[0];
  if (!command) {
    console.error(help);
    return 2;
  }
  if (command === "--help" || command === "-h") {
    console.log(help);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    if (args.length !== 1) {
      console.error(help);
      return 2;
    }
    console.log(version);
    return 0;
  }
  if (command === "init") {
    let options: InitArguments;
    try {
      options = parseInitArguments(args.slice(1));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 2;
    }

    try {
      const root = resolve(process.cwd());
      const runner = new SystemCommandRunner();
      const system = options.template ? loadSystemConfig() : undefined;
      const path = initializeProject(root, {
        ...options,
        runner,
        templateRepositoryPrefix: system?.templateRepositoryPrefix,
        baseDomain: system?.domain,
      });
      console.log(options.template
        ? `Created ${path} from template ${options.template}.\nReview the generated files before running bench up.`
        : `Created ${path}.\nReview the service and port before running bench up.`);
      return 0;
    } catch (error) {
      console.error(error instanceof BenchError || error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (command === "list") {
    if (args.length !== 2 || args[1] !== "--json") {
      console.error("Usage: bench list --json");
      return 2;
    }
    try {
      const system = loadSystemConfig();
      const runner = new SystemCommandRunner();
      console.log(JSON.stringify({ projects: listProjects(system, runner) }));
      return 0;
    } catch (error) {
      console.error(error instanceof BenchError || error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (command === "stats") {
    if (args.length !== 2 || args[1] !== "--json") {
      console.error("Usage: bench stats --json");
      return 2;
    }
    try {
      const system = loadSystemConfig();
      const runner = new SystemCommandRunner();
      console.log(JSON.stringify(collectResources(system, runner)));
      return 0;
    } catch (error) {
      console.error(error instanceof BenchError || error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (command === "logs") {
    let tail = 200;
    let follow = false;
    const options = args.slice(1);
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      if (option === "--follow") {
        follow = true;
        continue;
      }
      if (option === "--tail") {
        const value = options[index + 1];
        const parsed = value && /^\d+$/.test(value) ? Number(value) : Number.NaN;
        if (!Number.isSafeInteger(parsed)) {
          console.error("Usage: bench logs [--tail <lines>] [--follow]");
          return 2;
        }
        tail = parsed;
        index += 1;
        continue;
      }
      console.error("Usage: bench logs [--tail <lines>] [--follow]");
      return 2;
    }

    try {
      const system = loadSystemConfig();
      const project = loadProjectConfig(resolve(process.cwd()), system.domain);
      logs(project, new SystemCommandRunner(), tail, follow);
      return 0;
    } catch (error) {
      console.error(error instanceof BenchError || error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (args.length !== 1) {
    console.error(help);
    return 2;
  }
  if (command !== "up" && command !== "down") {
    console.error(`Unknown command: ${command}\n\n${help}`);
    return 2;
  }

  try {
    const root = resolve(process.cwd());
    const system = loadSystemConfig();
    const project = loadProjectConfig(root, system.domain);
    const runner = new SystemCommandRunner();
    (command === "up" ? up : down)(project, system, runner, console.log);
    return 0;
  } catch (error) {
    console.error(error instanceof BenchError || error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = main();
