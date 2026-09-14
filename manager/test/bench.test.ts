import { describe, expect, it, vi } from "vitest";
import {
  ManagerError,
  createProjectService,
  parseProjectList,
  type BenchExecutor,
} from "../server/utils/bench";
import { mutationSource } from "../server/utils/http";
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

describe("mutation request checks", () => {
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
