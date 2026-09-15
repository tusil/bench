import { getHeader } from "h3";
import { isManagerHost, resourceList } from "../utils/http";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  if (!isManagerHost(getHeader(event, "host"), config.public.managerOrigin)) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
  return resourceList();
});
