import { getHeader, getRouterParam } from "h3";
import { projectService } from "../../utils/bench";
import { asHttpError, isManagerHost } from "../../utils/http";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  if (!isManagerHost(getHeader(event, "host"), config.public.managerOrigin)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  try {
    return await projectService.detail(
      getRouterParam(event, "id") || "",
      config.sshUser,
      config.sshHost,
    );
  } catch (error) {
    asHttpError(error);
  }
});
