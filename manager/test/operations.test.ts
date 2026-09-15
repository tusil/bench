import { afterEach, describe, expect, it, vi } from "vitest";
import { maxLogCharacters, maxLogLines } from "../shared/utils/logs";
import { ProjectOperationRegistry } from "../server/utils/operations";

afterEach(() => {
  vi.useRealTimers();
});

describe("project operation registry", () => {
  it("replays buffered output and then publishes live events in order", () => {
    const registry = new ProjectOperationRegistry({ createId: () => "operation-1" });
    const id = registry.create("demo");
    registry.append(id, { stream: "stdout", text: "first\n" });
    const listener = vi.fn();

    const subscription = registry.subscribe("demo", id, listener);
    registry.append(id, { stream: "stderr", text: "second\n" });
    registry.complete(id, { event: "end", data: { code: 0, signal: null } });

    expect(subscription?.logs).toEqual([{ stream: "stdout", text: "first\n" }]);
    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      { event: "log", data: { stream: "stderr", text: "second\n" } },
      { event: "end", data: { code: 0, signal: null } },
    ]);
  });

  it("keeps collecting after a viewer disconnects", () => {
    const registry = new ProjectOperationRegistry({ createId: () => "operation-1" });
    const id = registry.create("demo");
    const listener = vi.fn();
    const subscription = registry.subscribe("demo", id, listener)!;

    subscription.unsubscribe();
    registry.append(id, { stream: "stdout", text: "continued\n" });

    expect(listener).not.toHaveBeenCalled();
    expect(registry.subscribe("demo", id, vi.fn())?.logs).toEqual([
      { stream: "stdout", text: "continued\n" },
    ]);
  });

  it("bounds retained output by characters and lines", () => {
    const registry = new ProjectOperationRegistry({ createId: () => "operation-1" });
    const id = registry.create("demo");

    registry.append(id, { stream: "stdout", text: "x".repeat(maxLogCharacters + 1) });
    let text = registry.subscribe("demo", id, vi.fn())!.logs.map((log) => log.text).join("");
    expect(text.length).toBeLessThanOrEqual(maxLogCharacters);

    registry.append(id, { stream: "stdout", text: "line\n".repeat(maxLogLines + 1) });
    text = registry.subscribe("demo", id, vi.fn())!.logs.map((log) => log.text).join("");
    expect(text.split("\n").length).toBeLessThanOrEqual(maxLogLines);
  });

  it("expires completed operations and scopes them to their project", () => {
    vi.useFakeTimers();
    const registry = new ProjectOperationRegistry({
      createId: () => "operation-1",
      retentionMs: 100,
    });
    const id = registry.create("demo");

    expect(registry.subscribe("other", id, vi.fn())).toBeUndefined();
    registry.complete(id, { event: "failure", data: { message: "Failed" } });
    expect(registry.subscribe("demo", id, vi.fn())?.terminal).toEqual({
      event: "failure",
      data: { message: "Failed" },
    });

    vi.advanceTimersByTime(100);
    expect(registry.subscribe("demo", id, vi.fn())).toBeUndefined();
  });
});
