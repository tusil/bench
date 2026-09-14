import assert from "node:assert/strict";
import test from "node:test";
import { parseProjectConfig } from "../src/project.js";

test("uses default commands and domain", () => {
  const project = parseProjectConfig("name: demo\nroutes:\n  - service: web\n    port: 3000\n", "/tmp/demo", "bench.test");
  assert.equal(project.commands.up, "docker compose up -d");
  assert.equal(project.commands.down, "docker compose down");
  assert.equal(project.routes[0]?.domain, "demo.bench.test");
  assert.equal(project.routes[0]?.alias, "demo-web");
});

test("accepts custom project commands", () => {
  const project = parseProjectConfig(
    "name: demo\ncommands:\n  compose: docker compose -f compose.dev.yml\n  up: npm run docker:dev:up\n  down: npm run docker:dev:down\nroutes:\n  - service: web\n    port: 3000\n",
    "/tmp/demo",
    "bench.test",
  );
  assert.equal(project.commands.compose, "docker compose -f compose.dev.yml");
  assert.equal(project.commands.up, "npm run docker:dev:up");
});

test("requires custom up and down together", () => {
  assert.throws(
    () => parseProjectConfig("name: demo\ncommands:\n  up: npm run up\nroutes:\n  - service: web\n    port: 80\n", "/tmp", "bench.test"),
    /must be defined together/,
  );
});

test("rejects duplicate and external domains", () => {
  assert.throws(
    () => parseProjectConfig("name: demo\nroutes:\n  - { service: web, port: 80 }\n  - { service: api, port: 81 }\n", "/tmp", "bench.test"),
    /Duplicate route domain/,
  );
  assert.throws(
    () => parseProjectConfig("name: demo\nroutes:\n  - { domain: example.com, service: web, port: 80 }\n", "/tmp", "bench.test"),
    /one label directly below bench.test/,
  );
  assert.throws(
    () => parseProjectConfig("name: demo\nroutes:\n  - { domain: api.demo.bench.test, service: web, port: 80 }\n", "/tmp", "bench.test"),
    /one label directly below bench.test/,
  );
});
