import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectResources,
  cpuUsage,
  parseCpuSnapshot,
  parseDockerBytes,
  parseDockerStats,
  parseMemoryInfo,
  type ResourceReader,
} from "../src/resources.js";
import type { CommandRunner, SystemConfig } from "../src/types.js";

test("parses host CPU, memory, and swap counters", () => {
  const start = parseCpuSnapshot("cpu  10 0 10 80 0 0 0 0 0 0\ncpu0 1 0 1 8");
  const end = parseCpuSnapshot("cpu  20 0 20 160 0 0 0 0 0 0\ncpu0 2 0 2 16");

  assert.equal(cpuUsage(start, end), 20);
  assert.deepEqual(parseMemoryInfo([
    "MemTotal:       1000 kB",
    "MemAvailable:    400 kB",
    "SwapTotal:       500 kB",
    "SwapFree:        300 kB",
  ].join("\n")), {
    memory: { usedBytes: 600 * 1024, totalBytes: 1000 * 1024 },
    swap: { usedBytes: 200 * 1024, totalBytes: 500 * 1024 },
  });
});

test("reports an unconfigured swap as zero capacity", () => {
  assert.deepEqual(parseMemoryInfo([
    "MemTotal:       1000 kB",
    "MemAvailable:    400 kB",
    "SwapTotal:         0 kB",
    "SwapFree:          0 kB",
  ].join("\n")).swap, { usedBytes: 0, totalBytes: 0 });
});

test("parses Docker decimal and binary memory units", () => {
  assert.equal(parseDockerBytes("1.5MiB"), 1.5 * 1024 * 1024);
  assert.equal(parseDockerBytes("500kB"), 500_000);
  assert.deepEqual(parseDockerStats([
    JSON.stringify({ ID: "abc", CPUPerc: "12.50%", MemUsage: "1.5MiB / 1GiB" }),
    JSON.stringify({ ID: "def", CPUPerc: "0.00%", MemUsage: "500kB / 1GB" }),
  ].join("\n")), [
    { id: "abc", cpuPercent: 12.5, memoryUsedBytes: 1.5 * 1024 * 1024 },
    { id: "def", cpuPercent: 0, memoryUsedBytes: 500_000 },
  ]);
});

test("collects host usage and aggregates all running project containers", () => {
  const root = mkdtempSync(join(tmpdir(), "bench-resources-test-"));
  const projectsDirectory = join(root, "Projects");
  const generatedDirectory = join(root, "generated");
  mkdirSync(projectsDirectory);
  mkdirSync(generatedDirectory);
  for (const id of ["demo", "stopped", "invalid"]) mkdirSync(join(projectsDirectory, id));
  writeFileSync(join(projectsDirectory, "demo", "bench.yml"), [
    "name: demo",
    "routes:",
    "  - { service: web, port: 3000 }",
  ].join("\n"));
  writeFileSync(join(projectsDirectory, "stopped", "bench.yml"), [
    "name: stopped",
    "routes:",
    "  - { service: web, port: 3000 }",
  ].join("\n"));
  writeFileSync(join(projectsDirectory, "invalid", "bench.yml"), "name: INVALID\n");

  const system: SystemConfig = {
    domain: "bench.test",
    templateRepositoryPrefix: "/srv/bench-template-",
    network: "bench-proxy",
    caddyContainer: "bench-caddy",
    generatedDirectory,
    projectsDirectory,
  };
  const fullFirstId = "aaaaaaaaaaaa1111111111111111111111111111111111111111111111111111";
  const fullSecondId = "bbbbbbbbbbbb2222222222222222222222222222222222222222222222222222";
  const runner: CommandRunner = {
    capture(command, args) {
      assert.equal(command, "docker");
      assert.deepEqual(args, ["stats", "--no-stream", "--format", "{{json .}}"]);
      return [
        JSON.stringify({ ID: "aaaaaaaaaaaa", CPUPerc: "100.00%", MemUsage: "1.5MiB / 1GiB" }),
        JSON.stringify({ ID: "bbbbbbbbbbbb", CPUPerc: "50.00%", MemUsage: "500kB / 1GB" }),
        JSON.stringify({ ID: "unrelated", CPUPerc: "99.00%", MemUsage: "2GiB / 4GiB" }),
      ].join("\n");
    },
    captureShell(_command, cwd) {
      return cwd.endsWith("/demo") ? `${fullFirstId}\n${fullSecondId}` : "";
    },
    interactiveShell() {},
    interactive() {},
  };
  let procStatReads = 0;
  let monotonicReads = 0;
  const reader: ResourceReader = {
    readText(path) {
      if (path === "/proc/stat") {
        procStatReads += 1;
        return procStatReads === 1
          ? "cpu  10 0 10 80 0 0 0 0 0 0\n"
          : "cpu  20 0 20 160 0 0 0 0 0 0\n";
      }
      assert.equal(path, "/proc/meminfo");
      return [
        "MemTotal:       1000 kB",
        "MemAvailable:    400 kB",
        "SwapTotal:       500 kB",
        "SwapFree:        300 kB",
      ].join("\n");
    },
    statfs(path) {
      assert.equal(path, projectsDirectory);
      return { bsize: 4096, blocks: 100, bavail: 25 };
    },
    logicalCores: () => 2,
    now: () => new Date("2026-09-15T12:00:00.000Z"),
    monotonicNow: () => {
      monotonicReads += 1;
      return monotonicReads === 1 ? 0 : 150;
    },
    wait() {
      assert.fail("CPU sample should already be long enough");
    },
  };

  assert.deepEqual(collectResources(system, runner, reader), {
    sampledAt: "2026-09-15T12:00:00.000Z",
    system: {
      cpu: { usagePercent: 20, logicalCores: 2 },
      memory: { usedBytes: 600 * 1024, totalBytes: 1000 * 1024 },
      swap: { usedBytes: 200 * 1024, totalBytes: 500 * 1024 },
      disk: { usedBytes: 75 * 4096, totalBytes: 100 * 4096 },
    },
    projects: [
      {
        id: "demo",
        available: true,
        cpuPercent: 75,
        memoryUsedBytes: 1.5 * 1024 * 1024 + 500_000,
        containerCount: 2,
      },
      { id: "invalid", available: false },
      { id: "stopped", available: true, cpuPercent: 0, memoryUsedBytes: 0, containerCount: 0 },
    ],
  });
});
