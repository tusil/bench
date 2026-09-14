import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeProject, projectNameFromDirectory } from "../src/init.js";
import { parseProjectConfig } from "../src/project.js";

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
