import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createEventStream, getHeader, getRouterParam } from "h3";
import { projectService } from "../../../utils/bench";
import { asHttpError, isManagerHost } from "../../../utils/http";
import { stopLogProcess } from "../../../utils/log-stream";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  if (!isManagerHost(getHeader(event, "host"), config.public.managerOrigin)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = await projectService.openLogs(getRouterParam(event, "id") || "");
  } catch (error) {
    asHttpError(error);
  }

  const eventStream = createEventStream(event);
  let connectionClosed = false;
  let processFinished = false;
  let pending = Promise.resolve();

  function push(name: string, data: unknown): void {
    if (connectionClosed || processFinished) return;
    pending = pending
      .then(() => eventStream.push({ event: name, data: JSON.stringify(data) }))
      .catch(() => stopLogProcess(child));
  }

  async function finish(name: "end" | "failure", data: unknown): Promise<void> {
    if (connectionClosed || processFinished) return;
    processFinished = true;
    clearInterval(heartbeat);
    await pending;
    try {
      await eventStream.push({ event: name, data: JSON.stringify(data) });
    } finally {
      await eventStream.close();
    }
  }

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text: string) => {
    push("log", { stream: "stdout", text });
  });
  child.stderr.on("data", (text: string) => {
    push("log", { stream: "stderr", text });
  });
  child.once("error", (error) => {
    void finish("failure", { message: error.message });
  });
  child.once("close", (code, signal) => {
    void finish("end", { code, signal });
  });

  const heartbeat = setInterval(() => {
    push("heartbeat", {});
  }, 15_000);
  heartbeat.unref();

  eventStream.onClosed(() => {
    connectionClosed = true;
    clearInterval(heartbeat);
    stopLogProcess(child);
  });

  return eventStream.send();
});
