import type { H3Event } from "h3";
import { getHeader, getRouterParam, readBody } from "h3";
import { ManagerError, projectService } from "./bench";

export type MutationSource =
  | { kind: "manager" }
  | { kind: "project"; origin: string };

export function mutationSource(
  origin: string | undefined,
  host: string | undefined,
  contentType: string | undefined,
  managerOrigin: string,
): MutationSource | undefined {
  if (!origin || !host || contentType?.toLowerCase().startsWith("application/json") !== true) return undefined;

  try {
    const requestOrigin = new URL(origin);
    const expectedManagerOrigin = new URL(managerOrigin);
    if (requestOrigin.host.toLowerCase() !== host.toLowerCase()) return undefined;
    if (requestOrigin.origin === expectedManagerOrigin.origin) return { kind: "manager" };
    return { kind: "project", origin: requestOrigin.origin };
  } catch {
    return undefined;
  }
}

export function isManagerHost(host: string | undefined, managerOrigin: string): boolean {
  if (!host) return false;
  try {
    return host.toLowerCase() === new URL(managerOrigin).host.toLowerCase();
  } catch {
    return false;
  }
}

export function asHttpError(error: unknown): never {
  const managerError = error instanceof ManagerError
    ? error
    : new ManagerError(error instanceof Error ? error.message : String(error));
  throw createError({
    statusCode: managerError.statusCode,
    statusMessage: "Bench operation failed",
    data: { message: managerError.message },
  });
}

function projectMutationSource(event: H3Event): MutationSource {
  const config = useRuntimeConfig(event);
  const source = mutationSource(
    getHeader(event, "origin"),
    getHeader(event, "host"),
    getHeader(event, "content-type"),
    config.public.managerOrigin,
  );
  if (!source) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }
  return source;
}

export async function projectStart(event: H3Event) {
  const source = projectMutationSource(event);
  await readBody(event);
  const id = getRouterParam(event, "id");
  try {
    return await projectService.start(id || "", source.kind === "project" ? source.origin : undefined);
  } catch (error) {
    asHttpError(error);
  }
}

export async function projectAction(event: H3Event, action: "up" | "down") {
  const source = projectMutationSource(event);
  await readBody(event);
  const id = getRouterParam(event, "id");
  try {
    return await projectService.action(id || "", action, source.kind === "project" ? source.origin : undefined);
  } catch (error) {
    asHttpError(error);
  }
}

export async function projectList(event: H3Event) {
  try {
    const config = useRuntimeConfig(event);
    const managerRequest = isManagerHost(getHeader(event, "host"), config.public.managerOrigin);
    return await projectService.list(
      managerRequest ? config.sshUser : "",
      managerRequest ? config.sshHost : "",
    );
  } catch (error) {
    asHttpError(error);
  }
}

export async function resourceList() {
  try {
    return await projectService.resources();
  } catch (error) {
    asHttpError(error);
  }
}
