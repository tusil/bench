import { readFileSync, statfsSync } from "node:fs";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { BenchError } from "./errors.js";
import { loadProjectConfig } from "./project.js";
import { discoverProjectDirectories } from "./projects.js";
import type {
  CapacityUsage,
  CommandRunner,
  ProjectResourceUsage,
  ResourcesResponse,
  SystemConfig,
} from "./types.js";

interface CpuSnapshot {
  idle: number;
  total: number;
}

interface DockerResourceStat {
  id: string;
  cpuPercent: number;
  memoryUsedBytes: number;
}

export interface ResourceReader {
  readText(path: string): string;
  statfs(path: string): { bavail: number; blocks: number; bsize: number };
  logicalCores(): number;
  now(): Date;
  monotonicNow(): number;
  wait(milliseconds: number): void;
}

const defaultReader: ResourceReader = {
  readText: (path) => readFileSync(path, "utf8"),
  statfs: (path) => statfsSync(path),
  logicalCores: () => cpus().length,
  now: () => new Date(),
  monotonicNow: () => performance.now(),
  wait: (milliseconds) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  },
};

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new BenchError(`${name} is invalid`);
  return value;
}

function roundPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

export function parseCpuSnapshot(text: string): CpuSnapshot {
  const line = text.split("\n").find((candidate) => candidate.startsWith("cpu "));
  const values = line?.trim().split(/\s+/).slice(1, 9).map(Number);
  if (!values || values.length < 4 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new BenchError("/proc/stat contains invalid CPU data");
  }
  return {
    idle: values[3]! + (values[4] || 0),
    total: values.reduce((sum, value) => sum + value, 0),
  };
}

export function cpuUsage(start: CpuSnapshot, end: CpuSnapshot): number {
  const total = end.total - start.total;
  const idle = end.idle - start.idle;
  if (total <= 0 || idle < 0) throw new BenchError("CPU counters did not advance");
  return roundPercent(((total - idle) / total) * 100);
}

export function parseMemoryInfo(text: string): { memory: CapacityUsage; swap: CapacityUsage } {
  const values = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = /^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB$/.exec(line.trim());
    if (match) values.set(match[1]!, Number(match[2]) * 1024);
  }

  const required = ["MemTotal", "MemAvailable", "SwapTotal", "SwapFree"] as const;
  if (required.some((key) => !values.has(key))) {
    throw new BenchError("/proc/meminfo is missing required values");
  }
  const memoryTotal = finiteNonNegative(values.get("MemTotal")!, "MemTotal");
  const memoryAvailable = finiteNonNegative(values.get("MemAvailable")!, "MemAvailable");
  const swapTotal = finiteNonNegative(values.get("SwapTotal")!, "SwapTotal");
  const swapFree = finiteNonNegative(values.get("SwapFree")!, "SwapFree");
  if (memoryAvailable > memoryTotal || swapFree > swapTotal) {
    throw new BenchError("/proc/meminfo contains inconsistent values");
  }
  return {
    memory: { usedBytes: memoryTotal - memoryAvailable, totalBytes: memoryTotal },
    swap: { usedBytes: swapTotal - swapFree, totalBytes: swapTotal },
  };
}

