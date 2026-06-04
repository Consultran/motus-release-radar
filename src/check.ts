/**
 * MOTUS Version Tracker — capture script.
 *
 * Loads motus.dot.gov in a headless browser, reads the JS-rendered version
 * footer (the only place Web Version + Build are exposed), enriches with the
 * public /api/auth/version JSON (migrationVersion + nodeEnv), and appends a
 * record to data/versions.ndjson ONLY when the version tuple changed since the
 * last logged deploy. latest.json is rewritten every run; the README changelog
 * table is regenerated from the log.
 *
 * Env overrides (used by tests / CI):
 *   MOTUS_URL          default https://motus.dot.gov
 *   MOTUS_VERSION_API  default https://motus.dot.gov/api/auth/version
 */
import { chromium } from "playwright";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const VERSIONS_FILE = join(DATA, "versions.ndjson");
const LATEST_FILE = join(DATA, "latest.json");
const ERRORS_FILE = join(DATA, "errors.ndjson");
const README_FILE = join(ROOT, "README.md");

const MOTUS_URL = process.env.MOTUS_URL ?? "https://motus.dot.gov";
const VERSION_API = process.env.MOTUS_VERSION_API ?? "https://motus.dot.gov/api/auth/version";

// Footer labels we parse, mapped to the record field they populate.
// Only the frontend-only fields come from the footer; the server-side fields
// (server/seeder/migration) are sourced from the API to avoid a render race —
// the page itself populates those footer values asynchronously from /api/auth/version.
const FOOTER_FIELDS = {
  build: "Build",
  webVersion: "Web Version",
} as const;

type FooterField = keyof typeof FOOTER_FIELDS;

type VersionRecord = {
  capturedAt: string;
  build: string;
  webVersion: string;
  serverVersion: string;
  seederVersion: string;
  dbMigrationVersion: string;
  migrationVersion: string;
  nodeEnv: string | null;
};

// Fields that define a "real" change. capturedAt + nodeEnv are deliberately excluded.
const CHANGE_KEYS: (keyof VersionRecord)[] = [
  "build",
  "webVersion",
  "serverVersion",
  "seederVersion",
  "dbMigrationVersion",
  "migrationVersion",
];

function changeKey(rec: Partial<VersionRecord>): string {
  return CHANGE_KEYS.map((k) => rec[k] ?? "").join("|");
}

/** Parse the footer text into the five labeled fields. Throws if any are missing. */
function parseFooter(text: string): Record<FooterField, string> {
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const out = {} as Record<FooterField, string>;
  for (const [field, label] of Object.entries(FOOTER_FIELDS) as [FooterField, string][]) {
    const match = lines.find((l) => l.startsWith(`${label}:`));
    const value = match?.slice(label.length + 1).trim();
    if (!value) throw new Error(`Footer field not found: "${label}"`);
    out[field] = value;
  }
  return out;
}

type ApiVersion = {
  serverVersion: string;
  seederVersion: string;
  dbMigrationVersion: string;
  migrationVersion: string;
  nodeEnv: string | null;
};

/** Fetch the public version API — canonical source for the server-side fields. Throws on failure. */
async function fetchApiVersion(): Promise<ApiVersion> {
  const res = await fetch(VERSION_API, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Version API returned ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  const str = (v: unknown, name: string): string => {
    if (v == null) throw new Error(`Version API missing field: ${name}`);
    return String(v);
  };
  return {
    serverVersion: str(json.serverVersion, "serverVersion"),
    seederVersion: str(json.seederVersion, "seederVersion"),
    dbMigrationVersion: str(json.migrationTimestamp, "migrationTimestamp"),
    migrationVersion: str(json.migrationVersion, "migrationVersion"),
    nodeEnv: json.nodeEnv != null ? String(json.nodeEnv) : null,
  };
}

/** Drive the browser to read the rendered footer. */
async function captureFooter(): Promise<Record<FooterField, string>> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(MOTUS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Footer is painted by JS after load — wait for the labeled lines to exist.
    await page.waitForFunction(
      () => document.body.innerText.includes("Web Version:"),
      { timeout: 30000 },
    );
    const text = await page.evaluate(() => document.body.innerText);
    return parseFooter(text);
  } finally {
    await browser.close();
  }
}

function readLastRecord(): VersionRecord | null {
  if (!existsSync(VERSIONS_FILE)) return null;
  const lines = readFileSync(VERSIONS_FILE, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1);
  return last ? (JSON.parse(last) as VersionRecord) : null;
}

/** Rebuild the changelog table in README.md from the full versions log (newest first). */
function regenerateReadme(): void {
  if (!existsSync(README_FILE) || !existsSync(VERSIONS_FILE)) return;
  const records = readFileSync(VERSIONS_FILE, "utf8")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l) as VersionRecord);

  const header = "| Detected (UTC) | Build | Web | Server | Seeder | DB Migration | Migration # |\n"
    + "|---|---|---|---|---|---|---|";
  const rows = records
    .slice()
    .reverse()
    .map((r) =>
      `| ${r.capturedAt} | ${r.build} | ${r.webVersion} | ${r.serverVersion} | ${r.seederVersion} | ${r.dbMigrationVersion} | ${r.migrationVersion ?? "—"} |`,
    );
  const table = [header, ...rows].join("\n");

  const readme = readFileSync(README_FILE, "utf8");
  const start = "<!-- CHANGELOG:START -->";
  const end = "<!-- CHANGELOG:END -->";
  const before = readme.slice(0, readme.indexOf(start) + start.length);
  const after = readme.slice(readme.indexOf(end));
  writeFileSync(README_FILE, `${before}\n${table}\n${after}`);
}

function recordError(message: string): void {
  const at = new Date().toISOString();
  appendFileSync(ERRORS_FILE, JSON.stringify({ capturedAt: at, error: message }) + "\n");
  writeFileSync(
    LATEST_FILE,
    JSON.stringify({ lastCheckedAt: at, status: "error", current: null, error: message }, null, 2) + "\n",
  );
}

async function main(): Promise<void> {
  const footer = await captureFooter();
  const api = await fetchApiVersion();
  const record: VersionRecord = {
    capturedAt: new Date().toISOString(),
    ...footer,
    ...api,
  };

  const last = readLastRecord();
  const changed = !last || changeKey(last) !== changeKey(record);
  if (changed) {
    appendFileSync(VERSIONS_FILE, JSON.stringify(record) + "\n");
    console.log(last ? "Version changed — appended new record." : "First record — seeded log.");
    regenerateReadme();
  } else {
    console.log("No change since last check.");
  }

  writeFileSync(
    LATEST_FILE,
    JSON.stringify({ lastCheckedAt: record.capturedAt, status: "ok", current: record, error: null }, null, 2) + "\n",
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Capture failed: ${message}`);
  recordError(message);
  process.exit(1);
});
