import { describe, expect, it, vi } from "vitest";
import {
  ManagerError,
  createProjectService,
  parseProjectList,
  type BenchExecutor,
} from "../server/utils/bench";
import { isAllowedMutation } from "../server/utils/http";

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
  it("accepts only JSON from the configured origin", () => {
    expect(isAllowedMutation("https://bench.test", "application/json", "https://bench.test")).toBe(true);
    expect(isAllowedMutation("https://evil.test", "application/json", "https://bench.test")).toBe(false);
    expect(isAllowedMutation("https://bench.test", "text/plain", "https://bench.test")).toBe(false);
  });
});
