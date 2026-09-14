import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderFragment } from "../src/caddy.js";
import { listProjects } from "../src/projects.js";
import { parseProjectConfig } from "../src/project.js";
import type { CommandRunner, SystemConfig } from "../src/types.js";

class StatusRunner implements CommandRunner {
  capture(): string {
    return "";
  }

  captureShell(_command: string, cwd: string): string {
    return cwd.endsWith("/running") || cwd.endsWith("/degraded") ? "container-id" : "";
  }

  interactiveShell(): void {}
  interactive(): void {}
}

test("discovers direct project directories and reports their state", () => {
  const root = mkdtempSync(join(tmpdir(), "bench-projects-test-"));
  const projectsDirectory = join(root, "Projects");
  const generatedDirectory = join(root, "generated");
  mkdirSync(projectsDirectory);
  mkdirSync(generatedDirectory);

  for (const name of ["running", "stopped", "degraded", "invalid", "empty", ".hidden"]) {
    mkdirSync(join(projectsDirectory, name));
  }
  const config = "name: demo\nroutes:\n  - { service: web, port: 3000 }\n";
  writeFileSync(join(projectsDirectory, "running", "bench.yml"), config);
  writeFileSync(join(projectsDirectory, "stopped", "bench.yml"), config.replace("demo", "stopped"));
  writeFileSync(join(projectsDirectory, "degraded", "bench.yml"), config.replace("demo", "degraded"));
  writeFileSync(join(projectsDirectory, "invalid", "bench.yml"), "name: INVALID\n");
  writeFileSync(join(projectsDirectory, ".hidden", "bench.yml"), config);
  symlinkSync(join(projectsDirectory, "running"), join(projectsDirectory, "linked"));

  const runningRoot = join(projectsDirectory, "running");
  const running = parseProjectConfig(config, runningRoot, "bench.test");
  writeFileSync(join(generatedDirectory, "demo.caddy"), renderFragment(running));

  const system: SystemConfig = {
    domain: "bench.test",
    network: "bench-proxy",
    caddyContainer: "bench-caddy",
    generatedDirectory,
    projectsDirectory,
  };
  const projects = listProjects(system, new StatusRunner());

  assert.deepEqual(projects.map(({ id, state }) => ({ id, state })), [
    { id: "degraded", state: "degraded" },
    { id: "invalid", state: "invalid" },
    { id: "running", state: "running" },
    { id: "stopped", state: "stopped" },
  ]);
  assert.deepEqual(projects[2]?.routes, ["https://demo.bench.test"]);
});
