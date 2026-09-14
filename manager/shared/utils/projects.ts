import type { ProjectSummary } from "../types/projects";

export function hostnameFromUrl(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function findProjectByHostname(
  projects: ProjectSummary[],
  hostname: string,
): ProjectSummary | undefined {
  const expectedHostname = hostname.toLowerCase();
  return projects.find((project) => project.routes.some((route) => hostnameFromUrl(route) === expectedHostname));
}
