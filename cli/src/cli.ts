#!/opt/node/bin/node

import { resolve } from "node:path";
import { down, up } from "./app.js";
import { BenchError } from "./errors.js";
import { loadSystemConfig } from "./config.js";
import { initializeProject } from "./init.js";
import { loadProjectConfig } from "./project.js";
import { SystemCommandRunner } from "./runner.js";

const version = "0.1.0";
const help = `Usage: bench <command>

Commands:
  init     Create bench.yml in the current directory
  up       Start and expose the current project
  down     Remove routes and stop the current project
  --help   Show this help
  --version Show the version`;

export function main(args = process.argv.slice(2)): number {
  const command = args[0];
  if (args.length !== 1 || !command) {
    console.error(help);
    return 2;
  }
  if (command === "--help" || command === "-h") {
    console.log(help);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(version);
    return 0;
  }
  if (command !== "init" && command !== "up" && command !== "down") {
    console.error(`Unknown command: ${command}\n\n${help}`);
    return 2;
  }

  try {
    const root = resolve(process.cwd());
    if (command === "init") {
      const path = initializeProject(root);
      console.log(`Created ${path}.\nReview the service and port before running bench up.`);
      return 0;
    }
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
