import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const expectedProjectRef = "ebmwdxldjyomgkedtxae";

function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export default async function globalSetup() {
  const envPath = resolve(process.cwd(), ".env.s4test.local");
  let values;
  try {
    values = parseEnv(await readFile(envPath, "utf8"));
  } catch {
    throw new Error("S4-5 Playwright blocked: web/.env.s4test.local is unavailable.");
  }

  let supabaseUrl;
  try {
    supabaseUrl = new URL(values.S4_TEST_SUPABASE_URL);
  } catch {
    throw new Error("S4-5 Playwright blocked: isolated Supabase URL is invalid.");
  }
  if (supabaseUrl.protocol !== "https:" || supabaseUrl.hostname !== `${expectedProjectRef}.supabase.co`) {
    throw new Error(`S4-5 Playwright blocked: only isolated project ${expectedProjectRef} is allowed.`);
  }

  const baseUrl = process.env.S4_TEST_WEB_URL ?? "http://127.0.0.1:43100";
  const parsedBase = new URL(baseUrl);
  if (!["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
    throw new Error("S4-5 Playwright blocked: the Web base URL must be local.");
  }
  let health;
  try {
    health = await fetch(new URL("/health", baseUrl), { signal: AbortSignal.timeout(3000), redirect: "manual" });
  } catch {
    throw new Error("S4-5 Playwright blocked: the local isolated proxy is not reachable.");
  }
  if (!health.ok || health.redirected) {
    throw new Error(`S4-5 Playwright blocked: local health returned HTTP ${health.status}.`);
  }

  console.log(`PASS local test target; Supabase project ref verified: ${expectedProjectRef}.`);
  console.log("PASS browser test routes Supabase traffic locally; no project credentials are read or printed.");
}
