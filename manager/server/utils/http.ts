import type { H3Event } from "h3";
import { getHeader, getRouterParam, readBody } from "h3";
import { ManagerError, projectService } from "./bench";

export function isAllowedMutation(origin: string | undefined, contentType: string | undefined, expectedOrigin: string): boolean {
  return origin === expectedOrigin && contentType?.toLowerCase().startsWith("application/json") === true;
}

function asHttpError(error: unknown): never {
  const managerError = error instanceof ManagerError
    ? error
    : new ManagerError(error instanceof Error ? error.message : String(error));
  throw createError({
    statusCode: managerError.statusCode,
    statusMessage: "Bench operation failed",
    data: { message: managerError.message },
  });
}

export async function projectAction(event: H3Event, action: "up" | "down") {
  const config = useRuntimeConfig(event);
  if (!isAllowedMutation(getHeader(event, "origin"), getHeader(event, "content-type"), config.managerOrigin)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }
  await readBody(event);
  const id = getRouterParam(event, "id");
  try {
    return await projectService.action(id || "", action);
  } catch (error) {
    asHttpError(error);
  }
}

export async function projectList() {
  try {
    return await projectService.list();
  } catch (error) {
    asHttpError(error);
  }
}
