import { readFileSync } from "node:fs";
import { BenchError } from "./errors.js";
import type { SystemConfig } from "./types.js";

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BenchError(`Invalid system configuration: ${name} must be a non-empty string`);
  }
  return value.trim();
}

export function loadSystemConfig(path = "/etc/bench/config.json"): SystemConfig {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new BenchError(
      `Failed to read system configuration ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BenchError("Invalid system configuration: expected an object");
  }
  const config = value as Record<string, unknown>;
  return {
    domain: requiredString(config.domain, "domain").toLowerCase(),
    templateRepositoryPrefix: requiredString(config.templateRepositoryPrefix, "templateRepositoryPrefix"),
    network: requiredString(config.network, "network"),
    caddyContainer: requiredString(config.caddyContainer, "caddyContainer"),
    generatedDirectory: requiredString(config.generatedDirectory, "generatedDirectory"),
    projectsDirectory: requiredString(config.projectsDirectory, "projectsDirectory"),
  };
}
