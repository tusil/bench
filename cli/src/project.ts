import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { BenchError } from "./errors.js";
import type { ProjectCommands, ProjectConfig, ProjectRoute } from "./types.js";

const namePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const servicePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BenchError(message);
  }
  return value as Record<string, unknown>;
}

function command(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new BenchError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function commands(value: unknown): ProjectCommands {
  const raw = value === undefined ? {} : record(value, "commands must be an object");
  const compose = command(raw.compose, "commands.compose") ?? "docker compose";
  const up = command(raw.up, "commands.up");
  const down = command(raw.down, "commands.down");
  if ((up === undefined) !== (down === undefined)) {
    throw new BenchError("commands.up and commands.down must be defined together");
  }
  return {
    compose,
    up: up ?? `${compose} up -d`,
    down: down ?? `${compose} down`,
  };
}

function workspace(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string"
    || !value.endsWith(".code-workspace")
    || value.startsWith("/")
    || value.includes("\\")
    || value.includes("\0")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new BenchError("workspace must be a relative .code-workspace path within the project");
  }
  return value;
}

export function dockerAlias(project: string, service: string): string {
  const serviceSlug = service.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-");
  return `${project}-${serviceSlug}`.replace(/-+$/g, "");
}

export function parseProjectConfig(text: string, root: string, baseDomain: string): ProjectConfig {
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    throw new BenchError(`Invalid bench.yml: ${error instanceof Error ? error.message : String(error)}`);
  }
  const raw = record(value, "Invalid bench.yml: expected an object");
  if (typeof raw.name !== "string" || !namePattern.test(raw.name)) {
    throw new BenchError("name must be a lowercase DNS slug with at most 63 characters");
  }
  const name = raw.name;
  if (!Array.isArray(raw.routes) || raw.routes.length === 0) {
    throw new BenchError("routes must be a non-empty array");
  }

  const normalizedBase = baseDomain.toLowerCase();
  const domainSuffix = `.${normalizedBase}`;
  const domains = new Set<string>();
  const aliases = new Map<string, string>();
  const routes: ProjectRoute[] = raw.routes.map((item, index) => {
    const route = record(item, `routes[${index}] must be an object`);
    if (typeof route.service !== "string" || !servicePattern.test(route.service)) {
      throw new BenchError(`routes[${index}].service is invalid`);
    }
    if (!Number.isInteger(route.port) || (route.port as number) < 1 || (route.port as number) > 65535) {
      throw new BenchError("Port must be between 1 and 65535");
    }
    if (route.preserveHost !== undefined && typeof route.preserveHost !== "boolean") {
      throw new BenchError(`routes[${index}].preserveHost must be a boolean`);
    }
    const domain = route.domain === undefined
      ? `${name}.${normalizedBase}`
      : typeof route.domain === "string"
        ? route.domain.toLowerCase()
        : "";
    const domainLabel = domain.endsWith(domainSuffix) ? domain.slice(0, -domainSuffix.length) : "";
    if (domain.length > 253 || !domainPattern.test(domain) || domainLabel === "" || domainLabel.includes(".")) {
      throw new BenchError(`routes[${index}].domain must be one label directly below ${normalizedBase}`);
    }
    if (domains.has(domain)) {
      throw new BenchError(`Duplicate route domain: ${domain}`);
    }
    domains.add(domain);
    const alias = dockerAlias(name, route.service);
    if (alias.length > 63) {
      throw new BenchError(`Docker alias for service ${route.service} exceeds 63 characters`);
    }
    const previousService = aliases.get(alias);
    if (previousService !== undefined && previousService !== route.service) {
      throw new BenchError(`Services ${previousService} and ${route.service} produce the same Docker alias`);
    }
    aliases.set(alias, route.service);
    return {
      service: route.service,
      port: route.port as number,
      domain,
      alias,
      preserveHost: route.preserveHost ?? true,
    };
  });

  return { name, root, routes, commands: commands(raw.commands), workspace: workspace(raw.workspace) };
}

export function loadProjectConfig(root: string, baseDomain: string): ProjectConfig {
  const path = join(root, "bench.yml");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new BenchError("bench.yml not found");
    throw new BenchError(`Failed to read bench.yml: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseProjectConfig(text, root, baseDomain);
}
