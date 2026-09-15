import { randomUUID } from "node:crypto";
import type {
  ProjectLogEvent,
  ProjectOperationEvent,
  ProjectOperationTerminal,
} from "~~/shared/types/projects";
import { appendLogText, maxLogCharacters, maxLogLines } from "~~/shared/utils/logs";

interface ProjectOperation {
  id: string;
  projectId: string;
  logs: ProjectLogEvent[];
  characters: number;
  lines: number;
  terminal?: ProjectOperationTerminal;
  listeners: Set<(event: ProjectOperationEvent) => void>;
}

export interface ProjectOperationSubscription {
  logs: ProjectLogEvent[];
  terminal?: ProjectOperationTerminal;
  unsubscribe: () => void;
}

interface ProjectOperationRegistryOptions {
  createId?: () => string;
  retentionMs?: number;
}

const defaultRetentionMs = 10 * 60 * 1_000;

function lineBreakCount(text: string): number {
  let count = 0;
  for (const character of text) {
    if (character === "\n") count += 1;
  }
  return count;
}

function trimLogs(operation: ProjectOperation): void {
  while (
    operation.logs.length > 1
    && (operation.characters > maxLogCharacters || operation.lines > maxLogLines)
  ) {
    const removed = operation.logs.shift()!;
    operation.characters -= removed.text.length;
    operation.lines -= lineBreakCount(removed.text);
  }

  if (
    operation.logs.length === 1
    && (operation.characters > maxLogCharacters || operation.lines > maxLogLines)
  ) {
    const log = operation.logs[0]!;
    const text = appendLogText("", log.text);
    operation.logs[0] = { ...log, text };
    operation.characters = text.length;
    operation.lines = lineBreakCount(text);
  }
}

export class ProjectOperationRegistry {
  private readonly operations = new Map<string, ProjectOperation>();
  private readonly createId: () => string;
  private readonly retentionMs: number;

  constructor(options: ProjectOperationRegistryOptions = {}) {
    this.createId = options.createId || randomUUID;
    this.retentionMs = options.retentionMs ?? defaultRetentionMs;
  }

  create(projectId: string): string {
    const id = this.createId();
    this.operations.set(id, {
      id,
      projectId,
      logs: [],
      characters: 0,
      lines: 0,
      listeners: new Set(),
    });
    return id;
  }

  remove(id: string): void {
    this.operations.delete(id);
  }

  append(id: string, log: ProjectLogEvent): void {
    const operation = this.operations.get(id);
    if (!operation || operation.terminal) return;
    operation.logs.push(log);
    operation.characters += log.text.length;
    operation.lines += lineBreakCount(log.text);
    trimLogs(operation);
    for (const listener of operation.listeners) {
      listener({ event: "log", data: log });
    }
  }

  complete(id: string, terminal: ProjectOperationTerminal): void {
    const operation = this.operations.get(id);
    if (!operation || operation.terminal) return;
    operation.terminal = terminal;
    for (const listener of operation.listeners) {
      listener(terminal);
    }
    operation.listeners.clear();

    const expiry = setTimeout(() => this.operations.delete(id), this.retentionMs);
    expiry.unref();
  }

  subscribe(
    projectId: string,
    id: string,
    listener: (event: ProjectOperationEvent) => void,
  ): ProjectOperationSubscription | undefined {
    const operation = this.operations.get(id);
    if (!operation || operation.projectId !== projectId) return undefined;
    operation.listeners.add(listener);
    return {
      logs: operation.logs.map((log) => ({ ...log })),
      terminal: operation.terminal
        ? operation.terminal.event === "end"
          ? { event: "end", data: { ...operation.terminal.data } }
          : { event: "failure", data: { ...operation.terminal.data } }
        : undefined,
      unsubscribe: () => operation.listeners.delete(listener),
    };
  }
}
