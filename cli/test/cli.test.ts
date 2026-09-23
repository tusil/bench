import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("rejects an invalid logs tail before loading project configuration", () => {
  const result = spawnSync(process.execPath, [cliPath, "logs", "--tail", "many"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: bench logs/);
});

test("rejects invalid stats arguments before loading system configuration", () => {
  const result = spawnSync(process.execPath, [cliPath, "stats"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: bench stats --json/);
});

test("accepts equals syntax for init name", () => {
  const root = mkdtempSync(join(tmpdir(), "bench-cli-args-"));
  const result = spawnSync(process.execPath, [cliPath, "init", "--name=explicit-name"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(readFileSync(join(root, "bench.yml"), "utf8"), /^name: explicit-name$/m);
});

test("rejects duplicate and invalid init options", () => {
  for (const args of [
    ["init", "--name", "one", "--name=two"],
    ["init", "--template=Nuxt"],
    ["init", "--unknown"],
  ]) {
    const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: bench init|Template name/);
  }
});
