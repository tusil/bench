import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeProject, projectNameFromDirectory } from "../src/init.js";
import { parseProjectConfig } from "../src/project.js";
import { SystemCommandRunner } from "../src/runner.js";

test("creates a valid bench.yml using the directory name", () => {
  const parent = mkdtempSync(join(tmpdir(), "bench-cli-init-"));
  const root = join(parent, "My Project");
  mkdirSync(root);

  const path = initializeProject(root);
  const content = readFileSync(path, "utf8");
  const project = parseProjectConfig(content, root, "bench.test");

  assert.equal(project.name, "my-project");
  assert.equal(project.routes[0]?.service, "app");
  assert.equal(project.routes[0]?.port, 3000);
});

test("does not overwrite an existing bench.yml", () => {
  const root = mkdtempSync(join(tmpdir(), "bench-cli-init-"));
  const path = join(root, "bench.yml");
  writeFileSync(path, "existing\n");

  assert.throws(() => initializeProject(root), /already exists/);
  assert.equal(readFileSync(path, "utf8"), "existing\n");
});

test("normalizes the directory name as a DNS slug", () => {
  assert.equal(projectNameFromDirectory("/tmp/Příliš Žluťoučký projekt"), "prilis-zlutoucky-projekt");
});

function createTemplate(parent: string, hook: string): string {
  const root = join(parent, "bench-template-nuxt");
  mkdirSync(join(root, ".bench", "hooks"), { recursive: true });
  writeFileSync(join(root, "bench.yml"), [
    "name: template",
    "routes:",
    "  - service: app",
    "    port: 3000",
    "",
  ].join("\n"));
  writeFileSync(join(root, ".hidden"), "included\n");
  writeFileSync(join(root, ".bench", "hooks", "init.mjs"), hook);
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", [
    "-c", "user.name=Bench Test", "-c", "user.email=bench@example.test",
    "commit", "-m", "test template",
  ], { cwd: root });
  return root;
}

test("creates a clean project from a git template and runs its hook", () => {
  const parent = mkdtempSync(join(tmpdir(), "bench-cli-template-source-"));
  createTemplate(parent, `
    import { writeFileSync } from "node:fs";
    const values = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, args) => {
      if (index % 2 === 0) all.push([value.slice(2), args[index + 1]]);
      return all;
    }, []));
    writeFileSync("hook.json", JSON.stringify(values));
  `);
  const targetParent = mkdtempSync(join(tmpdir(), "bench-cli-template-target-"));
  const root = join(targetParent, "My Project");
  mkdirSync(root);

  initializeProject(root, {
    template: "nuxt",
    templateRepositoryPrefix: join(parent, "bench-template-"),
    baseDomain: "bench.test",
    runner: new SystemCommandRunner(),
  });

  const project = parseProjectConfig(readFileSync(join(root, "bench.yml"), "utf8"), root, "bench.test");
  assert.equal(project.name, "my-project");
  assert.equal(readFileSync(join(root, ".hidden"), "utf8"), "included\n");
  assert.deepEqual(JSON.parse(readFileSync(join(root, "hook.json"), "utf8")), {
    name: "my-project",
    url: "https://my-project.bench.test",
  });
  assert.equal(existsSync(join(root, ".bench")), false);
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(), "main");
  assert.equal(execFileSync("git", ["remote"], { cwd: root, encoding: "utf8" }).trim(), "");
  assert.throws(() => execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, stdio: "ignore" }));
});

test("leaves the target empty when a template hook fails", () => {
  const parent = mkdtempSync(join(tmpdir(), "bench-cli-template-failure-source-"));
  createTemplate(parent, "process.exit(12);\n");
  const root = mkdtempSync(join(tmpdir(), "bench-cli-template-failure-target-"));

  assert.throws(() => initializeProject(root, {
    template: "nuxt",
    templateRepositoryPrefix: join(parent, "bench-template-"),
    baseDomain: "bench.test",
    runner: new SystemCommandRunner(),
  }), /Command failed/);
  assert.deepEqual(readdirSync(root), []);
});

test("refuses to apply a template to a non-empty directory", () => {
  const root = mkdtempSync(join(tmpdir(), "bench-cli-template-nonempty-"));
  writeFileSync(join(root, "README.md"), "keep me\n");

  assert.throws(() => initializeProject(root, { template: "nuxt" }), /must be empty/);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "keep me\n");
});