export function parseDockerBytes(value: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([kmgtpe]?i?b)$/i.exec(value.trim());
  if (!match) throw new BenchError(`Invalid Docker memory value: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const powers: Record<string, number> = {
    b: 0,
    kb: 1,
    mb: 2,
    gb: 3,
    tb: 4,
    pb: 5,
    eb: 6,
    kib: 1,
    mib: 2,
    gib: 3,
    tib: 4,
    pib: 5,
    eib: 6,
  };
  const power = powers[unit];
  if (power === undefined) throw new BenchError(`Invalid Docker memory unit: ${value}`);
  const base = unit.includes("i") ? 1024 : 1000;
  return Math.round(finiteNonNegative(amount * base ** power, "Docker memory usage"));
}

export function parseDockerStats(output: string): DockerResourceStat[] {
  if (!output.trim()) return [];
  return output.split("\n").filter(Boolean).map((line) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new BenchError("docker stats returned invalid JSON");
    }
    if (typeof value !== "object" || value === null) {
      throw new BenchError("docker stats returned an invalid record");
    }
    const record = value as Record<string, unknown>;
    if (typeof record.ID !== "string" || typeof record.CPUPerc !== "string" || typeof record.MemUsage !== "string") {
      throw new BenchError("docker stats returned an invalid record");
    }
    const cpuPercent = Number(record.CPUPerc.replace(/%$/, ""));
    const memoryUsed = record.MemUsage.split("/")[0]?.trim();
    return {
      id: record.ID,
      cpuPercent: finiteNonNegative(cpuPercent, "Docker CPU usage"),
      memoryUsedBytes: parseDockerBytes(memoryUsed || ""),
    };
  });
}

function matchingStat(id: string, stats: DockerResourceStat[]): DockerResourceStat | undefined {
  return stats.find((stat) => id.startsWith(stat.id) || stat.id.startsWith(id));
}

export function collectResources(
  system: SystemConfig,
  runner: CommandRunner,
  reader: ResourceReader = defaultReader,
): ResourcesResponse {
  const cpuStart = parseCpuSnapshot(reader.readText("/proc/stat"));
  const sampleStarted = reader.monotonicNow();
  const logicalCores = reader.logicalCores();
  if (!Number.isSafeInteger(logicalCores) || logicalCores < 1) {
    throw new BenchError("Logical CPU count is invalid");
  }

  const projects: Array<{ id: string; containerIds?: string[] }> = discoverProjectDirectories(system).map(({ id, root }) => {
    try {
      const project = loadProjectConfig(root, system.domain);
      const containerIds = runner.captureShell(`${project.commands.compose} ps -q`, root)
        .split(/\s+/)
        .filter(Boolean);
      return { id, containerIds };
    } catch {
      return { id };
    }
  });
  const hasContainers = projects.some((project) => project.containerIds?.length);
  const dockerStats = hasContainers
    ? parseDockerStats(runner.capture("docker", ["stats", "--no-stream", "--format", "{{json .}}"]))
    : [];

  const remainingSampleTime = 100 - (reader.monotonicNow() - sampleStarted);
  if (remainingSampleTime > 0) reader.wait(remainingSampleTime);
  const cpu = cpuUsage(cpuStart, parseCpuSnapshot(reader.readText("/proc/stat")));
  const { memory, swap } = parseMemoryInfo(reader.readText("/proc/meminfo"));
  const filesystem = reader.statfs(system.projectsDirectory);
  const diskTotal = finiteNonNegative(filesystem.blocks * filesystem.bsize, "Disk capacity");
  const diskAvailable = finiteNonNegative(filesystem.bavail * filesystem.bsize, "Available disk capacity");
  if (diskAvailable > diskTotal) throw new BenchError("Disk capacity is inconsistent");

  const projectResources: ProjectResourceUsage[] = projects.map(({ id, containerIds }) => {
    if (!containerIds) return { id, available: false };
    const stats = containerIds.flatMap((containerId) => {
      const stat = matchingStat(containerId, dockerStats);
      return stat ? [stat] : [];
    });
    return {
      id,
      available: true,
      cpuPercent: roundPercent(stats.reduce((sum, stat) => sum + stat.cpuPercent, 0) / logicalCores),
      memoryUsedBytes: stats.reduce((sum, stat) => sum + stat.memoryUsedBytes, 0),
      containerCount: stats.length,
    };
  });

  return {
    sampledAt: reader.now().toISOString(),
    system: {
      cpu: { usagePercent: cpu, logicalCores },
      memory,
      swap,
      disk: { usedBytes: diskTotal - diskAvailable, totalBytes: diskTotal },
    },
    projects: projectResources,
  };
}
