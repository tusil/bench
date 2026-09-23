import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseDocument } from "yaml";
import { BenchError } from "./errors.js";
import { parseProjectConfig } from "./project.js";
import type { CommandRunner } from "./types.js";

const namePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const templatePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface InitializeProjectOptions {
  name?: string;
  template?: string;
  templateRepositoryPrefix?: string;
  baseDomain?: string;
  runner?: CommandRunner;
}

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

export function validateProjectName(name: string): string {
  if (!namePattern.test(name)) {
    throw new BenchError("Project name must be a lowercase DNS slug with at most 63 characters");
  }
  return name;
}

export function validateTemplateName(template: string): string {
  if (!templatePattern.test(template)) {
    throw new BenchError("Template name must contain only lowercase letters, numbers, and hyphens");
  }
  return template;
}

export function renderInitialConfig(root: string, explicitName?: string): string {
  const name = explicitName === undefined
    ? projectNameFromDirectory(root)
    : validateProjectName(explicitName);
  return `name: ${name}

# Change the service and port to match your Compose project.
routes:
  - service: app
    port: 3000
`;
}

function writeInitialConfig(root: string, name?: string): string {
  const path = join(root, "bench.yml");
  try {
    writeFileSync(path, renderInitialConfig(root, name), { encoding: "utf8", flag: "wx", mode: 0o644 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new BenchError("bench.yml already exists");
    }
    throw new BenchError(`Failed to create bench.yml: ${error instanceof Error ? error.message : String(error)}`);
  }
  return path;
}

function rewriteTemplateConfig(root: string, name: string, baseDomain: string): void {
  const path = join(root, "bench.yml");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new BenchError(`Template must contain a readable bench.yml: ${error instanceof Error ? error.message : String(error)}`);
  }

  const document = parseDocument(text);
  const value = document.toJS();
  if (document.errors.length > 0 || value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BenchError("Template contains an invalid bench.yml");
  }
  document.set("name", name);
  const rendered = document.toString();
  writeFileSync(path, rendered, { encoding: "utf8", mode: 0o644 });
  parseProjectConfig(rendered, root, baseDomain);
}

function validateTemplateConfig(root: string, baseDomain: string): void {
  let text: string;
  try {
    text = readFileSync(join(root, "bench.yml"), "utf8");
  } catch (error) {
    throw new BenchError(`Template hook removed bench.yml: ${error instanceof Error ? error.message : String(error)}`);
  }
  parseProjectConfig(text, root, baseDomain);
}

function copyStagedProject(staging: string, root: string): void {
  const copied: string[] = [];
  try {
    for (const entry of readdirSync(staging)) {
      copied.push(entry);
      cpSync(join(staging, entry), join(root, entry), {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
      });
    }
  } catch (error) {
    for (const entry of copied.reverse()) {
      rmSync(join(root, entry), { recursive: true, force: true });
    }
    throw new BenchError(`Failed to copy template: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function initializeFromTemplate(root: string, options: InitializeProjectOptions): string {
  if (readdirSync(root).length !== 0) {
    throw new BenchError("The current directory must be empty when using a template");
  }
  if (!options.runner || !options.templateRepositoryPrefix || !options.baseDomain || !options.template) {
    throw new BenchError("Template initialization requires the system template configuration");
  }

  const name = options.name === undefined
    ? projectNameFromDirectory(root)
    : validateProjectName(options.name);
  const template = validateTemplateName(options.template);
  const repository = `${options.templateRepositoryPrefix}${template}`;
  const staging = mkdtempSync(join(tmpdir(), "bench-template-"));

  try {
    options.runner.capture("git", ["clone", "--depth", "1", repository, staging]);
    rmSync(join(staging, ".git"), { recursive: true, force: true });
    rewriteTemplateConfig(staging, name, options.baseDomain);

    const hook = join(staging, ".bench", "hooks", "init.mjs");
    try {
      readFileSync(hook);
      options.runner.interactive(
        process.execPath,
        [hook, "--name", name, "--url", `https://${name}.${options.baseDomain}`],
        staging,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    validateTemplateConfig(staging, options.baseDomain);
    rmSync(join(staging, ".bench"), { recursive: true, force: true });
    options.runner.capture("git", ["init", "--initial-branch", "main"], staging);
    copyStagedProject(staging, root);
    return join(root, "bench.yml");
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function initializeProject(root: string, options: InitializeProjectOptions = {}): string {
  return options.template
    ? initializeFromTemplate(root, options)
    : writeInitialConfig(root, options.name);
}
