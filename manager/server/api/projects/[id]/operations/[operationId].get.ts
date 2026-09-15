import type { ProjectOperationEvent } from "~~/shared/types/projects";
import { createEventStream, getHeader, getRouterParam } from "h3";
import { projectService } from "../../../../utils/bench";
import { asHttpError, isManagerHost } from "../../../../utils/http";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  if (!isManagerHost(getHeader(event, "host"), config.public.managerOrigin)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const eventStream = createEventStream(event);
  let connectionClosed = false;
  let finishing = false;
  let heartbeat: NodeJS.Timeout | undefined;
  let unsubscribe = () => {};
  let pending = Promise.resolve();

  function push(name: string, data: unknown): void {
    if (connectionClosed || finishing) return;
    pending = pending.then(() => eventStream.push({
      event: name,
      data: JSON.stringify(data),
    }));
  }

  function finish(): void {
    if (connectionClosed || finishing) return;
    finishing = true;
    if (heartbeat) clearInterval(heartbeat);
    void pending
      .then(() => eventStream.close())
      .catch(() => eventStream.close());
  }

  function receive(message: ProjectOperationEvent): void {
    push(message.event, message.data);
    if (message.event === "end" || message.event === "failure") finish();
  }

  let subscription;
  try {
    subscription = projectService.observeOperation(
      getRouterParam(event, "id") || "",
      getRouterParam(event, "operationId") || "",
      receive,
    );
  } catch (error) {
    asHttpError(error);
  }
  unsubscribe = subscription.unsubscribe;

  push("reset", {});
  for (const log of subscription.logs) {
    push("log", log);
  }
  if (subscription.terminal) {
    push(subscription.terminal.event, subscription.terminal.data);
    finish();
  } else {
    heartbeat = setInterval(() => {
      push("heartbeat", {});
    }, 15_000);
    heartbeat.unref();
  }

  eventStream.onClosed(() => {
    connectionClosed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe();
  });

  return eventStream.send();
});
