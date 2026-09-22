import { readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { BenchError } from "./errors.js";
import type { ProjectConfig } from "./types.js";

export function fragmentPath(directory: string, project: ProjectConfig): string {
  return join(directory, `${project.name}.caddy`);
}

export function renderFragment(project: ProjectConfig): string {
  const lines = [`# bench-project-root: ${JSON.stringify(project.root)}`];
  project.routes.forEach((route, index) => {
    const proxy = route.preserveHost
      ? [`\treverse_proxy ${route.alias}:${route.port}`]
      : [
          `\treverse_proxy ${route.alias}:${route.port} {`,
          "\t\theader_up Host localhost",
          "\t}",
        ];
    lines.push(
      "",
      `@route_${project.name.replaceAll("-", "_")}_${index} host ${route.domain}`,
      `handle @route_${project.name.replaceAll("-", "_")}_${index} {`,
      ...proxy,
      "}",
    );
  });
  return `${lines.join("\n")}\n`;
}

export function fragmentOwner(text: string): string | undefined {
  const match = text.match(/^# bench-project-root: (.+)$/m);
  if (!match?.[1]) return undefined;
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function readFragment(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function assertFragmentAvailable(directory: string, project: ProjectConfig): void {
  const ownPath = fragmentPath(directory, project);
  assertFragmentOwned(directory, project);
  const wanted = new Set(project.routes.map((route) => route.domain));
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".caddy"))) {
    const path = join(directory, file);
    if (path === ownPath) continue;
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/^@\S+\s+host\s+(\S+)$/gm)) {
      const domain = match[1];
      if (domain && wanted.has(domain)) {
        throw new BenchError(`Route domain ${domain} is already used by ${file}`);
      }
    }
  }
}

export function assertFragmentOwned(directory: string, project: ProjectConfig): void {
  const ownPath = fragmentPath(directory, project);
  const current = readFragment(ownPath);
  if (current !== null && fragmentOwner(current) !== project.root) {
    throw new BenchError(`Project name ${project.name} is already owned by another directory`);
  }
}

export function atomicWrite(path: string, content: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o644 });
  renameSync(temporary, path);
}

export function restoreFragment(path: string, content: string | null): void {
  if (content === null) {
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } else {
    atomicWrite(path, content);
  }
}
