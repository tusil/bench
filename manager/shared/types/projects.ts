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

export interface StartOperationResponse {
  operationId: string;
}

export type ProjectLogStream = "stdout" | "stderr";

export interface ProjectLogEvent {
  stream: ProjectLogStream;
  text: string;
}

export interface ProjectLogEndEvent {
  code: number | null;
  signal: string | null;
}

export interface ProjectLogFailureEvent {
  message: string;
}

export type ProjectOperationTerminal =
  | { event: "end"; data: ProjectLogEndEvent }
  | { event: "failure"; data: ProjectLogFailureEvent };

export type ProjectOperationEvent =
  | { event: "log"; data: ProjectLogEvent }
  | ProjectOperationTerminal;
