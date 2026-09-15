import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  ManagerError,
  createProjectService,
  parseProjectList,
  type BenchExecutor,
  type BenchProcessSpawner,
} from "../server/utils/bench";
import { isManagerHost, mutationSource } from "../server/utils/http";
import { findProjectByHostname } from "../shared/utils/projects";

const response = JSON.stringify({
  projects: [{
    id: "demo-dir",
    root: "/home/user/Projects/demo-dir",
    name: "demo",
    routes: ["https://demo.bench.test"],
    state: "stopped",
  }],
});

function fakeProcess(): ChildProcessWithoutNullStreams {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  }) as unknown as ChildProcessWithoutNullStreams;
}

describe("project list", () => {
  it("validates CLI JSON and hides project roots from the API", async () => {
    const execute: BenchExecutor = async () => response;
    const service = createProjectService(execute);

    expect(await service.list()).toEqual({
      projects: [{
        id: "demo-dir",
        name: "demo",
        routes: ["https://demo.bench.test"],
        state: "stopped",
      }],
    });
  });

  it("rejects malformed CLI output", () => {
    expect(() => parseProjectList("{}")).toThrow(ManagerError);
  });
});

describe("project actions", () => {
  it("runs the CLI in the discovered project directory", async () => {
    const execute = vi.fn<BenchExecutor>(async (args) => args[0] === "list" ? response : "Project demo started.");
    const service = createProjectService(execute);

    await expect(service.action("demo-dir", "up")).resolves.toEqual({ message: "Project demo started." });
    expect(execute).toHaveBeenLastCalledWith(["up"], "/home/user/Projects/demo-dir");
  });

  it("allows a project route to start its own project", async () => {
    const execute = vi.fn<BenchExecutor>(async (args) => args[0] === "list" ? response : "Project demo started.");
    const service = createProjectService(execute);

    await expect(service.action("demo-dir", "up", "https://demo.bench.test")).resolves.toEqual({
      message: "Project demo started.",
    });
    expect(execute).toHaveBeenLastCalledWith(["up"], "/home/user/Projects/demo-dir");
  });

  it("rejects lifecycle access from another project route", async () => {
    const execute = vi.fn<BenchExecutor>(async () => response);
    const service = createProjectService(execute);

    await expect(service.action("demo-dir", "up", "https://other.bench.test"))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(service.action("demo-dir", "down", "https://demo.bench.test"))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("serializes lifecycle operations", async () => {
    let release: ((value: string) => void) | undefined;
    const execute: BenchExecutor = async (args) => {
      if (args[0] === "list") return response;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const service = createProjectService(execute);
    const first = service.action("demo-dir", "up");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));

    await expect(service.action("demo-dir", "down")).rejects.toMatchObject({ statusCode: 409 });
    release?.("Project demo started.");
    await first;
  });
});

describe("project logs", () => {
  it("starts the log command in the discovered project directory", async () => {
    const process = {} as ChildProcessWithoutNullStreams;
    const spawnProcess = vi.fn<BenchProcessSpawner>(() => process);
    const service = createProjectService(async () => response, spawnProcess);

    await expect(service.openLogs("demo-dir")).resolves.toBe(process);
    expect(spawnProcess).toHaveBeenCalledWith(
      ["logs", "--tail", "200", "--follow"],
      "/home/user/Projects/demo-dir",
    );
  });

  it("rejects missing and invalid projects without starting a process", async () => {
    const spawnProcess = vi.fn<BenchProcessSpawner>();
    const invalidResponse = JSON.stringify({
      projects: [{ id: "broken", root: "/srv/broken", routes: [], state: "invalid", error: "Bad config" }],
    });
    const service = createProjectService(async () => invalidResponse, spawnProcess);

    await expect(service.openLogs("missing")).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.openLogs("broken")).rejects.toMatchObject({ statusCode: 409, message: "Bad config" });
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});

describe("project start operations", () => {
  it("streams output, keeps the lifecycle lock, and releases it after completion", async () => {
    const child = fakeProcess();
    const execute = vi.fn<BenchExecutor>(async (args) => args[0] === "list" ? response : "Project stopped.");
    const spawnProcess = vi.fn<BenchProcessSpawner>(() => child);
    const service = createProjectService(execute, spawnProcess);

    const result = await service.start("demo-dir");
    expect(spawnProcess).toHaveBeenCalledWith(["up"], "/home/user/Projects/demo-dir");

    child.stdout.write("Creating containers\n");
    child.stderr.write("Waiting for health check\n");
    const listener = vi.fn();
    const subscription = service.observeOperation("demo-dir", result.operationId, listener);
    expect(subscription.logs).toEqual([
      { stream: "stdout", text: "Creating containers\n" },
      { stream: "stderr", text: "Waiting for health check\n" },
    ]);

    await expect(service.action("demo-dir", "down")).rejects.toMatchObject({ statusCode: 409 });
    child.emit("close", 0, null);
    expect(listener).toHaveBeenCalledWith({
      event: "end",
      data: { code: 0, signal: null },
    });
    await expect(service.action("demo-dir", "down")).resolves.toEqual({ message: "Project stopped." });
  });

  it("releases the lifecycle lock when the process cannot be spawned", async () => {
    const execute = vi.fn<BenchExecutor>(async (args) => args[0] === "list" ? response : "Project stopped.");
    const spawnProcess = vi.fn<BenchProcessSpawner>(() => {
      throw new Error("Spawn failed");
    });
    const service = createProjectService(execute, spawnProcess);

    await expect(service.start("demo-dir")).rejects.toThrow("Spawn failed");
    await expect(service.action("demo-dir", "down")).resolves.toEqual({ message: "Project stopped." });
  });

  it("publishes an asynchronous spawn failure and releases the lifecycle lock", async () => {
    const child = fakeProcess();
    const execute = vi.fn<BenchExecutor>(async (args) => args[0] === "list" ? response : "Project stopped.");
    const service = createProjectService(execute, () => child);
    const result = await service.start("demo-dir");
    const listener = vi.fn();
    service.observeOperation("demo-dir", result.operationId, listener);

    child.emit("error", new Error("Executable not found"));

    expect(listener).toHaveBeenCalledWith({
      event: "failure",
      data: { message: "Executable not found" },
    });
    await expect(service.action("demo-dir", "down")).resolves.toEqual({ message: "Project stopped." });
  });

  it("allows a project route to start only its own project", async () => {
    const child = fakeProcess();
    const spawnProcess = vi.fn<BenchProcessSpawner>(() => child);
    const service = createProjectService(async () => response, spawnProcess);

    await expect(service.start("demo-dir", "https://other.bench.test"))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(service.start("demo-dir", "https://demo.bench.test"))
      .resolves.toHaveProperty("operationId");
    child.emit("close", 0, null);
  });
});

describe("mutation request checks", () => {
  it("recognizes only the configured Manager host for log access", () => {
    expect(isManagerHost("bench.test", "https://bench.test")).toBe(true);
    expect(isManagerHost("BENCH.TEST:3000", "http://bench.test:3000")).toBe(true);
    expect(isManagerHost("demo.bench.test", "https://bench.test")).toBe(false);
    expect(isManagerHost(undefined, "https://bench.test")).toBe(false);
  });

  it("recognizes the configured Manager origin", () => {
    expect(mutationSource(
      "https://bench.test",
      "bench.test",
      "application/json",
      "https://bench.test",
    )).toEqual({ kind: "manager" });
  });

  it("passes a matching project origin through for project validation", () => {
    expect(mutationSource(
      "https://demo.bench.test",
      "demo.bench.test",
      "application/json; charset=utf-8",
      "https://bench.test",
    )).toEqual({ kind: "project", origin: "https://demo.bench.test" });
  });

  it("rejects mismatched hosts, invalid origins, and non-JSON requests", () => {
    expect(mutationSource(
      "https://demo.bench.test",
      "other.bench.test",
      "application/json",
      "https://bench.test",
    )).toBeUndefined();
    expect(mutationSource(
      "not a URL",
      "demo.bench.test",
      "application/json",
      "https://bench.test",
    )).toBeUndefined();
    expect(mutationSource(
      "https://bench.test",
      "bench.test",
      "text/plain",
      "https://bench.test",
    )).toBeUndefined();
  });
});

describe("project route lookup", () => {
  it("finds a project by route hostname", () => {
    const projects = parseProjectList(response);

    expect(findProjectByHostname(projects, "DEMO.BENCH.TEST")?.id).toBe("demo-dir");
    expect(findProjectByHostname(projects, "unknown.bench.test")).toBeUndefined();
  });
});
