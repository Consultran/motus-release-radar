import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
const root = join(import.meta.dir, "..");

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(apiStatus = 200) {
  const dir = mkdtempSync(join(tmpdir(), "motus-check-test-"));
  roots.push(dir);
  mkdirSync(join(dir, "data"));
  cpSync(join(root, "src"), join(dir, "src"), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  writeFileSync(join(dir, "README.md"), "# Test\n<!-- CHANGELOG:START -->\n<!-- CHANGELOG:END -->\n");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/api/auth/version") {
        return Response.json({
          serverVersion: "1.2.66",
          seederVersion: 100,
          migrationTimestamp: "2026-07-27T1200",
          migrationVersion: 423,
          nodeEnv: "test",
        }, { status: apiStatus });
      }
      return new Response(`<html><body><script>
        setTimeout(() => {
          document.body.innerText = "Build: test-build\\nWeb Version: 1.1.38";
        }, 50);
      </script></body></html>`, { headers: { "Content-Type": "text/html" } });
    },
  });
  servers.push(server);
  return { dir, url: server.url.toString().replace(/\/$/, "") };
}

async function capture(dir: string, url: string) {
  const processHandle = Bun.spawn([process.execPath, join(dir, "src/check.ts")], {
    cwd: dir,
    env: { ...process.env, MOTUS_URL: url, MOTUS_VERSION_API: `${url}/api/auth/version` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("captures a JavaScript-rendered footer and does not append an unchanged version", async () => {
  const { dir, url } = fixture();
  const first = await capture(dir, url);
  expect(first.stderr).toBe("");
  expect(first.code).toBe(0);
  const log = readFileSync(join(dir, "data/versions.ndjson"), "utf8");
  const record = JSON.parse(log.trim());
  expect(record).toMatchObject({
    build: "test-build",
    webVersion: "1.1.38",
    serverVersion: "1.2.66",
    seederVersion: "100",
    dbMigrationVersion: "2026-07-27T1200",
    migrationVersion: "423",
  });
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  expect(readme).toContain("| test-build | 1.1.38 | 1.2.66 | 100 |");
  const second = await capture(dir, url);
  expect(second.code).toBe(0);
  expect(second.stdout).toContain("No change since last check.");
  expect(readFileSync(join(dir, "data/versions.ndjson"), "utf8")).toBe(log);
  expect(readFileSync(join(dir, "README.md"), "utf8")).toBe(readme);
  expect(JSON.parse(readFileSync(join(dir, "data/latest.json"), "utf8")).status).toBe("ok");
}, 60_000);

test("records an API failure without changing version history", async () => {
  const { dir, url } = fixture(503);
  const history = '{"build":"existing"}\n';
  writeFileSync(join(dir, "data/versions.ndjson"), history);
  const result = await capture(dir, url);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Version API returned 503");
  expect(readFileSync(join(dir, "data/versions.ndjson"), "utf8")).toBe(history);
  expect(JSON.parse(readFileSync(join(dir, "data/latest.json"), "utf8"))).toMatchObject({
    status: "error", current: null, error: "Version API returned 503",
  });
  expect(JSON.parse(readFileSync(join(dir, "data/errors.ndjson"), "utf8").trim()).error)
    .toBe("Version API returned 503");
}, 60_000);
