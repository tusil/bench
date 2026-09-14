export type ProjectState = "running" | "stopped" | "degraded" | "invalid";

export interface ProjectSummary {
  id: string;
  name?: string;
  routes: string[];
  state: ProjectState;
  error?: string;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface ActionResponse {
  message: string;
}
