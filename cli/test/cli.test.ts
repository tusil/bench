import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
