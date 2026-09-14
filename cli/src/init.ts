import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { BenchError } from "./errors.js";

export function projectNameFromDirectory(root: string): string {
  const name = basename(root)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");

  if (name === "") {
    throw new BenchError("Cannot derive a project name from the current directory");
  }
  return name;
}

export function renderInitialConfig(root: string): string {
  return `name: ${projectNameFromDirectory(root)}

# Change the service and port to match your Compose project.
routes:
  - service: app
    port: 3000
`;
}

export function initializeProject(root: string): string {
  const path = join(root, "bench.yml");
  try {
    writeFileSync(path, renderInitialConfig(root), { encoding: "utf8", flag: "wx", mode: 0o644 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new BenchError("bench.yml already exists");
    }
    throw new BenchError(`Failed to create bench.yml: ${error instanceof Error ? error.message : String(error)}`);
  }
  return path;
}
