import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("monitor uses an explicit supported runner and reproducible dependencies", () => {
  const root = join(import.meta.dir, "..");
  const workflow = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/check.yml"), "utf8")) as any;
  const job = workflow.jobs.check;
  expect(job["runs-on"]).toBe("ubuntu-26.04");
  expect(job.steps.find((step: any) => step.name === "Install dependencies").run)
    .toBe("bun install --frozen-lockfile");
  const validation = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/test.yml"), "utf8")) as any;
  expect(validation.jobs.test["runs-on"]).toBe(job["runs-on"]);
  expect(validation.permissions.contents).toBe("read");
  expect(validation.jobs.test.steps.find((step: any) => step.name === "Test capture behavior").run)
    .toBe("bun test");

  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = manifest.devDependencies.playwright;
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(Bun.semver.satisfies(version, ">=1.61.0 <2.0.0")).toBe(true);
  const lockfile = readFileSync(join(root, "bun.lock"), "utf8");
  expect(lockfile).toContain(`playwright@${version}`);
  expect(lockfile).toContain(`playwright-core@${version}`);
});
