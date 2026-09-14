import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { down, up } from "../src/app.js";
import { renderFragment } from "../src/caddy.js";
import { BenchError } from "../src/errors.js";
import { parseProjectConfig } from "../src/project.js";
import type { CommandRunner, SystemConfig } from "../src/types.js";

class FailingCaddyRunner implements CommandRunner {
  readonly calls: string[] = [];

  capture(command: string, args: string[]): string {
    this.calls.push([command, ...args].join(" "));
    if (args[0] === "inspect") return "{}";
    return "";
  }

  captureShell(command: string): string {
    this.calls.push(command);
    return command.includes("config --services") ? "web" : "container-id";
  }

  interactiveShell(command: string): void {
    this.calls.push(command);
  }

  interactive(command: string, args: string[]): void {
    const call = [command, ...args].join(" ");
    this.calls.push(call);
    if (call.includes("caddy validate")) throw new BenchError("Caddy validation failed");
  }
}

test("rolls back a new network connection and fragment after Caddy failure", () => {
  const generatedDirectory = mkdtempSync(join(tmpdir(), "bench-cli-test-"));
  const project = parseProjectConfig("name: demo\nroutes:\n  - { service: web, port: 3000 }\n", "/srv/demo", "bench.test");
  const system: SystemConfig = {
    domain: "bench.test",
    network: "bench-proxy",
    caddyContainer: "bench-caddy",
    generatedDirectory,
  };
  const runner = new FailingCaddyRunner();

  assert.throws(() => up(project, system, runner, () => undefined), /containers were left running/);
  assert.equal(existsSync(join(generatedDirectory, "demo.caddy")), false);
  assert.ok(runner.calls.includes("docker network disconnect bench-proxy container-id"));
});

test("restores the route when the configured down command fails", () => {
  const generatedDirectory = mkdtempSync(join(tmpdir(), "bench-cli-test-"));
  const project = parseProjectConfig("name: demo\nroutes:\n  - { service: web, port: 3000 }\n", "/srv/demo", "bench.test");
  const system: SystemConfig = {
    domain: "bench.test",
    network: "bench-proxy",
    caddyContainer: "bench-caddy",
    generatedDirectory,
  };
  const path = join(generatedDirectory, "demo.caddy");
  const original = renderFragment(project);
  writeFileSync(path, original);
  const runner = new FailingCaddyRunner();
  runner.interactive = (command: string, args: string[]): void => {
    runner.calls.push([command, ...args].join(" "));
  };
  runner.interactiveShell = (): void => {
    throw new BenchError("Down failed");
  };

  assert.throws(() => down(project, system, runner, () => undefined), /Down failed/);
  assert.equal(readFileSync(path, "utf8"), original);
});
