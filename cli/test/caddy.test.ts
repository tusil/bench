import assert from "node:assert/strict";
import test from "node:test";
import { renderFragment } from "../src/caddy.js";
import { parseProjectConfig } from "../src/project.js";

test("renders a deterministic route fragment", () => {
  const project = parseProjectConfig(
    "name: operon\nroutes:\n  - { service: frontend, port: 3000 }\n  - { domain: api-operon.bench.test, service: backend, port: 3333, preserveHost: false }\n",
    "/srv/operon",
    "bench.test",
  );
  assert.equal(
    renderFragment(project),
    "# bench-project-root: \"/srv/operon\"\n\n@route_operon_0 host operon.bench.test\nhandle @route_operon_0 {\n\treverse_proxy operon-frontend:3000\n}\n\n@route_operon_1 host api-operon.bench.test\nhandle @route_operon_1 {\n\treverse_proxy operon-backend:3333 {\n\t\theader_up Host localhost\n\t}\n}\n",
  );
});
