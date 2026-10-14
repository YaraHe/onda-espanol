import { spawn } from "node:child_process";
import net from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const webDir = join(rootDir, "web");
const apiDir = join(rootDir, "api");
const testProjectRef = "ebmwdxldjyomgkedtxae";
const productionProjectRef = "ayhesvovoyqsmrhjuhwa";
const frontendOrigin = "http://localhost:3000";
const apiHost = "127.0.0.1";
const webHost = "127.0.0.1";

function readEnv(path) {
  if (!existsSync(path)) throw new Error(`Missing local config: ${path}`);
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
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

function required(values, key, label = key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`Missing ${label} in the local test configuration.`);
  return value;
}

function validate() {
  const testEnv = readEnv(join(webDir, ".env.s4test.local"));
  const apiEnv = readEnv(join(apiDir, ".env.local"));
  const testUrl = required(testEnv, "S4_TEST_SUPABASE_URL");
  const testKey = required(testEnv, "S4_TEST_SUPABASE_PUBLISHABLE_KEY");
  const parsedUrl = new URL(testUrl);
  const actualRef = parsedUrl.hostname.split(".")[0];
  if (actualRef === productionProjectRef || actualRef !== testProjectRef
    || parsedUrl.protocol !== "https:" || parsedUrl.hostname !== `${testProjectRef}.supabase.co`) {
    throw new Error(`Refusing to start: the isolated Supabase URL must be ${testProjectRef}.supabase.co.`);
  }
  if (!testKey.startsWith("sb_publishable_")) {
    throw new Error("Refusing to start: the isolated project publishable key is missing or has the wrong format.");
  }

  const apiPort = Number(required(apiEnv, "PORT", "API port"));
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535 || apiPort === 3000) {
    throw new Error("Refusing to start: API/.env.local must set a valid API port distinct from web port 3000.");
  }
  const configuredOrigin = required(apiEnv, "FRONTEND_ORIGIN", "API frontend origin").replace(/\/$/u, "");
  if (configuredOrigin !== frontendOrigin) {
    throw new Error(`Refusing to start: API CORS origin must be ${frontendOrigin}.`);
  }
  required(apiEnv, "AZURE_SPEECH_KEY", "Azure Speech key");
  required(apiEnv, "AZURE_SPEECH_REGION", "Azure Speech region");

  return {
    apiPort,
    testUrl,
    testKey,
    apiUrl: `http://${apiHost}:${apiPort}`,
    frontendUrl: frontendOrigin,
  };
}

function checkPort(host, port) {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is already in use; no process was stopped.`)));
    server.listen(port, host, () => server.close((error) => error ? reject(error) : resolvePromise()));
  });
}

function startProcess(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
  return child;
}

function stopTree(child) {
  if (!child.pid || child.killed) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", () => child.kill());
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForLocal(url, children, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null)) throw new Error("A local service exited before it became ready.");
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1500) });
      if (response.ok && !response.redirected) return response;
      lastError = new Error(`Local health check returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Local service did not become ready: ${lastError?.message ?? "timeout"}`);
}

async function main() {
  const config = validate();
  if (process.argv.includes("--check")) {
    console.log(`PASS isolated Supabase ref: ${testProjectRef}`);
    console.log(`PASS web URL: ${config.frontendUrl}`);
    console.log(`PASS API URL: ${config.apiUrl}`);
    console.log("PASS AI credentials are read from api/.env.local and are not printed.");
    console.log("PASS API Supabase Auth uses the isolated test URL and publishable key, overriding any local API Supabase settings.");
    return;
  }

  await checkPort(apiHost, config.apiPort);
  await checkPort(webHost, 3000);

  const children = [];
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) stopTree(child);
    setTimeout(() => process.exit(code), 400).unref();
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  const api = startProcess(process.execPath, [
    "--env-file-if-exists=.env.local", "--experimental-strip-types", "src/index.ts",
  ], apiDir, {
    ...process.env,
    HOST: apiHost,
    PORT: String(config.apiPort),
    FRONTEND_ORIGIN: frontendOrigin,
    SUPABASE_URL: config.testUrl,
    SUPABASE_PUBLISHABLE_KEY: config.testKey,
  });
  children.push(api);
  api.once("exit", (code) => { if (!stopping) stop(code ?? 1); });
  console.log(`Verified isolated Supabase project ${testProjectRef}; starting local API ${config.apiUrl}.`);

  try {
    const health = await waitForLocal(`${config.apiUrl}/health`, children, 30_000);
    const body = await health.json();
    if (body?.status !== "ok") throw new Error("Local API health response was not { status: 'ok' }.");

    const nextCli = join(rootDir, "node_modules", "next", "dist", "bin", "next");
    if (!existsSync(nextCli)) throw new Error("Next.js executable is missing from the existing web dependencies.");
    const web = startProcess(process.execPath, [nextCli, "dev", "--webpack", "--hostname", webHost, "--port", "3000"], webDir, {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: config.testUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.testKey,
      NEXT_PUBLIC_API_BASE_URL: config.apiUrl,
    });
    children.push(web);
    web.once("exit", (code) => { if (!stopping) stop(code ?? 1); });

    const page = await waitForLocal(config.frontendUrl, children, 60_000);
    if (!page.ok) throw new Error("Web readiness check did not return a successful response.");
    console.log(`PASS local Web and API are ready. Use ${config.frontendUrl}; Supabase ref is ${testProjectRef}.`);
    console.log("Press Ctrl+C to stop only the local Web and API processes started by this script.");
  } catch (error) {
    stop(1);
    throw error;
  }
}

main().catch((error) => {
  console.error(`S4 test startup blocked: ${error.message}`);
  process.exitCode = 1;
});
