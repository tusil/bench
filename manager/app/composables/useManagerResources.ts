import type { ResourcesResponse } from "~~/shared/types/resources";

export function useManagerResources(immediate: boolean) {
  return useFetch<ResourcesResponse>("/api/resources", {
    key: "manager-resources",
    immediate,
  });
}
